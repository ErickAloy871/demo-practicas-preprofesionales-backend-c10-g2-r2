import { Transform } from 'class-transformer'
import { IsDate, IsInt, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
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

  // D-06 (copia 1): tope 12.
  @Min(0.5) @Max(12) hours!: number

  @IsString() @MaxLength(500) activity!: string
}
