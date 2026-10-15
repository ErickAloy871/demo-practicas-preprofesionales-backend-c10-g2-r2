import { NotFoundException } from '@nestjs/common'
import { HourLogStatus } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogReportService } from './hour-log.report.service'
import { HourLogValidationService } from './hour-log.validation.service'

const prisma = {
  hourLog: { findMany: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
  placement: { findUnique: vi.fn() },
}

const validation = new HourLogValidationService()

const BASE_PLACEMENT = {
  id: 1,
  requiredHours: 160,
  startDate: new Date('2026-03-02'),
  endDate: new Date('2026-06-27'),
}

describe('HourLogReportService', () => {
  let service: HourLogReportService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new HourLogReportService(prisma as never, validation)
  })

  // ─── approvedHours ────────────────────────────────────────────────────────

  describe('approvedHours', () => {
    it('returns 0 when there are no approved logs', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: null } })
      expect(await service.approvedHours(1)).toBe(0)
    })

    it('returns the correct sum of approved hours', async () => {
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 32 } })
      expect(await service.approvedHours(1)).toBe(32)
    })
  })

  // ─── progressReport ───────────────────────────────────────────────────────

  describe('progressReport', () => {
    it('throws NotFoundException when placement does not exist', async () => {
      prisma.placement.findUnique.mockResolvedValue(null)
      await expect(service.progressReport(99)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('returns the correct progress percentage', async () => {
      prisma.placement.findUnique.mockResolvedValue(BASE_PLACEMENT)
      prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 80 } })
      prisma.hourLog.count.mockResolvedValue(3)

      const report = await service.progressReport(1)

      expect(report.approvedHours).toBe(80)
      expect(report.pendingLogs).toBe(3)
      expect(report.percentage).toBe(50)
    })
  })

  // ─── weeklySummary ────────────────────────────────────────────────────────

  describe('weeklySummary', () => {
    it('throws NotFoundException when placement does not exist', async () => {
      prisma.placement.findUnique.mockResolvedValue(null)
      await expect(service.weeklySummary(99)).rejects.toBeInstanceOf(NotFoundException)
    })

    it('groups logs correctly by ISO week', async () => {
      prisma.placement.findUnique.mockResolvedValue(BASE_PLACEMENT)
      prisma.hourLog.findMany.mockResolvedValue([
        { date: new Date('2026-04-07'), status: HourLogStatus.APPROVED, hours: 8 },
        { date: new Date('2026-04-08'), status: HourLogStatus.SUBMITTED, hours: 4 },
        { date: new Date('2026-04-14'), status: HourLogStatus.APPROVED, hours: 6 },
      ])

      const summary = await service.weeklySummary(1)

      expect(summary).toHaveLength(2)
      expect(summary[0].week).toBe('2026-W15')
      expect(summary[0].approvedHours).toBe(8)
      expect(summary[0].submittedHours).toBe(4)
      expect(summary[1].week).toBe('2026-W16')
    })

    it('excludes logs that are not APPROVED or SUBMITTED', async () => {
      prisma.placement.findUnique.mockResolvedValue(BASE_PLACEMENT)
      prisma.hourLog.findMany.mockResolvedValue([
        { date: new Date('2026-04-07'), status: 'DRAFT', hours: 8 },
      ])

      const summary = await service.weeklySummary(1)
      expect(summary).toHaveLength(0)
    })
  })

  // ─── exportRows ───────────────────────────────────────────────────────────

  describe('exportRows', () => {
    it('generates header row, data rows and a totals row', async () => {
      prisma.hourLog.findMany.mockResolvedValue([
        {
          id: 1,
          date: new Date('2026-04-07'),
          startTime: '08:00',
          endTime: '12:00',
          hours: 4,
          activity: 'Desarrollo',
          status: HourLogStatus.APPROVED,
          reviewedById: 7,
        },
      ])

      const rows = await service.exportRows(1)

      expect(rows[0]).toEqual(['id', 'fecha', 'inicio', 'fin', 'horas', 'actividad', 'estado', 'revisadoPor'])
      expect(rows[1][4]).toBe(4)
      expect(rows[rows.length - 1][5]).toBe('TOTAL')
      expect(rows[rows.length - 1][4]).toBe(4)
    })

    it('escapes CSV fields containing commas', async () => {
      prisma.hourLog.findMany.mockResolvedValue([
        {
          id: 2,
          date: new Date('2026-04-08'),
          startTime: '09:00',
          endTime: '13:00',
          hours: 4,
          activity: 'Reunión, planificación',
          status: HourLogStatus.SUBMITTED,
          reviewedById: null,
        },
      ])

      const rows = await service.exportRows(1)
      expect(rows[1][5]).toBe('"Reunión, planificación"')
    })
  })
})
