import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JwtAuthGuard } from './jwt-auth.guard'

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  const jwtService = { verifyAsync: vi.fn() }
  const authService = { isTokenInvalidated: vi.fn() }

  const mockExecutionContext = (authorization?: string) => {
    const request = { headers: { authorization } }
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as any
  }

  beforeEach(() => {
    vi.clearAllMocks()
    guard = new JwtAuthGuard(jwtService as any, authService as any)
  })

  it('throws UnauthorizedException if no token is provided', async () => {
    await expect(guard.canActivate(mockExecutionContext())).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException if the token is invalidated', async () => {
    authService.isTokenInvalidated.mockReturnValue(true)
    await expect(guard.canActivate(mockExecutionContext('Bearer invalidated-token'))).rejects.toThrow(UnauthorizedException)
  })

  it('throws UnauthorizedException if jwt verify fails', async () => {
    authService.isTokenInvalidated.mockReturnValue(false)
    jwtService.verifyAsync.mockRejectedValue(new Error('Invalid signature'))
    await expect(guard.canActivate(mockExecutionContext('Bearer invalid-token'))).rejects.toThrow(UnauthorizedException)
  })

  it('returns true and assigns user to request if token is valid and not invalidated', async () => {
    authService.isTokenInvalidated.mockReturnValue(false)
    jwtService.verifyAsync.mockResolvedValue({ sub: 1 })
    
    const context = mockExecutionContext('Bearer valid-token')
    const result = await guard.canActivate(context)
    
    expect(result).toBe(true)
    expect(context.switchToHttp().getRequest().user).toEqual({ sub: 1 })
  })
})
