import { ForbiddenException } from '@nestjs/common'
import { Role } from '@prisma/client'

/**
 * Regla de pertenencia del backend (E3-01).
 *
 * Los guards (`JwtAuthGuard`, `RolesGuard`) comprueban **rol**: que el usuario
 * esté autenticado y que su rol esté entre los permitidos por el endpoint. Esta
 * función comprueba lo otro: **pertenencia**, que el recurso sobre el que se
 * actúa sea del usuario que llama. Sin ella, cualquier usuario con el rol
 * correcto opera sobre recursos ajenos (ver `docs/inventario-acceso.md`).
 *
 * La coordinación es el único rol global del dominio (un solo coordinador
 * operando sobre el sistema completo, ver README), así que conserva el acceso
 * sin restricción de pertenencia.
 *
 * Devuelve **403** (no 404): el recurso existe, el usuario simplemente no es
 * su dueño.
 */
export function assertOwnership(isOwner: boolean, role: Role, message: string): void {
  if (role === Role.COORDINATOR) return
  if (!isOwner) throw new ForbiddenException(message)
}
