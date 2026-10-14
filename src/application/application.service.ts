import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { assertOfferScope } from '../common/ownership'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  apply(offerId: number, studentId: number, motivation: string) {
    return this.prisma.application.create({
      data: { offerId, studentId, motivation, status: ApplicationStatus.SUBMITTED },
    })
  }

  // Postulaciones del propio estudiante, con la oferta y la empresa incluidas
  // para que la pantalla no tenga que resolverlas con llamadas aparte.
  listForStudent(studentId: number) {
    return this.prisma.application.findMany({
      where: { studentId },
      orderBy: { submittedAt: 'desc' },
      include: { offer: { include: { company: true } } },
    })
  }

  /** E3-01 (hallazgo 2): solo la empresa dueña de la oferta (o la coordinación) ve sus postulantes. */
  async listByOffer(offerId: number, userId: number, role: Role) {
    await assertOfferScope(this.prisma, offerId, userId, role, 'la oferta no es de tu empresa')

    // G2-20 (D-04): una sola consulta con el estudiante incluido, en vez de un
    // findUnique por postulación — antes eran 201 consultas con 200 filas.
    const applications = await this.prisma.application.findMany({
      where: { offerId },
      include: { student: { select: { id: true, email: true, fullName: true } } },
    })
    return applications
  }

  /** E3-01 (hallazgo 3): solo la empresa dueña de la oferta decide sobre sus postulaciones. */
  async decide(id: number, status: ApplicationStatus, userId: number, role: Role) {
    const application = await this.prisma.application.findUnique({ where: { id } })
    if (!application) throw new NotFoundException('postulación no encontrada')
    const offer = await assertOfferScope(
      this.prisma,
      application.offerId,
      userId,
      role,
      'la postulación no pertenece a una oferta de tu empresa',
    )
    if (application.status !== ApplicationStatus.SUBMITTED && application.status !== ApplicationStatus.INTERVIEW) {
      throw new BadRequestException('la postulación ya fue decidida')
    }

    if (status === ApplicationStatus.ACCEPTED) {
      // G2-19: UPDATE condicional atómico sobre la propia fila de la oferta.
      // Entre leer cuántas aceptadas hay y escribir la aceptación no debe
      // quedar ninguna ventana: dos aceptaciones a la vez solo pueden mover
      // este contador una vez cada una, nunca por encima de seats. La fila
      // que no logra incrementarlo (claimed.count === 0) perdió la carrera.
      const claimed = await this.prisma.offer.updateMany({
        where: { id: offer.id, acceptedCount: { lt: offer.seats } },
        data: { acceptedCount: { increment: 1 } },
      })
      if (claimed.count === 0) throw new BadRequestException('la oferta ya no tiene cupos')
    }

    return this.prisma.application.update({
      where: { id },
      data: { status, decidedAt: new Date() },
    })
  }
}
