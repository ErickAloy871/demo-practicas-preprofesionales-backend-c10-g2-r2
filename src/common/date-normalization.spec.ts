import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  formatDateIso,
  getInstitutionTimezone,
  getTodayInTimezone,
  normalizeHourLogDate,
} from './date-normalization'

describe('date-normalization', () => {
  it('returns default institution timezone America/Guayaquil', () => {
    expect(getInstitutionTimezone()).toBe('America/Guayaquil')
  })

  it('formats dates in ISO YYYY-MM-DD from UTC components', () => {
    const d = new Date(Date.UTC(2026, 3, 15))
    expect(formatDateIso(d)).toBe('2026-04-15')
  })

  it('calculates start of today in institution timezone', () => {
    const fakeNow = new Date('2026-10-14T23:30:00.000Z') // 18:30 in America/Guayaquil (UTC-5)
    const today = getTodayInTimezone('America/Guayaquil', fakeNow)
    expect(formatDateIso(today)).toBe('2026-10-14')
    expect(today.getUTCHours()).toBe(0)
    expect(today.getUTCMinutes()).toBe(0)
  })

  describe('normalizeHourLogDate', () => {
    it('normalizes string YYYY-MM-DD to canonical UTC midnight', () => {
      const normalized = normalizeHourLogDate('2026-04-15')
      expect(formatDateIso(normalized)).toBe('2026-04-15')
      expect(normalized.toISOString()).toBe('2026-04-15T00:00:00.000Z')
    })

    it('normalizes already UTC midnight Date preserving calendar day', () => {
      const input = new Date('2026-04-15')
      const normalized = normalizeHourLogDate(input)
      expect(formatDateIso(normalized)).toBe('2026-04-15')
      expect(normalized.toISOString()).toBe('2026-04-15T00:00:00.000Z')
    })

    it('normalizes local midnight string with timezone offsets without date shifting', () => {
      // Un datepicker en Tokio (UTC+9) envía medianoche local
      const tokyo = normalizeHourLogDate('2026-04-15T00:00:00+09:00')
      expect(formatDateIso(tokyo)).toBe('2026-04-15')

      // Un datepicker en Ecuador (UTC-5) envía medianoche local
      const ecuador = normalizeHourLogDate('2026-04-15T00:00:00-05:00')
      expect(formatDateIso(ecuador)).toBe('2026-04-15')

      // Un datepicker en España (UTC+2) envía medianoche local
      const madrid = normalizeHourLogDate('2026-04-15T00:00:00+02:00')
      expect(formatDateIso(madrid)).toBe('2026-04-15')

      // Un datepicker en California (UTC-7) envía medianoche local
      const la = normalizeHourLogDate('2026-04-15T00:00:00-07:00')
      expect(formatDateIso(la)).toBe('2026-04-15')
    })

    it('projects late-night local instants in Ecuador (UTC-5) without falling on the next UTC day', () => {
      // 8:00 PM (20:00) en Ecuador el 15 de abril corresponde a 01:00 UTC del 16 de abril
      const lateNightEcuador = new Date('2026-04-15T20:00:00-05:00')
      expect(lateNightEcuador.toISOString()).toBe('2026-04-16T01:00:00.000Z')

      const normalized = normalizeHourLogDate(lateNightEcuador, 'America/Guayaquil')
      expect(formatDateIso(normalized)).toBe('2026-04-15')
      expect(normalized.toISOString()).toBe('2026-04-15T00:00:00.000Z')
    })

    it('respects a configurable institution timezone', () => {
      // Mismo instante analizado en dos zonas horarias institucionales distintas
      const instant = new Date('2026-04-15T23:30:00.000Z')

      // En Ecuador (UTC-5), eran las 18:30 del 15 de abril
      const ecuador = normalizeHourLogDate(instant, 'America/Guayaquil')
      expect(formatDateIso(ecuador)).toBe('2026-04-15')

      // En Tokio (UTC+9), eran las 08:30 del 16 de abril
      const tokyo = normalizeHourLogDate(instant, 'Asia/Tokyo')
      expect(formatDateIso(tokyo)).toBe('2026-04-16')
    })

    it('rejects invalid or null dates with BadRequestException', () => {
      expect(() => normalizeHourLogDate('')).toThrow(BadRequestException)
      expect(() => normalizeHourLogDate('fecha-invalida')).toThrow(BadRequestException)
      expect(() => normalizeHourLogDate(new Date('invalid'))).toThrow(BadRequestException)
      expect(() => normalizeHourLogDate(null)).toThrow(BadRequestException)
      expect(() => normalizeHourLogDate(undefined)).toThrow(BadRequestException)
      expect(() => normalizeHourLogDate(new Date('2026-04-15T15:00:00Z'), 'Zona/Invalida')).toThrow(BadRequestException)
      expect(() => normalizeHourLogDate(12345 as never)).toThrow(BadRequestException)
    })
  })
})
