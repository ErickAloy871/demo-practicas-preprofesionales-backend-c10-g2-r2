# G2-24 — Guardar las fechas de la práctica sin desfase de zona horaria

## Contexto del problema

Anteriormente, la fecha de un registro de horas (`HourLog.date`) se recibía directamente desde el dispositivo del estudiante y se persistía en la base de datos sin ningún tipo de normalización.

Esto causaba los siguientes problemas:
1. **Desfase horario por timezone del dispositivo**: Cuando un estudiante en otra zona horaria (por ejemplo, Tokio `UTC+9`, Madrid `UTC+2` o Los Ángeles `UTC-7`) enviaba su registro, o cuando un estudiante local en Ecuador (`UTC-5`) registraba sus horas tarde en la noche (después de las 19:00 local, correspondiente al día siguiente en UTC), la serialización en formato UTC (`.toISOString()`) provocaba que el registro cayera en un día civil anterior o posterior al que realmente se asistió.
2. **Falta de comprobación de fechas futuras**: Un dispositivo con la hora adelantada o un estudiante que seleccionaba una fecha posterior a la actual podía registrar horas antes de realizarlas.
3. **Falta de validación contra el periodo de la práctica**: No se comprobaba que la fecha registrada estuviese comprendida entre `placement.startDate` y `placement.endDate`, permitiendo registrar jornadas antes de iniciar o después de finalizar la práctica.

---

## Decisión de diseño: ¿"Día calendario" o "Instante"?

> **Decisión:** La fecha de la práctica (`HourLog.date`) es estrictamente un **DÍA CALENDARIO**, **NO** un instante.

### ¿Por qué NO es un instante?
- Un **instante** (timestamp / `timestamptz`) representa un momento puntual en la línea temporal global (ej. `2026-10-14T23:15:00.000Z`). Tiene sentido para marcas de auditoría como `createdAt`, `updatedAt` o `reviewedAt`.
- Si tratamos la fecha de la práctica como un instante, su interpretación cambia según la zona horaria de quien la consulta: a las `01:00 UTC del 16 de abril`, en Ecuador (`UTC-5`) son las `20:00 del 15 de abril`, mientras que en Tokio (`UTC+9`) son las `10:00 del 16 de abril`. Mezclar ambos conceptos era precisamente la causa raíz de que las horas aparecieran en días distintos.

### ¿Por qué ES un día calendario?
- El estudiante acude a realizar sus prácticas profesionales un día civil específico (ej. "el 15 de abril de 2026").
- Las horas específicas en las que inició y culminó su jornada ya se registran independientemente en los campos `startTime` (ej. `"08:00"`) y `endTime` (ej. `"12:00"`).
- La institución académica y las empresas receptoras operan bajo la jurisdicción y huso horario de la institución (por defecto `America/Guayaquil`, configurable mediante `INSTITUTION_TIMEZONE`).
- Por tanto, la representación canónica en almacenamiento para un día civil en PostgreSQL (`TIMESTAMP WITHOUT TIME ZONE`) y Prisma es fijar la hora a la medianoche canónica UTC: `YYYY-MM-DDT00:00:00.000Z`.

---

## Estrategia de normalización implementada

Se implementó el módulo [`src/common/date-normalization.ts`](file:///c:/Users/USER/Desktop/UTA/Sexto%20Semestre/Gestion/Poyecto%20Yura/demo-practicas-preprofesionales-backend-c10-g2-r2/src/common/date-normalization.ts) con las siguientes reglas:

1. **Cadenas de fecha civil (`YYYY-MM-DD`)**:
   - Extrae directamente `[year, month, day]`.
   - Construye la fecha canónica `Date.UTC(year, month - 1, day, 0, 0, 0, 0)`.
2. **Cadenas de datepickers locales con desfase (`YYYY-MM-DDT00:00:00+09:00`, `...-05:00`)**:
   - Reconoce la intención del selector de fecha local del usuario y preserva el día calendario seleccionado, normalizándolo a medianoche UTC canónica.
3. **Instantes con hora / minuto**:
   - Si se recibe un instante (ej. desde un dispositivo móvil o sync offline), se proyecta a la zona horaria institucional mediante `Intl.DateTimeFormat` configurado con `timeZone: getInstitutionTimezone()`.
   - Se obtiene el día calendario oficial que regía en la institución en dicho momento y se guarda en `00:00:00.000Z`.
4. **Fechas ya canónicas (`00:00:00.000Z`)**:
   - Se preservan intactas sin sufrir desplazamiento de zona horaria.

---

## Validaciones de negocio agregadas

En `HourLogService.create` (`src/hour-log/hour-log.service.ts`):

1. **Validación de fecha futura**:
   - Se calcula el inicio del día actual en la zona horaria institucional (`getTodayInTimezone()`).
   - Si `normalizedDate > today`, se rechaza con `400 Bad Request`:
     `no se pueden registrar horas con fecha futura`.
2. **Validación de rango de práctica**:
   - Se valida contra `placement.startDate` y `placement.endDate`.
   - Si la fecha está fuera de dicho intervalo, se rechaza con `400 Bad Request` indicando el rango válido:
     `la fecha está fuera del periodo de la práctica (rango válido: YYYY-MM-DD a YYYY-MM-DD)`.
   - Se aceptan las fechas en los límites exactos (`startDate` y `endDate`).

---

## Compatibilidad y registros existentes

- **Registros existentes**: Los datos existentes generados por seeds y registros previos ya residen con medianoche UTC (`00:00:00.000Z`). No sufren desplazamiento ni cambio de día.
- **Migración de base de datos**: No se requiere migración destructiva en el esquema (`schema.prisma` ya define `date DateTime`). Si existieran filas históricas con horas intermedias en bases de datos legadas, una migración reversible de normalización sería:
  ```sql
  -- Normalización canónica (migración reversible si se requiere)
  UPDATE "hour_logs"
  SET "date" = date_trunc('day', "date")
  WHERE "date" != date_trunc('day', "date");
  ```
- **Exportaciones y reportes**: El método `exportRows` utiliza `dto.date.toISOString().slice(0, 10)`, el cual gracias a la normalización canónica a `00:00:00.000Z` genera exactamente la fecha `YYYY-MM-DD` sin riesgo de desfasarse al día anterior.
