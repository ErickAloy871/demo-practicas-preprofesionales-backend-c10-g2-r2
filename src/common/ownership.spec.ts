import { ForbiddenException } from '@nestjs/common'
import { Role } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { assertOwnership } from './ownership'

describe('assertOwnership', () => {
  it('lets the owner through', () => {
    expect(() => assertOwnership(true, Role.TUTOR, 'no es tuyo')).not.toThrow()
  })

  it('throws 403 when the caller is not the owner', () => {
    try {
      assertOwnership(false, Role.COMPANY, 'no es tuyo')
      throw new Error('assertOwnership debió lanzar ForbiddenException')
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException)
      expect((error as ForbiddenException).getStatus()).toBe(403)
    }
  })

  it('always lets the coordination through, even without ownership', () => {
    expect(() => assertOwnership(false, Role.COORDINATOR, 'no es tuyo')).not.toThrow()
  })
})
