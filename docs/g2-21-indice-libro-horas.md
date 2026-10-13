# G2-21 — Acelerar el libro de horas con el índice que falta

## La consulta

`HourLogService.listForPlacement` (`src/hour-log/hour-log.service.ts:81-87`):

```ts
82  listForPlacement(placementId: number) {
83    return this.prisma.hourLog.findMany({
84      where: { placementId, deletedAt: null },
85      orderBy: { date: 'desc' },
86    })
87  }
```

En SQL: `SELECT ... FROM hour_logs WHERE "placementId" = $1 AND "deletedAt" IS NULL ORDER BY "date" DESC`.

## Por qué recorría la tabla entera

El modelo `HourLog` solo tenía `@@index([updatedAt, id])` (para el sync) y su clave primaria.
No había índice por `placementId` ni por `date`, y la clave foránea `hour_logs_placementId_fkey`
**no crea índice** en PostgreSQL. Índices antes del cambio: `hour_logs_pkey`, `hour_logs_updatedAt_id_idx`.

## Plan ANTES (recorrido secuencial)

Con el volumen del entorno de pruebas (200 placements × 20 = **4.000 `hour_logs`**):

```
Sort  (cost=114.43..114.48 rows=20 width=28) (actual time=0.587..0.597 rows=20 loops=1)
  Sort Key: date DESC
  Sort Method: quicksort  Memory: 17kB
  Buffers: shared hit=64
  ->  Seq Scan on hour_logs  (cost=0.00..114.00 rows=20 width=28) (actual time=0.033..0.542 rows=20)
        Filter: (("deletedAt" IS NULL) AND ("placementId" = 1))
        Rows Removed by Filter: 3980          <-- recorre las 4.000 y descarta 3.980
        Buffers: shared hit=64
Planning Time: 0.144 ms
Execution Time: 0.668 ms
```

Tiempos de pared (5 corridas): `2.115  1.281  1.099  0.988  1.089 ms`.

## El cambio

`prisma/schema.prisma` → `HourLog`:

```prisma
  @@index([placementId, date])
  @@index([updatedAt, id])
```

Y la migración `prisma/migrations/20261014000000_add_hourlog_placement_date_index/migration.sql`:

```sql
CREATE INDEX "hour_logs_placementId_date_idx" ON "hour_logs"("placementId", "date");
```

Sirve también para el `ORDER BY date DESC` porque PostgreSQL puede recorrer el índice al revés.

## Plan DESPUÉS (usa el índice)

```
Sort  (cost=48.48..48.53 rows=20 width=28) (actual time=0.097..0.105 rows=20 loops=1)
  Sort Key: date DESC
  Buffers: shared hit=20 read=2
  ->  Bitmap Heap Scan on hour_logs  (cost=4.44..48.05 rows=20 width=28) (actual time=0.040..0.069 rows=20)
        Recheck Cond: ("placementId" = 1)
        Filter: ("deletedAt" IS NULL)
        Heap Blocks: exact=20
        Buffers: shared hit=20 read=2
        ->  Bitmap Index Scan on "hour_logs_placementId_date_idx"  (cost=0.00..4.43 rows=20)
              Index Cond: ("placementId" = 1)
              Index Searches: 1
Planning Time: 0.266 ms
Execution Time: 0.132 ms
```

Tiempos de pared (5 corridas): `0.725  0.548  0.482  0.483  0.786 ms`.

## Mejora medida

| Métrica | Antes | Después |
|---|---|---|
| Nodo de acceso | `Seq Scan` (4.000 filas recorridas) | `Bitmap Index Scan` sobre `hour_logs_placementId_date_idx` |
| `Rows Removed by Filter` | 3.980 | 0 (no recorre la tabla) |
| `Execution Time` | 0.668 ms | **0.132 ms** (≈5×) |
| Buffers | 64 | 22 |
| Tiempo de pared | ≈1,0–2,1 ms | **≈0,48–0,79 ms** (≈2×) |

## Cómo reproducirlo

Con el Postgres de `docker-compose` (es el entorno donde conviene validarlo antes del merge):

```bash
docker compose up -d
pnpm db:deploy     # aplica esta migración
pnpm db:seed       # 4.000 hour_logs en 200 placements

# antes: quitar el índice y mirar el plan
psql "$DATABASE_URL" -c 'DROP INDEX "hour_logs_placementId_date_idx";'
psql "$DATABASE_URL" -c 'EXPLAIN (ANALYZE, BUFFERS) SELECT id, "placementId", date, hours, status
  FROM hour_logs WHERE "placementId" = 1 AND "deletedAt" IS NULL ORDER BY date DESC;'

# después: volver a aplicar la migración
pnpm db:deploy
psql "$DATABASE_URL" -c 'EXPLAIN (ANALYZE, BUFFERS) SELECT id, "placementId", date, hours, status
  FROM hour_logs WHERE "placementId" = 1 AND "deletedAt" IS NULL ORDER BY date DESC;'
```

## Nota sobre el entorno de medición

Los planes de arriba se tomaron sobre un **PostgreSQL real (PGlite 0.5.9, Postgres 17 compilado a WASM)**
aplicando **las migraciones del repo tal cual** y sembrando los 4.000 registros del seed, porque en el
entorno del agente Docker no puede arrancar (WSL da `E_ACCESSDENIED`). Es el mismo motor y el mismo
planificador, así que el plan y la mejora son válidos; conviene reproducirlos igualmente sobre el
Postgres de `docker-compose` antes del merge.
