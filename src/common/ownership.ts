import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { Role } from '@prisma/client'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * Regla de pertenencia del backend (E3-01): además del rol que ya validan los
 * guards, quien actúa sobre un recurso debe ser su dueño. Sin esto, cualquier
 * usuario con el rol correcto opera sobre recursos ajenos
 * (ver `docs/inventario-acceso.md`).
 *
 * La coordinación es el rol global del dominio, así que siempre pasa.
 * Lanzan **403** (no 404) cuando el recurso existe pero no es del usuario.
 */
export function assertOwnership(isOwner: boolean, role: Role, message: string): void {
  if (role === Role.COORDINATOR) return
  if (!isOwner) throw new ForbiddenException(message)
}

/** Comprueba que la empresa del usuario autenticado sea dueña de `companyId`. */
export async function assertCompanyScope(
  prisma: PrismaService,
  companyId: number,
  userId: number,
  role: Role,
  message: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  assertOwnership(user?.companyId != null && user.companyId === companyId, role, message)
}

/**
 * Carga la oferta y comprueba que sea de la empresa del usuario. Única
 * implementación de la regla para los hallazgos 2, 3, 4 y 5 del inventario.
 */
export async function assertOfferScope(
  prisma: PrismaService,
  offerId: number,
  userId: number,
  role: Role,
  message: string,
) {
  const offer = await prisma.offer.findUnique({ where: { id: offerId } })
  if (!offer) throw new NotFoundException('oferta no encontrada')
  await assertCompanyScope(prisma, offer.companyId, userId, role, message)
  return offer
}
