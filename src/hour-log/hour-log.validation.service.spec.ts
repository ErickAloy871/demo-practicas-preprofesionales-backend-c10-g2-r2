import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { HourLogValidationService } from './hour-log.validation.service'

describe('HourLogValidationService', () => {
  let service: HourLogValidationService

  beforeEach(() => {
    service = new HourLogValidationService()
  })

  describe('validateHourRange', () => {
    it('does not throw for a valid hour count', () => {
      expect(() => service.validateHourRange(4)).not.toThrow()
      expect(() => service.validateHourRange(0.5)).not.toThrow()
      expect(() => service.validateHourRange(10)).not.toThrow()
    })

    it('throws BadRequestException when hours are 0 or negative', () => {
      expect(() => service.validateHourRange(0)).toThrow(BadRequestException)
      expect(() => service.validateHourRange(-1)).toThrow(BadRequestException)
    })

    it('throws BadRequestException when hours exceed 10', () => {
      expect(() => service.validateHourRange(11)).toThrow(BadRequestException)
      expect(() => service.validateHourRange(10.1)).toThrow(BadRequestException)
    })

    it('throws with the canonical business message', () => {
      expect(() => service.validateHourRange(11)).toThrow('las horas deben estar entre 0 y 10')
    })
  })

  describe('validateTimeRange', () => {
    it('does not throw when startTime is before endTime', () => {
      expect(() => service.validateTimeRange('08:00', '12:00')).not.toThrow()
      expect(() => service.validateTimeRange('08:00', '08:01')).not.toThrow()
    })

    it('throws BadRequestException when startTime equals endTime', () => {
      expect(() => service.validateTimeRange('09:00', '09:00')).toThrow(BadRequestException)
    })

    it('throws BadRequestException when startTime is after endTime', () => {
      expect(() => service.validateTimeRange('13:00', '08:00')).toThrow(BadRequestException)
    })

    it('throws with the canonical business message', () => {
      expect(() => service.validateTimeRange('12:00', '08:00')).toThrow(
        'la hora de inicio debe ser anterior a la de fin',
      )
    })
  })
})
