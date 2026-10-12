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
  const response = { setHeader: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new AuthController(authService as never)
  })

  it('sets an HttpOnly refresh cookie and does not expose it in the login body', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'opaque-refresh-token',
      user: { id: 1, email: 'test@example.com' },
    })

    const result = await controller.login(
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- dummy request value for this controller test
      { email: 'test@example.com', password: 'password' },
      response,
    )

    expect(result).toEqual({
      accessToken: 'access-token',
      user: { id: 1, email: 'test@example.com' },
    })
    expect(response.setHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('refresh_token=opaque-refresh-token; HttpOnly; Path=/api/auth'),
    )
  })

  describe('refresh', () => {
    it('rotates the cookie value and returns only the access token', async () => {
      authService.refresh.mockResolvedValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      })

      const result = await controller.refresh(
        { headers: { cookie: 'other=value; refresh_token=old-refresh-token' } },
        response,
      )

      expect(result).toEqual({ accessToken: 'new-access-token' })
      expect(authService.refresh).toHaveBeenCalledWith('old-refresh-token')
      expect(response.setHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining('refresh_token=new-refresh-token'),
      )
    })

    it('throws UnauthorizedException if the refresh cookie is missing', async () => {
      await expect(controller.refresh({ headers: {} }, response)).rejects.toThrow(UnauthorizedException)
    })
  })

  describe('logout', () => {
    it('revokes the refresh session and clears the cookie', async () => {
      const result = await controller.logout(
        { headers: { authorization: 'Bearer access-token', cookie: 'refresh_token=refresh-token' } },
        response,
      )

      expect(result).toEqual({ success: true })
      expect(authService.logout).toHaveBeenCalledWith('refresh-token', 'access-token')
      expect(response.setHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining('refresh_token=; HttpOnly; Path=/api/auth'),
      )
    })

    it('clears the cookie even if no refresh token is present', async () => {
      await expect(controller.logout({ headers: {} }, response)).resolves.toEqual({ success: true })
      expect(authService.logout).toHaveBeenCalledWith(undefined, undefined)
    })
  })
})
