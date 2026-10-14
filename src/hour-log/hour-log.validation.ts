import type { Prisma } from '@prisma/client'

/** Fuente única de configuración de horas por estudiante y día. */
export const HOUR_LOG_DAILY_HOURS_LIMIT = 8
export const HOUR_LOG_MINIMUM_HOURS = 0.5

export const HOUR_LOG_DAILY_LIMIT_MESSAGE = `No puedes registrar más de ${HOUR_LOG_DAILY_HOURS_LIMIT} horas en un mismo día`
export const HOUR_LOG_INVALID_HOURS_MESSAGE = `Las horas deben ser de al menos ${HOUR_LOG_MINIMUM_HOURS}`
export const HOUR_LOG_TIME_ORDER_MESSAGE = 'La hora de fin debe ser posterior a la de inicio'

type HourLogValues = {
  date: Date
  hours: number
  startTime: string
  endTime: string
}

export function validateHourLogValues({ date, hours, startTime, endTime }: HourLogValues): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || !Number.isFinite(hours) || hours < HOUR_LOG_MINIMUM_HOURS) {
    return HOUR_LOG_INVALID_HOURS_MESSAGE
  }
  if (!isTime(startTime) || !isTime(endTime) || timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    return HOUR_LOG_TIME_ORDER_MESSAGE
  }
  return null
}

export function exceedsDailyHourLimit(existingHours: number, newHours: number): boolean {
  return existingHours + newHours > HOUR_LOG_DAILY_HOURS_LIMIT
}

/** Incluye todos los placements del estudiante y excluye los registros borrados. */
export function dailyHourLogsWhere(studentId: number, date: Date, excludingHourLogId?: number): Prisma.HourLogWhereInput {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  return {
    deletedAt: null,
    placement: { studentId },
    date: { gte: start, lt: end },
    ...(excludingHourLogId === undefined ? {} : { id: { not: excludingHourLogId } }),
  }
}

function isTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}
