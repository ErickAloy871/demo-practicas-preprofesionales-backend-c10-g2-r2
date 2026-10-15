# Spike G2-18: sobrecupo con dos aceptaciones simultáneas

> Reproducción del sobrecupo (race condition) en la verificación de cupos.
> **Este spike NO arregla el bug**: lo provoca a voluntad y documenta dónde está
> la ventana. El arreglo es una tarea aparte.
> Base del análisis: `develop` @ `6f6e269` (las líneas citadas son de ese commit).

## Qué demuestra

Ejecutando `pnpm test -- oversubscription` se reproduce el sobrecupo en **una
sola corrida y sin depender del azar**: una oferta con **1 plaza libre** termina
con **2 postulaciones ACEPTADAS**.

Test: `src/application/oversubscription.spike.spec.ts`

| Caso | Qué prueba | Estado |
|---|---|---|
| `(control) en secuencia la segunda aceptación sí se rechaza` | El chequeo de cupos **existe y funciona** cuando las peticiones no se solapan: la segunda recibe `400 'la oferta ya no tiene cupos'`. | verde |
| `(bug) deja 2 aceptadas en una oferta de 1 plaza` | Con las dos peticiones solapadas, **ambas pasan** y quedan 2 aceptadas. | verde (evidencia) |
| `(invariante) solo una debería aceptarse y la otra rechazarse` | Fija la garantía correcta. Hoy falla porque hay 2 aceptadas, por eso va con `.fails`. | `it.fails` |

El caso control es importante: descarta que el problema sea "falta el chequeo".
El chequeo está (líneas 62-63); lo que falta es que la lectura y la escritura sean
atómicas entre sí.

## Dónde está la ventana exactamente

`src/application/application.service.ts`, en `decide()`:

```ts
58    if (status === ApplicationStatus.ACCEPTED) {
59      const offer = await this.prisma.offer.findUnique({ where: { id: application.offerId } })
60      if (!offer) throw new NotFoundException('oferta no encontrada')
61      // Verifica que la oferta todavía tenga cupos antes de aceptar la postulación.
62      const accepted = await this.offers.acceptedCount(application.offerId)   // ← LECTURA
63      if (accepted >= offer.seats) throw new BadRequestException('la oferta ya no tiene cupos')  // ← COMPARACIÓN
64    }
65
66    return this.prisma.application.update({                                   // ← ESCRITURA
67      where: { id },
68      data: { status, decidedAt: new Date() },
69    })
```

La lectura real ocurre en `src/offer/offer.service.ts:77-81`:

```ts
77  acceptedCount(offerId: number): Promise<number> {
78    return this.prisma.application.count({
79      where: { offerId, status: ApplicationStatus.ACCEPTED },
80    })
81  }
```

**La brecha va de la línea 62 (el `SELECT` de la 78) al `update` de la 66**: no
hay transacción, ni bloqueo de la fila de la oferta, ni restricción única en
base, ni `UPDATE` condicional. Dos peticiones que coincidan en esa ventana leen
las dos `accepted = 0` con `seats = 1`, las dos pasan el `if` de la 63 y las dos
ejecutan el `update` de la 66.

## Por qué la prueba es determinista

En vez de lanzar dos promesas y esperar que el scheduler las intercale "con
suerte", el doble de `prisma.application.count` lleva una **barrera de dos**:

1. cada lectura toma el *snapshot* del estado (0 aceptadas) y avisa que llegó;
2. espera a que la otra lectura también haya llegado;
3. solo entonces las dos continúan y escriben.

Así las dos lecturas se completan **antes** de cualquiera de las dos escrituras,
que es exactamente el entrelazado que produce el sobrecupo en producción. No hay
carrera real de hilos: hay un interleaving forzado, así que el resultado es el
mismo en todas las corridas (no hace falta repetirlo N veces).

## Cómo provocarlo

```bash
pnpm test -- oversubscription          # solo el spike
pnpm test                              # suite completa
```

Resumen esperado:

```
✓ Spike sobrecupo (G2-18) > (control) en secuencia la segunda aceptación sí se rechaza: el chequeo existe
✓ Spike sobrecupo (G2-18) > (bug) deja 2 aceptadas en una oferta de 1 plaza: ambas peticiones pasan
✓ Spike sobrecupo (G2-18) > (invariante) solo una debería aceptarse y la otra rechazarse (expected to fail)
```

## Fuera de alcance (a propósito)

Este spike no modifica ningún servicio. Candidatos de arreglo para la tarea
siguiente (no decididos aquí): transacción con aislamiento suficiente y bloqueo
de la fila de la oferta, restricción única/parcial en base sobre `(offerId)`
para estados aceptados, o `UPDATE` condicional que solo avance si
`accepted < seats`. Al aplicar el arreglo, hay que quitarle el `.fails` al caso
invariante y dejarlo en verde.
