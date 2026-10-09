import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, OfferStatus, Role } from '@prisma/client'
import { assertCompanyScope, assertOfferScope } from '../common/ownership'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateOfferDto } from './dto/create-offer.dto'

@Injectable()
export class OfferService {
  constructor(private readonly prisma: PrismaService) {}

  /** E3-01 (hallazgo 4a): una empresa no puede crear ofertas a nombre de otra. */
  async create(dto: CreateOfferDto, userId: number, role: Role) {
    await assertCompanyScope(
      this.prisma,
      dto.companyId,
      userId,
      role,
      'no puedes crear ofertas a nombre de otra empresa',
    )
    return this.prisma.offer.create({ data: { ...dto, status: OfferStatus.DRAFT } })
  }

  findAll() {
    return this.prisma.offer.findMany({
      where: { status: OfferStatus.PUBLISHED },
      orderBy: { publishedAt: 'desc' },
      include: { company: true },
    })
  }

  /** E3-01 (hallazgo 5): los borradores solo los ven su empresa dueña y la coordinación. */
  async findOne(id: number, userId: number, role: Role) {
    const offer = await this.prisma.offer.findUnique({ where: { id }, include: { company: true } })
    if (!offer) throw new NotFoundException('oferta no encontrada')
    if (offer.status !== OfferStatus.PUBLISHED) {
      await assertCompanyScope(this.prisma, offer.companyId, userId, role, 'la oferta no está publicada')
    }
    return offer
  }

  // Ofertas de la empresa del usuario autenticado, en cualquier estado —
  // a diferencia de findAll() (solo PUBLISHED, para el catálogo del estudiante).
  // Incluye el estado de las postulaciones para que la empresa vea cupos
  // ocupados sin que el front tenga que pedir una lista aparte por oferta.
  async findAllForCompanyUser(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
    if (!user?.companyId) throw new NotFoundException('el usuario no tiene una empresa asociada')
    return this.prisma.offer.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
      include: { company: true, applications: { select: { status: true } } },
    })
  }

  /** E3-01 (hallazgo 4b): solo la empresa dueña de la oferta puede publicarla. */
  async publish(id: number, userId: number, role: Role) {
    const offer = await assertOfferScope(this.prisma, id, userId, role, 'la oferta no es de tu empresa')
    if (offer.status !== OfferStatus.DRAFT) {
      throw new BadRequestException('solo se publican ofertas en DRAFT')
    }
    return this.prisma.offer.update({
      where: { id },
      data: { status: OfferStatus.PUBLISHED, publishedAt: new Date() },
    })
  }

  /** E3-01 (hallazgo 4c): solo la empresa dueña de la oferta puede cerrarla. */
  async close(id: number, userId: number, role: Role) {
    const offer = await assertOfferScope(this.prisma, id, userId, role, 'la oferta no es de tu empresa')
    if (offer.status !== OfferStatus.PUBLISHED) {
      throw new BadRequestException('solo se cierran ofertas publicadas')
    }
    return this.prisma.offer.update({ where: { id }, data: { status: OfferStatus.CLOSED } })
  }

  // Cuenta las postulaciones ya aceptadas para una oferta.
  acceptedCount(offerId: number): Promise<number> {
    return this.prisma.application.count({
      where: { offerId, status: ApplicationStatus.ACCEPTED },
    })
  }
}
