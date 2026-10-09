import { UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from './auth.service'

// Smell deliberado: mockeamos PrismaService completo, así que estos tests
// no ejercitan SQL real y no detectan N+1 ni races.
const prisma = { user: { findUnique: vi.fn() } }
const jwt = { 
  signAsync: vi.fn().mockResolvedValue('token-firmado'),
  verifyAsync: vi.fn().mockResolvedValue({ sub: 1, email: 'tutor0@miyura.com', role: 'TUTOR' })
}

describe('AuthService.login', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuthService(prisma as never, jwt as never)
  })

  it('returns an access token and the user for valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', password: await bcrypt.hash('yura1234', 10),
      fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    const result = await service.login('tutor0@miyura.com', 'yura1234')

    expect(result.accessToken).toBe('token-firmado')
    expect(result.user).toEqual({ id: 1, email: 'tutor0@miyura.com', fullName: 'Tutor Académico 0', role: 'TUTOR' })
  })

  it('includes companyId for a COMPANY user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 2, email: 'empresa0@miyura.com', password: await bcrypt.hash('yura1234', 10),
      fullName: 'Empresa 0', role: 'COMPANY', companyId: 1,
    })

    const result = await service.login('empresa0@miyura.com', 'yura1234')

    expect(result.user).toEqual({
      id: 2, email: 'empresa0@miyura.com', fullName: 'Empresa 0', role: 'COMPANY', companyId: 1,
    })
  })

  it('throws Unauthorized when the password does not match', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', password: await bcrypt.hash('otra', 10),
      fullName: 'Tutor Académico 0', role: 'TUTOR',
    })

    await expect(service.login('tutor0@miyura.com', 'yura1234')).rejects.toThrow(UnauthorizedException)
  })
})

describe('AuthService.refresh', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuthService(prisma as never, jwt as never)
  })

  it('renews the session and invalidates the previous token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 1, email: 'tutor0@miyura.com', role: 'TUTOR' })
    prisma.user.findUnique.mockResolvedValue({
      id: 1, email: 'tutor0@miyura.com', role: 'TUTOR',
    })

    const oldToken = 'old-token'
    const result = await service.refresh(oldToken)

    expect(result.accessToken).toBe('token-firmado')
    expect(jwt.verifyAsync).toHaveBeenCalledWith(oldToken, { ignoreExpiration: true })
    expect(service.isTokenInvalidated(oldToken)).toBe(true)
  })

  it('throws Unauthorized when trying to renew an already invalidated token', async () => {
    const token = 'already-invalidated-token'
    service.logout(token)

    await expect(service.refresh(token)).rejects.toThrow(UnauthorizedException)
    await expect(service.refresh(token)).rejects.toThrow('token ya fue invalidado')
  })

  it('throws Unauthorized if the token is invalid (not just expired)', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('Invalid token'))
    await expect(service.refresh('invalid-token')).rejects.toThrow(UnauthorizedException)
  })
})
