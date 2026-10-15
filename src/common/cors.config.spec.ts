import { describe, expect, it } from 'vitest'
import { getAllowedCorsOrigins } from './cors.config'

describe('getAllowedCorsOrigins', () => {
  it('splits and trims configured origins for credentialed CORS', () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- HTTP loopback origins are required for local development
    expect(getAllowedCorsOrigins('http://localhost:5173, http://localhost:5174')).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
    ])
  })

  it('uses the default origin when the setting is missing or blank', () => {
    expect(getAllowedCorsOrigins(undefined)).toEqual(['http://localhost:5173'])
    expect(getAllowedCorsOrigins(' , ')).toEqual(['http://localhost:5173'])
  })
})
