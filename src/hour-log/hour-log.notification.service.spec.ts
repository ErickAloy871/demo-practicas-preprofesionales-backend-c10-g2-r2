import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HourLogNotificationService } from './hour-log.notification.service'

describe('HourLogNotificationService', () => {
  let service: HourLogNotificationService
  let loggerSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new HourLogNotificationService()
    loggerSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  it('calls the logger with tutor id and hour-log id', () => {
    service.notifyTutor(7, 99)

    expect(loggerSpy).toHaveBeenCalledOnce()
    expect(loggerSpy).toHaveBeenCalledWith('tutor 7: nueva hora registrada #99')
  })

  it('does not throw when called with valid ids', () => {
    expect(() => service.notifyTutor(1, 1)).not.toThrow()
  })
})
