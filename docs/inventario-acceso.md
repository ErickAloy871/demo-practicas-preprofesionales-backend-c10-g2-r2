# Inventario de acceso: rol vs. pertenencia

> E3-01 · Épica E3 (Seguridad y control de acceso)

Los guards del backend (`JwtAuthGuard`, `RolesGuard`) verifican **rol**: que el usuario esté
autenticado y que su rol esté en la lista de `@Roles(...)` del endpoint. Eso no es lo mismo que
**pertenencia**: que el recurso sobre el que actúa (el placement, la oferta, el registro de horas)
sea del usuario que llama. Un tutor autenticado con rol `TUTOR` pasa el guard de cualquier
endpoint de tutor, tenga o no asignada esa práctica en particular.

Este documento inventaría los 26 endpoints del backend y las rutas protegidas del frontend,
marca cuáles comprueban pertenencia además de rol, y demuestra con `curl` cuáles de los que no
la comprueban son explotables de verdad (no solo "en teoría, por lectura de código").

**Cómo se probó:** backend local (`pnpm dev`) contra la base del seed (`pnpm db:seed`), usando
los usuarios documentados en el README (contraseña `yura1234` para todos). Cada prueba marcada
como hallazgo se ejecutó una sola vez y el dato que tocó se revirtió o se borró de inmediato
después de capturar la respuesta — no queda ningún rastro en la base.

## 1. Backend — inventario completo

| Método | Ruta | Roles permitidos | ¿Comprueba pertenencia? |
|---|---|---|---|
| POST | `/auth/login` | público | N/A (no hay recurso) |
| GET | `/sync/pull` | cualquier rol autenticado | Sí — filtra por `studentId`/`tutorId` = usuario |
| POST | `/sync/push` | cualquier rol autenticado | Sí — valida dueño del `placement`/`hourLog` por operación |
| GET | `/companies` | cualquier rol autenticado | N/A (catálogo, sin dueño) |
| POST | `/companies` | COORDINATOR | N/A (acción global del único rol admin) |
| POST | `/hour-logs` | STUDENT | Sí — `placement.studentId === userId` |
| GET | `/placements/:id/hour-logs` | cualquier rol autenticado | Sí — `assertPlacementAccess` |
| GET | `/placements/:id/progress` | cualquier rol autenticado | Sí — `assertPlacementAccess` |
| PATCH | `/hour-logs/:id/review` | TUTOR | **No** — ver hallazgo 1 |
| POST | `/applications` | STUDENT | Sí — crea la postulación para sí mismo |
| GET | `/offers/:offerId/applications` | COMPANY, COORDINATOR | **No** — ver hallazgo 2 |
| GET | `/applications/me` | STUDENT | Sí — lista solo lo propio |
| PATCH | `/applications/:id/decide` | COMPANY, COORDINATOR | **No** — ver hallazgo 3 |
| GET | `/placements/accreditation` | COORDINATOR | N/A (reporte global del único rol admin) |
| POST | `/placements` | COORDINATOR | N/A (acción global) |
| GET | `/placements/me` | STUDENT | Sí — devuelve solo el propio |
| PATCH | `/placements/:id/activate` | COORDINATOR | N/A (acción global) |
| POST | `/placements/:id/documents` | STUDENT, COORDINATOR | Sí — `studentId === uploadedById` (o COORDINATOR) |
| GET | `/offers` | cualquier rol autenticado | N/A (catálogo público, solo `PUBLISHED`) |
| GET | `/offers/me` | COMPANY | Sí — filtra por `companyId` del usuario |
| GET | `/offers/:id` | cualquier rol autenticado | **No** — ver hallazgo 5 |
| POST | `/offers` | COMPANY, COORDINATOR | **No** — ver hallazgo 4a |
| PATCH | `/offers/:id/publish` | COMPANY, COORDINATOR | **No** — ver hallazgo 4b |
| PATCH | `/offers/:id/close` | COMPANY, COORDINATOR | **No** — ver hallazgo 4c |
| POST | `/evaluations` | TUTOR, COMPANY, STUDENT | Sí — `assertCanSubmit` valida dueño según el rol |
| GET | `/placements/:id/evaluations` | cualquier rol autenticado | Sí — chequeo explícito de `studentId`/`tutorId`/COORDINATOR |

**26 endpoints**, **6 filas marcadas "No"** (agrupadas en 5 hallazgos, porque `publish` y `close`
comparten exactamente el mismo problema que `create`: el `companyId` nunca se compara contra la
empresa del usuario autenticado).

## 2. Hallazgos explotables (con prueba)

### Hallazgo 1 — un tutor aprueba horas que no son suyas

`PATCH /hour-logs/:id/review` solo exige rol `TUTOR`. `HourLogService.review()` nunca compara
`placement.tutorId` contra el tutor que llama.

```bash
# login como tutor1 (id 3), que NO es tutor del placement 1
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"tutor1@miyura.com","password":"yura1234"}'
# copiar accessToken -> $T1

# hour-log 16 pertenece al placement 1, cuyo tutor es tutor0 (id 2), no tutor1
curl -s -X PATCH http://localhost:3000/api/hour-logs/16/review \
  -H "Authorization: Bearer $T1" -H 'Content-Type: application/json' \
  -d '{"status":"APPROVED"}'
```

**Resultado real:** `HTTP 200`, la hora queda `APPROVED` con `reviewedById` del tutor equivocado.
Debería ser `403`.

**Impacto:** cualquier tutor aprueba o rechaza horas de prácticas que no supervisa — rompe la
integridad del libro de horas y, en cadena, la acreditación.

### Hallazgo 2 — una empresa ve los postulantes de otra

`GET /offers/:offerId/applications` solo exige rol `COMPANY` o `COORDINATOR`.
`ApplicationService.listByOffer()` no filtra por `companyId` del dueño de la oferta.

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"empresa1@miyura.com","password":"yura1234"}'
# copiar accessToken -> $E1 (empresa1 = companyId 2)

# la oferta 1 es de companyId 1 (empresa0)
curl -s http://localhost:3000/api/offers/1/applications -H "Authorization: Bearer $E1"
```

**Resultado real:** `HTTP 200` con la lista completa de postulantes — nombre y email incluidos.
Debería ser `403`.

**Impacto:** fuga de datos personales de estudiantes hacia una empresa competidora.

### Hallazgo 3 — una empresa decide sobre postulaciones de otra

`PATCH /applications/:id/decide` solo exige rol `COMPANY` o `COORDINATOR`.
`ApplicationService.decide()` no compara la empresa de la oferta contra la del usuario.

```bash
# estudiante postula a la oferta 1 (de empresa0), queda en SUBMITTED
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"estudiante199@miyura.com","password":"yura1234"}'
# copiar accessToken -> $S
curl -s -X POST http://localhost:3000/api/applications -H "Authorization: Bearer $S" \
  -H 'Content-Type: application/json' -d '{"offerId":1,"motivation":"prueba"}'
# copiar el id de la respuesta -> <APP_ID>

# empresa1 (companyId 2) decide sobre una postulación de la oferta de empresa0 (companyId 1)
curl -s -X PATCH http://localhost:3000/api/applications/<APP_ID>/decide \
  -H "Authorization: Bearer $E1" -H 'Content-Type: application/json' -d '{"status":"REJECTED"}'
```

**Resultado real:** `HTTP 200`, la postulación queda `REJECTED` por una empresa ajena a la oferta.
Debería ser `403`.

**Impacto:** una empresa rechaza o acepta candidatos de un competidor — manipula sus cupos y su
proceso de selección.

### Hallazgo 4 — una empresa suplanta a otra en el ciclo de vida de ofertas

`POST /offers`, `PATCH /offers/:id/publish` y `PATCH /offers/:id/close` solo exigen rol
`COMPANY`/`COORDINATOR`. Ninguno de los tres compara `companyId` contra la empresa del usuario:
`create()` toma el `companyId` tal cual del body, y `publish()`/`close()` no lo validan en
absoluto.

```bash
# 4a) empresa1 crea una oferta a nombre de companyId 1 (empresa0)
curl -s -X POST http://localhost:3000/api/offers -H "Authorization: Bearer $E1" \
  -H 'Content-Type: application/json' \
  -d '{"companyId":1,"title":"oferta falsa","description":"x","modality":"REMOTO","seats":1,"requiredHours":100,"periodStart":"2027-01-01","periodEnd":"2027-06-01"}'
# -> HTTP 201, crea la oferta con companyId 1 sin ninguna validación

# 4b) empresa0 crea una oferta propia en DRAFT, empresa1 la publica
curl -s -X POST http://localhost:3000/api/offers -H "Authorization: Bearer $E0" \
  -H 'Content-Type: application/json' \
  -d '{"companyId":1,"title":"oferta de empresa0","description":"x","modality":"REMOTO","seats":1,"requiredHours":100,"periodStart":"2027-01-01","periodEnd":"2027-06-01"}'
# copiar el id -> <OFFER_ID>
curl -s -X PATCH http://localhost:3000/api/offers/<OFFER_ID>/publish -H "Authorization: Bearer $E1"
# -> HTTP 200, empresa1 publica la oferta de empresa0

# 4c) empresa1 cierra una oferta real y publicada de empresa0 (oferta 2)
curl -s -X PATCH http://localhost:3000/api/offers/2/close -H "Authorization: Bearer $E1"
# -> HTTP 200, empresa1 cierra una oferta que no es suya
```

**Resultado real:** los tres dan `HTTP 200`/`201`. Deberían dar `403`.

**Impacto:** el más grave de los cinco — una empresa publica contenido a nombre de otra
(suplantación) o cierra sus ofertas activas (sabotaje: le corta el catálogo a un competidor sin
que medie ninguna acción suya).

### Hallazgo 5 — cualquiera lee ofertas sin publicar de cualquier empresa

`GET /offers/:id` no tiene `@Roles(...)`, así que cualquier rol autenticado pasa el guard. El
servicio tampoco filtra por `status`, a diferencia de `GET /offers` (que sí solo devuelve
`PUBLISHED`).

```bash
# empresa0 crea una oferta DRAFT (sin publicar)
curl -s -X POST http://localhost:3000/api/offers -H "Authorization: Bearer $E0" \
  -H 'Content-Type: application/json' \
  -d '{"companyId":1,"title":"borrador","description":"x","modality":"REMOTO","seats":1,"requiredHours":100,"periodStart":"2027-01-01","periodEnd":"2027-06-01"}'
# copiar el id -> <DRAFT_ID>

# un estudiante la lee directo por id
curl -s http://localhost:3000/api/offers/<DRAFT_ID> -H "Authorization: Bearer $S"
```

**Resultado real:** `HTTP 200`, el estudiante ve el borrador completo (título, cupos, horas,
fechas, datos de la empresa) antes de que la empresa decida publicarlo.

**Impacto:** menor que los otros cuatro — no expone datos de una persona específica, pero sí
información de negocio no publicada (precios implícitos vía `requiredHours`/`seats`, estrategia
de contratación) a cualquier usuario que adivine o enumere ids.

## 3. Lo que sí comprueba pertenencia (sin hallazgo)

`GET /placements/:id/hour-logs`, `GET /placements/:id/progress`, `GET /placements/:id/evaluations`
(confirmados con `curl`: un tutor ajeno recibe `403` en los tres), más `POST /hour-logs`,
`POST /placements/:id/documents`, `POST /evaluations`, `GET /offers/me`, `GET /applications/me`,
`GET /placements/me` y los dos endpoints de `/sync` (verificados por código, con cobertura de
tests propia de la épica E1).

## 4. N/A — acción global de un rol único

`POST /companies`, `POST /placements`, `PATCH /placements/:id/activate`,
`GET /placements/accreditation`: las cuatro son exclusivas de `COORDINATOR`. El dominio define un
solo coordinador operando sobre todo el sistema (ver README), así que "pertenencia" no aplica —
no hay un segundo coordinador del que proteger estos datos.

## 5. Frontend — rutas protegidas

El router (`src/App.tsx`, `RequireRole`) solo valida **rol**, nunca pertenencia; toda comprobación
real de dueño depende de lo que responda la API.

| Ruta | Roles | ¿Comprueba pertenencia en el router? | Nota |
|---|---|---|---|
| `/ofertas`, `/ofertas/:id` | STUDENT | No | `GET /offers/:id` tampoco la comprueba (hallazgo 5) |
| `/postulaciones` | STUDENT | No aplica | Backend filtra por `applications/me` |
| `/mi-practica`, `/horas`, `/documentos` | STUDENT | No aplica | Backend filtra por `placements/me` y relacionados |
| `/practicantes` | TUTOR | No aplica | Lista propia, resuelta en backend |
| `/practicantes/:id/horas` | TUTOR | No | Pero el backend sí filtra (`assertPlacementAccess`) — a salvo por capas |
| `/practicantes/:id/evaluar` | TUTOR | No | El backend sí filtra en `assertCanSubmit` — a salvo por capas |
| `/ofertas-empresa` | COMPANY | No aplica | Backend filtra por `offers/me` |
| `/ofertas-empresa/:id/postulaciones` | COMPANY | No | **Llama al endpoint del hallazgo 2** — una empresa puede navegar manualmente a la URL con el id de otra empresa y ver sus postulantes |
| `/acreditacion` | COORDINATOR | No aplica | Rol único, igual que en backend |

Solo `/ofertas-empresa/:id/postulaciones` queda realmente expuesta por esto — las demás rutas sin
chequeo en el router están a salvo porque el backend sí filtra.

## 6. Priorización de los hallazgos (para las tareas hijas)

| # | Hallazgo | Endpoint(s) | Severidad | Por qué |
|---|---|---|---|---|
| 1 | Tutor aprueba horas ajenas | `PATCH /hour-logs/:id/review` | **Alta** | Rompe la integridad del libro de horas y la acreditación |
| 2 | Empresa ve postulantes ajenos | `GET /offers/:offerId/applications` | **Alta** | Fuga de datos personales (PII) de estudiantes |
| 3 | Empresa decide postulaciones ajenas | `PATCH /applications/:id/decide` | **Alta** | Manipula el proceso de selección de un competidor |
| 4 | Empresa suplanta a otra en ofertas | `POST /offers`, `PATCH /offers/:id/publish`, `PATCH /offers/:id/close` | **Alta** | Suplantación y sabotaje directo sobre el catálogo de otra empresa |
| 5 | Borradores de ofertas visibles para cualquiera | `GET /offers/:id` | **Media** | Fuga de información de negocio no publicada, sin dato personal de terceros |

Los primeros cuatro comparten la misma causa raíz (falta un chequeo de pertenencia tras el guard
de rol) y se arreglan con el mismo patrón en cada servicio: comparar el id del recurso contra el
usuario autenticado antes de actuar, como ya hacen `assertPlacementAccess` o
`HourLogService.addDocument`.
