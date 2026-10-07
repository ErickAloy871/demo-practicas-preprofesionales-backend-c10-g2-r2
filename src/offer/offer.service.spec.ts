import { BadRequestException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfferService } from './offer.service'

const prisma = {
  offer: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
  application: { count: vi.fn() },
  user: { findUnique: vi.fn() },
}

const COMPANY_ID = 7
const OWNER = 42
const FOREIGN_COMPANY_ID = 999

describe('OfferService', () => {
  let service: OfferService

  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findUnique.mockResolvedValue({ companyId: COMPANY_ID })
    service = new OfferService(prisma as never)
  })

  it('publishes a DRAFT offer of the authenticated company and stamps publishedAt', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: COMPANY_ID, status: 'DRAFT' })
    prisma.offer.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

    const result = await service.publish(1, OWNER, Role.COMPANY)

    expect(result.status).toBe('PUBLISHED')
    expect(result.publishedAt).toBeInstanceOf(Date)
  })

  it('rejects with 403 publishing an offer of another company (E3-01)', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID, status: 'DRAFT' })

    await expect(service.publish(1, OWNER, Role.COMPANY)).rejects.toMatchObject({ status: 403 })
    expect(prisma.offer.update).not.toHaveBeenCalled()
  })

  it('rejects with 403 closing an offer of another company (E3-01)', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID, status: 'PUBLISHED' })

    await expect(service.close(1, OWNER, Role.COMPANY)).rejects.toMatchObject({ status: 403 })
    expect(prisma.offer.update).not.toHaveBeenCalled()
  })

  it('lets the coordination publish and close an offer of any company', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID, status: 'DRAFT' })
    prisma.offer.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }))

    await expect(service.publish(1, 1, Role.COORDINATOR)).resolves.toMatchObject({ status: 'PUBLISHED' })
  })

  it('rejects publishing an offer that is not DRAFT', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: COMPANY_ID, status: 'CLOSED' })

    await expect(service.publish(1, OWNER, Role.COMPANY)).rejects.toThrow(BadRequestException)
  })

  it('rejects with 403 creating an offer for another company (E3-01)', async () => {
    await expect(service.create({ companyId: FOREIGN_COMPANY_ID } as never, OWNER, Role.COMPANY)).rejects.toMatchObject({
      status: 403,
    })
    expect(prisma.offer.create).not.toHaveBeenCalled()
  })

  it('creates a DRAFT offer for the own company', async () => {
    prisma.offer.create.mockImplementation(({ data }) => Promise.resolve({ id: 5, ...data }))

    const result = await service.create({ companyId: COMPANY_ID } as never, OWNER, Role.COMPANY)

    expect(result).toMatchObject({ companyId: COMPANY_ID, status: 'DRAFT' })
  })

  it('hides a DRAFT offer from a caller of another company (E3-01)', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID, status: 'DRAFT', company: {} })

    await expect(service.findOne(1, OWNER, Role.STUDENT)).rejects.toMatchObject({ status: 403 })
  })

  it('returns a PUBLISHED offer to any authenticated role', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: FOREIGN_COMPANY_ID, status: 'PUBLISHED', company: {} })

    await expect(service.findOne(1, OWNER, Role.STUDENT)).resolves.toMatchObject({ id: 1, status: 'PUBLISHED' })
  })

  it('lets the owner company read its own DRAFT', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: COMPANY_ID, status: 'DRAFT', company: {} })

    await expect(service.findOne(1, OWNER, Role.COMPANY)).resolves.toMatchObject({ id: 1, status: 'DRAFT' })
  })

  it('counts accepted applications for an offer', async () => {
    prisma.application.count.mockResolvedValue(3)

    await expect(service.acceptedCount(1)).resolves.toBe(3)
    expect(prisma.application.count).toHaveBeenCalledWith({
      where: { offerId: 1, status: 'ACCEPTED' },
    })
  })

  it('lists all offers of the company tied to the authenticated user, any status', async () => {
    prisma.offer.findMany.mockResolvedValue([{ id: 1, companyId: COMPANY_ID, status: 'DRAFT' }])

    const result = await service.findAllForCompanyUser(42)

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 42 }, select: { companyId: true } })
    expect(prisma.offer.findMany).toHaveBeenCalledWith({
      where: { companyId: COMPANY_ID },
      orderBy: { createdAt: 'desc' },
      include: { company: true, applications: { select: { status: true } } },
    })
    expect(result).toEqual([{ id: 1, companyId: COMPANY_ID, status: 'DRAFT' }])
  })

  it('rejects listing offers for a user with no company', async () => {
    prisma.user.findUnique.mockResolvedValue({ companyId: null })

    await expect(service.findAllForCompanyUser(42)).rejects.toThrow('el usuario no tiene una empresa asociada')
  })
})
