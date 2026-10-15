import { Module } from '@nestjs/common'
import { HourLogController } from './hour-log.controller'
import { HourLogNotificationService } from './hour-log.notification.service'
import { HourLogReportService } from './hour-log.report.service'
import { HourLogService } from './hour-log.service'
import { HourLogValidationService } from './hour-log.validation.service'

@Module({
  controllers: [HourLogController],
  providers: [HourLogService, HourLogValidationService, HourLogNotificationService, HourLogReportService],
  exports: [HourLogService],
})
export class HourLogModule {}

