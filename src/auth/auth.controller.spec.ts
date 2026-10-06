import { UnauthorizedException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthController } from './auth.controller'

describe('AuthController', () => {
  let controller: AuthController
  const authService = {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new AuthController(authService as any)
  })

  it('login calls authService.login', async () => {
    authService.login.mockResolvedValue({ accessToken: 'token' })
    const result = await controller.login({ email: 'test@example.com', password: 'password' })
    expect(result).toEqual({ accessToken: 'token' })
    expect(authService.login).toHaveBeenCalledWith('test@example.com', 'password')
  })

  describe('refresh', () => {
    it('calls authService.refresh with extracted token', async () => {
      authService.refresh.mockResolvedValue({ accessToken: 'new-token' })
      const req = { headers: { authorization: 'Bearer my-token' } }
      const result = await controller.refresh(req)
      expect(result).toEqual({ accessToken: 'new-token' })
      expect(authService.refresh).toHaveBeenCalledWith('my-token')
    })

    it('throws UnauthorizedException if token is missing', async () => {
      const req = { headers: {} }
      expect(() => controller.refresh(req)).toThrow(UnauthorizedException)
    })
  })

  describe('logout', () => {
    it('calls authService.logout with extracted token', () => {
      const req = { headers: { authorization: 'Bearer my-token' } }
      const result = controller.logout(req)
      expect(result).toEqual({ success: true })
      expect(authService.logout).toHaveBeenCalledWith('my-token')
    })

    it('returns success true even if token is missing', () => {
      const req = { headers: {} }
      const result = controller.logout(req)
      expect(result).toEqual({ success: true })
      expect(authService.logout).not.toHaveBeenCalled()
    })
  })
})
