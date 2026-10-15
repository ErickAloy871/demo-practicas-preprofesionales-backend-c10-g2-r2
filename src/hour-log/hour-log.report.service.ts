import { Injectable, NotFoundException } from '@nestjs/common'
import { HourLogStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { HourLogValidationService } from './hour-log.validation.service'

/**
 * Agrega métricas y exporta el libro de horas de un placement.
 *
 * Propósito único: leer datos del libro de horas y transformarlos en
 * reportes (progreso, resumen semanal, filas CSV). No persiste ni
 * notifica nada.
 */
@Injectable()
export class HourLogReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: HourLogValidationService,
  ) {}

  /** Suma las horas ya APPROVED de un placement. */
  async approvedHours(placementId: number): Promise<number> {
    const result = await this.prisma.hourLog.aggregate({
      where: { placementId, status: HourLogStatus.APPROVED, deletedAt: null },
      _sum: { hours: true },
    })
    return result._sum.hours ?? 0
  }

  /**
   * Reporte de avance: horas requeridas, aprobadas, pendientes y porcentaje.
   */
  async progressReport(placementId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')

    const approved = await this.approvedHours(placementId)
    const pending = await this.prisma.hourLog.count({
      where: { placementId, status: HourLogStatus.SUBMITTED, deletedAt: null },
    })
    return {
      placementId,
      requiredHours: placement.requiredHours,
      approvedHours: approved,
      pendingLogs: pending,
      percentage: Math.round((approved / placement.requiredHours) * 100),
    }
  }

  /**
   * Resumen semana a semana de horas aprobadas y enviadas para un placement.
   */
  async weeklySummary(placementId: number) {
    const placement = await this.prisma.placement.findUnique({ where: { id: placementId } })
    if (!placement) throw new NotFoundException('placement no encontrado')

    const logs = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'asc' },
    })

    const totalDays = Math.max(
      1,
      Math.ceil((placement.endDate.getTime() - placement.startDate.getTime()) / 86400000),
    )
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7))
    const expectedHoursPerWeek = placement.requiredHours / totalWeeks

    const buckets = new Map<string, { approvedHours: number; submittedHours: number; logsCount: number }>()

    for (const log of logs) {
      if (log.status !== HourLogStatus.APPROVED && log.status !== HourLogStatus.SUBMITTED) continue

      const week = this.isoWeekLabel(log.date)
      const bucket = buckets.get(week) ?? { approvedHours: 0, submittedHours: 0, logsCount: 0 }

      if (log.status === HourLogStatus.APPROVED) {
        bucket.approvedHours += log.hours
      } else {
        bucket.submittedHours += log.hours
      }
      bucket.logsCount += 1
      buckets.set(week, bucket)
    }

    const summary = Array.from(buckets.entries()).map(([week, bucket]) => ({
      week,
      approvedHours: bucket.approvedHours,
      submittedHours: bucket.submittedHours,
      logsCount: bucket.logsCount,
      expectedHoursPercentage:
        expectedHoursPerWeek > 0 ? Math.round((bucket.approvedHours / expectedHoursPerWeek) * 100) : 0,
    }))

    summary.sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0))
    return summary
  }

  /** Exporta el libro de horas como filas listas para serializar a CSV. */
  async exportRows(placementId: number): Promise<(string | number)[][]> {
    const logs = await this.prisma.hourLog.findMany({
      where: { placementId, deletedAt: null },
      orderBy: { date: 'asc' },
    })

    const header = ['id', 'fecha', 'inicio', 'fin', 'horas', 'actividad', 'estado', 'revisadoPor']
    const rows: (string | number)[][] = [header]

    for (const log of logs) {
      this.validation.validateHourRange(log.hours)
      this.validation.validateTimeRange(log.startTime, log.endTime)
      rows.push([
        log.id,
        log.date.toISOString().slice(0, 10),
        log.startTime,
        log.endTime,
        log.hours,
        this.escapeCsvField(log.activity),
        log.status,
        log.reviewedById ?? '',
      ])
    }

    let totalHours = 0
    for (const row of rows.slice(1)) {
      if (typeof row[4] === 'number') totalHours += row[4]
    }
    rows.push(['', '', '', '', totalHours, 'TOTAL', '', ''])
    return rows
  }

  /** Calcula la etiqueta de semana ISO 8601 (ej. "2026-W14") para una fecha. */
  private isoWeekLabel(date: Date): string {
    const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const isoDayNumber = copy.getUTCDay() === 0 ? 7 : copy.getUTCDay()
    copy.setUTCDate(copy.getUTCDate() + 4 - isoDayNumber)
    const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1))
    const weekNumber = Math.ceil(((copy.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
    return `${copy.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`
  }

  /** Escapa un campo CSV según RFC 4180 mínimo viable. */
  private escapeCsvField(value: string): string {
    const needsQuoting = value.includes(',') || value.includes('"') || value.includes('\n')
    return needsQuoting ? `"${value.replace(/"/g, '""')}"` : value
  }
}
