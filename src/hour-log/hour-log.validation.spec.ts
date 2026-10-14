import { describe, expect, it } from 'vitest'
import {
  HOUR_LOG_DAILY_HOURS_LIMIT,
  HOUR_LOG_DAILY_LIMIT_MESSAGE,
  dailyHourLogsWhere,
  exceedsDailyHourLimit,
  validateHourLogValues,
} from './hour-log.validation'

describe('hour-log validation', () => {
  it('keeps the configured daily limit at eight hours', () => {
    expect(HOUR_LOG_DAILY_HOURS_LIMIT).toBe(8)
  })

  it.each([
    [7.5, 0.5, false],
    [8, 0, false],
    [7.5, 1, true],
    [8, 0.5, true],
  ])('evaluates the daily boundary for %s existing hours and %s new hours', (existing, added, expected) => {
    expect(exceedsDailyHourLimit(existing, added)).toBe(expected)
  })

  it('uses the same message for a single activity that exceeds the daily limit', () => {
    expect(exceedsDailyHourLimit(0, 8.5)).toBe(true)
    expect(HOUR_LOG_DAILY_LIMIT_MESSAGE).toBe('No puedes registrar más de 8 horas en un mismo día')
  })

  it('counts the student’s logs across placements and excludes deleted rows', () => {
    expect(dailyHourLogsWhere(5, new Date('2026-04-01'))).toMatchObject({
      deletedAt: null,
      placement: { studentId: 5 },
      date: { gte: new Date('2026-04-01T00:00:00.000Z'), lt: new Date('2026-04-02T00:00:00.000Z') },
    })
  })

  it('rejects values below the established minimum and reversed hours', () => {
    expect(validateHourLogValues({ date: new Date('2026-04-01'), hours: 0.25, startTime: '08:00', endTime: '09:00' })).toBe(
      'Las horas deben ser de al menos 0.5',
    )
    expect(validateHourLogValues({ date: new Date('2026-04-01'), hours: 1, startTime: '09:00', endTime: '09:00' })).toBe(
      'La hora de fin debe ser posterior a la de inicio',
    )
  })
})
