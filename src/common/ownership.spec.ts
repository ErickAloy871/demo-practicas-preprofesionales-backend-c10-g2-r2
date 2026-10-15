import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCompanyScope, assertOfferScope, assertOwnership } from './ownership'

const COMPANY_ID = 7
const USER_ID = 42
const prisma = { user: { findUnique: vi.fn() }, offer: { findUnique: vi.fn() } }

describe('assertOwnership', () => {
  it('lets the owner and the coordination through and rejects anyone else with 403', () => {
    expect(() => assertOwnership(true, Role.TUTOR, 'no es tuyo')).not.toThrow()
    expect(() => assertOwnership(false, Role.COORDINATOR, 'no es tuyo')).not.toThrow()

    const error: unknown = (() => {
      try {
        assertOwnership(false, Role.COMPANY, 'no es tuyo')
        return null
      } catch (thrown) {
        return thrown
      }
    })()
    expect(error).toBeInstanceOf(ForbiddenException)
    expect((error as ForbiddenException).getStatus()).toBe(403)
  })
})

describe('assertCompanyScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findUnique.mockResolvedValue({ companyId: COMPANY_ID })
  })

  it('compares the caller company against the resource company', async () => {
    await expect(assertCompanyScope(prisma as never, COMPANY_ID, USER_ID, Role.COMPANY, 'no es tuya')).resolves.toBeUndefined()
    await expect(assertCompanyScope(prisma as never, 999, USER_ID, Role.COMPANY, 'no es tuya')).rejects.toMatchObject({ status: 403 })
  })
})

describe('assertOfferScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.user.findUnique.mockResolvedValue({ companyId: COMPANY_ID })
  })

  it('returns an offer of the caller company', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: COMPANY_ID })
    await expect(assertOfferScope(prisma as never, 1, USER_ID, Role.COMPANY, 'no es tuya')).resolves.toMatchObject({ id: 1 })
  })

  it('rejects with 403 an offer of another company and with 404 a missing one', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 1, companyId: 999 })
    await expect(assertOfferScope(prisma as never, 1, USER_ID, Role.COMPANY, 'no es tuya')).rejects.toMatchObject({ status: 403 })

    prisma.offer.findUnique.mockResolvedValue(null)
    await expect(assertOfferScope(prisma as never, 1, USER_ID, Role.COMPANY, 'no es tuya')).rejects.toBeInstanceOf(NotFoundException)
  })
})
