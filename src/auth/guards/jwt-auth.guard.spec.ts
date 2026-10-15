import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JwtAuthGuard } from './jwt-auth.guard'

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  const jwtService = { verifyAsync: vi.fn() }
  const authService = { isSessionActive: vi.fn() }

  const mockExecutionContext = (authorization?: string) => {
    const request = { headers: { authorization } }
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as never
  }

  beforeEach(() => {
    vi.clearAllMocks()
    guard = new JwtAuthGuard(jwtService as never, authService as never)
  })

  it('throws UnauthorizedException if no token is provided', async () => {
    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(UnauthorizedException)
  })

  it('rejects an expired access token', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'))
    await expect(guard.canActivate(mockExecutionContext('Bearer expired-token'))).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException if jwt verification fails', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('Invalid signature'))
    await expect(guard.canActivate(mockExecutionContext('Bearer invalid-token'))).rejects.toThrow(UnauthorizedException)
  })

  it('returns true and assigns user to request if the access token session is active', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 1, sid: 'session-1', ver: 0 })
    authService.isSessionActive.mockResolvedValue(true)

    const context = mockExecutionContext('Bearer valid-token') as {
      switchToHttp: () => { getRequest: () => { user?: unknown } }
    }
    const result = await guard.canActivate(context as never)

    expect(result).toBe(true)
    expect(context.switchToHttp().getRequest().user).toEqual({ sub: 1, sid: 'session-1', ver: 0 })
  })

  it('rejects an access token from a rotated session version', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 1, sid: 'session-1', ver: 0 })
    authService.isSessionActive.mockResolvedValue(false)

    await expect(guard.canActivate(mockExecutionContext('Bearer old-token'))).rejects.toThrow(UnauthorizedException)
  })
})
