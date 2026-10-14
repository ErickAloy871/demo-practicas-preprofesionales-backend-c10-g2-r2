import { Transform } from 'class-transformer'
import { IsDate, IsInt, IsNumber, IsString, Matches, MaxLength } from 'class-validator'
import { normalizeHourLogDate } from '../../common/date-normalization'

export class CreateHourLogDto {
  @IsInt() placementId!: number

  @Transform(({ value }) => {
    try {
      return normalizeHourLogDate(value)
    } catch {
      return new Date(NaN)
    }
  })
  @IsDate()
  date!: Date

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) endTime!: string

  // El rango y el total diario se validan en hour-log.validation.ts, donde
  // también los reutiliza el flujo de sincronización offline.
  @IsNumber() hours!: number

  @IsString() @MaxLength(500) activity!: string
}
