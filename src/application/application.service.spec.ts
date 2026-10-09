import { BadRequestException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationService } from './application.service'

const prisma = {
  application: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  offer: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
}
const offers = { acceptedCount: vi.fn() }

const COMPANY_ID = 7
const OWNER = 42
const FOREIGN_COMPANY_ID = 999

describe('ApplicationService', () => {
  let service: ApplicationService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findUnique.mockResolvedValue({ companyId: COMPANY_ID })
    service = new ApplicationService(prisma as never, offers as never)
  })

  it('accepts an application when there are seats left', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, studentId: 10, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED', companyId: COMPANY_ID })
    offers.acceptedCount.mockResolvedValue(2)
    prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 7, ...data }))

    const result = await service.decide(7, 'ACCEPTED' as never, OWNER, Role.COMPANY)

    expect(result.status).toBe('ACCEPTED')
    expect(result.decidedAt).toBeInstanceOf(Date)
  })

  it('rejects accepting when the offer is already full', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, studentId: 10, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED', companyId: COMPANY_ID })
    offers.acceptedCount.mockResolvedValue(3)

    await expect(service.decide(7, 'ACCEPTED' as never, OWNER, Role.COMPANY)).rejects.toThrow(BadRequestException)
  })

  it('rejects with 403 deciding an application of another company (E3-01)', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, studentId: 10, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED', companyId: FOREIGN_COMPANY_ID })

    await expect(service.decide(7, 'REJECTED' as never, OWNER, Role.COMPANY)).rejects.toMatchObject({ status: 403 })
    expect(prisma.application.update).not.toHaveBeenCalled()
  })

  it('lets the coordination decide on an application of any company', async () => {
    prisma.application.findUnique.mockResolvedValue({ id: 7, offerId: 1, studentId: 10, status: 'SUBMITTED' })
    prisma.offer.findUnique.mockResolvedValue({ id: 1, seats: 3, status: 'PUBLISHED', companyId: FOREIGN_COMPANY_ID })
    prisma.application.update.mockImplementation(({ data }) => Promise.resolve({ id: 7, ...data }))

    await expect(service.decide(7, 'REJECTED' as never, 1, Role.COORDINATOR)).resolves.toMatchObject({
      status: 'REJECTED',
    })
  })

  it('lists applications of an own offer with their student', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: COMPANY_ID })
    prisma.application.findMany.mockResolvedValue([
      { id: 1, studentId: 10, status: 'SUBMITTED' },
      { id: 2, studentId: 11, status: 'SUBMITTED' },
    ])
    prisma.user.findUnique
      .mockResolvedValueOnce({ companyId: COMPANY_ID })
      .mockResolvedValueOnce({ id: 10, fullName: 'Estudiante 10' })
      .mockResolvedValueOnce({ id: 11, fullName: 'Estudiante 11' })

    const result = await service.listByOffer(1, OWNER, Role.COMPANY)

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 1, student: { fullName: 'Estudiante 10' } })
  })

  it('rejects with 403 listing the applications of another company (E3-01)', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID })

    await expect(service.listByOffer(1, OWNER, Role.COMPANY)).rejects.toMatchObject({ status: 403 })
    expect(prisma.application.findMany).not.toHaveBeenCalled()
  })

  it('lets the coordination list applications of any company', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID })
    prisma.application.findMany.mockResolvedValue([{ id: 1, studentId: 10, status: 'SUBMITTED' }])
    prisma.user.findUnique
      .mockResolvedValueOnce({ companyId: FOREIGN_COMPANY_ID }) 
      .mockResolvedValueOnce({ id: 10, fullName: 'Estudiante 10' })

    const result = await service.listByOffer(1, 1, Role.COORDINATOR)

    expect(result).toHaveLength(1)
  })
})
