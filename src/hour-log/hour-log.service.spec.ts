import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogService } from './hour-log.service'

const prisma = {
  hourLog: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), aggregate: vi.fn() },
  placement: { findUnique: vi.fn() },
}

describe('HourLogService', () => {
  let service: HourLogService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 0 } })
    service = new HourLogService(prisma as never)
  })

  it('creates an hour log in SUBMITTED for an active placement', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })
    prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.create(
      { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '12:00', hours: 4, activity: 'Desarrollo de módulo de reportes' },
      5,
    )

    expect(result.status).toBe('SUBMITTED')
    expect(result.hours).toBe(4)
  })

  it('allows exactly eight accumulated hours in a day', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 7.5 } })
    prisma.hourLog.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    await expect(
      service.create(
        { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '08:30', hours: 0.5, activity: 'Cierre diario' },
        5,
      ),
    ).resolves.toMatchObject({ hours: 0.5 })
  })

  it('rejects a new activity that would make the student exceed eight hours in a day', async () => {
    prisma.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5, tutorId: 7, status: 'ACTIVE' })
    prisma.hourLog.aggregate.mockResolvedValue({ _sum: { hours: 7.5 } })

    await expect(
      service.create(
        { placementId: 1, date: new Date('2026-04-01'), startTime: '08:00', endTime: '09:00', hours: 1, activity: 'Jornada adicional' },
        5,
      ),
    ).rejects.toThrow('No puedes registrar más de 8 horas en un mismo día')
    expect(prisma.hourLog.create).not.toHaveBeenCalled()
  })

  it('approves a submitted hour log when the caller is the assigned tutor', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { tutorId: 7 },
    })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.review(99, 'APPROVED' as never, 7, 'ok')

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(7)
  })

  it('rejects with 403 the tutor that is not assigned, on approval and on rejection (E3-01)', async () => {
    // El hour-log 99 vive en el placement del tutor 7; el tutor 8 no lo tutoriza.
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { tutorId: 7 },
    })

    const error = await service.review(99, 'APPROVED' as never, 8, undefined).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ForbiddenException)
    expect((error as ForbiddenException).getStatus()).toBe(403)
    await expect(service.review(99, 'REJECTED' as never, 8, 'no corresponde')).rejects.toMatchObject({ status: 403 })
    expect(prisma.hourLog.update).not.toHaveBeenCalled()
  })

  it('lets the assigned tutor reject a submitted hour log', async () => {
    prisma.hourLog.findUnique.mockResolvedValue({
      id: 99,
      placementId: 1,
      status: 'SUBMITTED',
      version: 1,
      placement: { tutorId: 7 },
    })
    prisma.hourLog.update.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }))

    const result = await service.review(99, 'REJECTED' as never, 7, 'faltó detalle de la actividad')

    expect(result.status).toBe('REJECTED')
    expect(result.reviewNote).toBe('faltó detalle de la actividad')
  })
})
