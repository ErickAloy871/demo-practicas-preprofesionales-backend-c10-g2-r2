import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { HourLogStatus, PlacementStatus, Role } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateHourLogDto } from './dto/create-hour-log.dto'
import { HourLogNotificationService } from './hour-log.notification.service'
import { HourLogReportService } from './hour-log.report.service'
import { HourLogValidationService } from './hour-log.validation.service'

/**
 * Orquestador del módulo de libro de horas.
 *
 * Responsabilidad única: coordinar el flujo de creación y revisión de
 * jornadas. Delega validación, notificación y reportes a servicios
 * especializados. No contiene lógica de negocio propia más allá de
 * gestionar el placement y la máquina de estados de aprobación.
 */
@Injectable()
export class HourLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: HourLogValidationService,
    private readonly notification: HourLogNotificationService,
    private readonly report: HourLogReportService,
  ) {}

  /**
   * Registra una jornada de horas para el placement del estudiante.
   * Valida el placement, delega la validación de rangos y dispara la
   * notificación al tutor.
   */
  async create(dto: CreateHourLogDto, studentId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: dto.placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    if (placement.studentId !== studentId) throw new BadRequestException('el placement no es tuyo')
    if (placement.status !== PlacementStatus.ACTIVE) {
      throw new BadRequestException('el placement no está activo')
    }

    this.validation.validateHourRange(dto.hours)
    this.validation.validateTimeRange(dto.startTime, dto.endTime)

    const created = await this.prisma.hourLog.create({
      data: {
        placementId: dto.placementId,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
        hours: dto.hours,
        activity: dto.activity,
        status: HourLogStatus.SUBMITTED,
      },
    })

    this.notification.notifyTutor(placement.tutorId, created.id)
    return created
  }

  /**
   * Verifica que quien consulta un placement sea el estudiante dueño, su
   * tutor asignado, o un coordinador.
   */
  async assertPlacementAccess(placementId: number, userId: number, role: Role): Promise<void> {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')
    const allowed =
      role === Role.COORDINATOR || placement.studentId === userId || placement.tutorId === userId
    if (!allowed) throw new ForbiddenException('no tienes acceso a este placement')
  }

  /** Lista el libro de horas completo de un placement, más reciente primero. */
  listForPlacement(placementId: number) {
    return this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'desc' },
    })
  }

  /**
   * Aprueba o rechaza un registro de horas.
   *
   * Solo el tutor asignado al placement puede revisar sus horas (E3-01).
   * Solo se pueden revisar registros en estado SUBMITTED.
   */
  async review(id: number, status: HourLogStatus, reviewerId: number, note?: string) {
    const log = await this.prisma.hourLog.findUnique({
      where: { id },
      include: { placement: true },
    })
    if (!log) throw new NotFoundException('registro de horas no encontrado')
    if (log.placement.tutorId !== reviewerId) {
      throw new ForbiddenException('solo el tutor asignado a la práctica puede revisar sus horas')
    }
    if (log.status !== HourLogStatus.SUBMITTED) {
      throw new BadRequestException('solo se revisan registros en SUBMITTED')
    }
    return this.prisma.hourLog.update({
      where: { id },
      data: { status, reviewedById: reviewerId, reviewedAt: new Date(), reviewNote: note, version: { increment: 1 } },
    })
  }

  // ── Delegación a HourLogReportService ────────────────────────────────────

  approvedHours(placementId: number) {
    return this.report.approvedHours(placementId)
  }

  progressReport(placementId: number) {
    return this.report.progressReport(placementId)
  }

  weeklySummary(placementId: number) {
    return this.report.weeklySummary(placementId)
  }

  exportRows(placementId: number) {
    return this.report.exportRows(placementId)
  }
}
