# Problemas conocidos

Lo que sabemos que está mal y no alcanzamos a arreglar. Está ordenado por lo que más nos
dolió, no por severidad técnica.

Si encuentras algo que no está acá, agrégalo. Casi seguro hay más.

## D-01 · El sync duplica horas al reintentar

`src/offline/sync/push.ts` (front) y `src/sync/sync.service.ts` (back).

Si el push se corta a medias y el cliente reintenta, a veces aparecen dos registros de horas
idénticos. Pasa más en la práctica de campo, con señal intermitente. Mandamos un `clientOpId`
en cada operación y guardamos las operaciones en `sync_operations`, pero evidentemente algo
no está cerrando el círculo. No tuvimos tiempo de sentarnos a entenderlo.

Workaround actual: el coordinador borra los duplicados a mano.

## D-02 · `HourLogService` se nos fue de las manos

`src/hour-log/hour-log.service.ts`

Empezó siendo el CRUD de horas y terminó haciendo validación, persistencia, notificación al
tutor y agregación de reportes. Pasa las 300 líneas. Cada vez que hay que tocar algo ahí, hay
que leerlo entero. Habría que partirlo por responsabilidad, pero nunca fue prioridad.

## D-03 · El módulo de evaluaciones no tiene tests

`src/evaluation/`

Cero. Lo hicimos en la última semana y no alcanzamos. Es el módulo que más baja la cobertura
del proyecto. Si vas a tocar rúbricas o scores, escribe los tests primero — nadie sabe qué se
rompe.

## D-04 · La lista de postulaciones va lenta

`src/application/application.service.ts`, método `listByOffer`.

Con menos de 200 postulaciones no se nota. Arriba de eso, la pantalla de la empresa tarda
varios segundos. Sospechamos que es cómo traemos los estudiantes, pero no lo medimos.

## D-05 · Resuelto: reglas de acreditación como tabla ordenada

`calculateAccreditationStatus` tenía seis niveles de `if` anidados y ESLint la marcaba por
complejidad (17 ciclomática y 84 cognitiva); solo había dos tests, así que cualquier cambio
era a ciegas.

La historia E5-02 separó el qué del cómo: las reglas viven en `ACCREDITATION_RULES`, una
tabla ordenada donde cada regla declara su id, un resumen en una frase, cuándo aplica y qué
decide, y el motor solo recorre la tabla. ESLint ya no marca la función y las 40 pruebas de
caracterización de E5-01 fijan el comportamiento.

## D-06 · Resuelto: validación diaria de horas unificada

La auditoría encontró cinco copias, no tres: el DTO del backend permitía hasta 12 h; la
creación y la exportación del servicio cortaban en 10 h; y el frontend repetía dos funciones
con tope de 8 h. La sincronización no verificaba el límite.

La coordinación confirmó la regla: un estudiante puede distribuir actividades en varias
plazas, pero la suma de sus registros no eliminados para una misma fecha no puede pasar de
8 h. El límite, su mensaje y la regla están centralizados en
`src/hour-log/hour-log.validation.ts`; el flujo HTTP y el de sincronización lo usan.

