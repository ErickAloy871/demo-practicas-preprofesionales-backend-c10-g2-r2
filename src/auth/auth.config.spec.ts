import { JwtService } from '@nestjs/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCESS_TOKEN_TTL_SECONDS, parseDurationSeconds } from './auth.config'

afterEach(() => vi.useRealTimers())

describe('access token expiration', () => {
  it('includes exp in the JWT and rejects it after its configured lifetime', async () => {
    vi.useFakeTimers()
    const jwt = new JwtService({
      secret: 'test-secret',
      signOptions: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    })

    const token = await jwt.signAsync({ sub: 1 })
    const payload = jwt.decode(token) as { iat: number; exp: number }

    expect(payload.exp).toBe(payload.iat + ACCESS_TOKEN_TTL_SECONDS)
    vi.setSystemTime(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000 + 1)
    await expect(jwt.verifyAsync(token)).rejects.toThrow()
  })

  it('accepts configurable durations in seconds, minutes, hours, and days', () => {
    expect(parseDurationSeconds('30', '15m')).toBe(30)
    expect(parseDurationSeconds('2m', '15m')).toBe(120)
    expect(parseDurationSeconds('1h', '15m')).toBe(3600)
    expect(parseDurationSeconds('1d', '15m')).toBe(86400)
  })
})
