import { UnauthorizedException } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService } from './auth.service'

const prisma = {
  user: { findUnique: vi.fn() },
  authSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}
const jwt = {
  signAsync: vi.fn().mockResolvedValue('token-firmado'),
  verifyAsync: vi.fn(),
}

describe('AuthService.login', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuthService(prisma as never, jwt as never)
  })

  it('creates a persisted session and returns an access token for valid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'tutor0@miyura.com',
      password: await bcrypt.hash('yura1234', 10),
      fullName: 'Tutor Académico 0',
      role: 'TUTOR',
      companyId: null,
    })
    prisma.authSession.create.mockResolvedValue({ id: 'session-1', tokenVersion: 0 })

    const result = await service.login('tutor0@miyura.com', 'yura1234')

    expect(result.accessToken).toBe('token-firmado')
    expect(result.user).toEqual({
      id: 1,
      email: 'tutor0@miyura.com',
      fullName: 'Tutor Académico 0',
      role: 'TUTOR',
      companyId: null,
    })
    expect(result.refreshToken).toMatch(/^[\w-]{40,}$/)
    expect(prisma.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 1,
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    })
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 1,
      email: 'tutor0@miyura.com',
      role: 'TUTOR',
      sid: 'session-1',
      ver: 0,
    })
  })

  it('includes companyId for a COMPANY user', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 2,
      email: 'empresa0@miyura.com',
      password: await bcrypt.hash('yura1234', 10),
      fullName: 'Empresa 0',
      role: 'COMPANY',
      companyId: 1,
    })
    prisma.authSession.create.mockResolvedValue({ id: 'session-2', tokenVersion: 0 })

    const result = await service.login('empresa0@miyura.com', 'yura1234')

    expect(result.user).toEqual({
      id: 2,
      email: 'empresa0@miyura.com',
      fullName: 'Empresa 0',
      role: 'COMPANY',
      companyId: 1,
    })
  })

  it('throws Unauthorized when the password does not match', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      email: 'tutor0@miyura.com',
      password: await bcrypt.hash('otra', 10),
      fullName: 'Tutor Académico 0',
      role: 'TUTOR',
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

  it('rotates the refresh token and invalidates the previous access token version', async () => {
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tokenVersion: 3,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 1, email: 'tutor0@miyura.com', role: 'TUTOR' },
    })
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

    const result = await service.refresh('old-refresh-token')

    expect(result.accessToken).toBe('token-firmado')
    expect(result.refreshToken).not.toBe('old-refresh-token')
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: 1,
      email: 'tutor0@miyura.com',
      role: 'TUTOR',
      sid: 'session-1',
      ver: 4,
    })
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'session-1',
        refreshTokenHash: expect.any(String),
        tokenVersion: 3,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      }),
      data: expect.objectContaining({
        refreshTokenHash: expect.any(String),
        tokenVersion: { increment: 1 },
        expiresAt: expect.any(Date),
      }),
    })
  })

  it('rejects an expired refresh session', async () => {
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'expired-session',
      tokenVersion: 0,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1),
      user: { id: 1, email: 'tutor0@miyura.com', role: 'TUTOR' },
    })

    await expect(service.refresh('expired-refresh-token')).rejects.toThrow(UnauthorizedException)
    expect(prisma.authSession.updateMany).not.toHaveBeenCalled()
    expect(jwt.signAsync).not.toHaveBeenCalled()
  })

  it('rejects a refresh token that has already been rotated', async () => {
    prisma.authSession.findUnique.mockResolvedValue(null)
    await expect(service.refresh('old-refresh-token')).rejects.toThrow(UnauthorizedException)
  })

  it('rejects a refresh token when another request already rotated it', async () => {
    prisma.authSession.findUnique.mockResolvedValue({
      id: 'session-1',
      tokenVersion: 3,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: 1, email: 'tutor0@miyura.com', role: 'TUTOR' },
    })
    prisma.authSession.updateMany.mockResolvedValue({ count: 0 })

    await expect(service.refresh('racing-refresh-token')).rejects.toThrow(UnauthorizedException)
  })
})

describe('AuthService sessions', () => {
  let service: AuthService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new AuthService(prisma as never, jwt as never)
  })

  it('accepts only active, current session versions', async () => {
    prisma.authSession.findUnique.mockResolvedValue({
      tokenVersion: 2,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    })

    await expect(service.isSessionActive('session-1', 2)).resolves.toBe(true)
    await expect(service.isSessionActive('session-1', 1)).resolves.toBe(false)
  })

  it('revokes the stored session on logout', async () => {
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

    await service.logout('refresh-token')

    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { refreshTokenHash: expect.any(String), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('can revoke a rotated session from its signed access token during logout', async () => {
    jwt.verifyAsync.mockResolvedValue({ sid: 'session-1' })
    prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

    await service.logout(undefined, 'expired-signed-access-token')

    expect(jwt.verifyAsync).toHaveBeenCalledWith('expired-signed-access-token', { ignoreExpiration: true })
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })
})
