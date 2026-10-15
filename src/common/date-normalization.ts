import { BadRequestException } from '@nestjs/common'

/**
 * Retorna la zona horaria oficial configurada para la institución.
 * Por defecto: 'America/Guayaquil' (UTC-5, Ecuador).
 */
export function getInstitutionTimezone(): string {
  return process.env.INSTITUTION_TIMEZONE || 'America/Guayaquil'
}

/**
 * Formatea una fecha canónica a string YYYY-MM-DD según sus componentes UTC.
 */
export function formatDateIso(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Retorna el inicio del día civil actual (00:00:00.000 UTC) en la zona horaria institucional.
 * Permite inyectar `now` para tests deterministas.
 */
export function getTodayInTimezone(timezone: string = getInstitutionTimezone(), now: Date = new Date()): Date {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const [year, month, day] = formatter.format(now).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
}

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/
const MIDNIGHT_OFFSET_REGEX = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?(?:[+-]\d{2}:?\d{2}|Z)?$/

function parseCalendarDateString(str: string): Date | null {
  const match = DATE_ONLY_REGEX.exec(str) ?? MIDNIGHT_OFFSET_REGEX.exec(str)
  if (!match) return null

  const [, y, m, d] = match.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
  if (Number.isNaN(date.getTime())) throw new BadRequestException('fecha inválida')
  return date
}

function normalizeDateObject(date: Date, timezone: string): Date {
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('fecha inválida')
  }

  // Si ya es medianoche UTC pura (00:00:00.000Z), ya es la fecha canónica del calendario
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return date
  }

  // Es un instante con hora/minuto: proyectarlo a la zona horaria institucional
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const [year, month, day] = formatter.format(date).split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0))
  } catch {
    throw new BadRequestException(`zona horaria inválida: ${timezone}`)
  }
}

/**
 * Valida que una fecha no sea futura y que esté dentro del periodo del placement.
 */
export function validatePlacementPeriodAndFuture(
  normalizedDate: Date,
  placement: { startDate?: Date | null; endDate?: Date | null },
  timezone: string = getInstitutionTimezone(),
): void {
  const today = getTodayInTimezone(timezone)
  if (normalizedDate.getTime() > today.getTime()) {
    throw new BadRequestException('no se pueden registrar horas con fecha futura')
  }

  if (placement.startDate && placement.endDate) {
    const start = normalizeHourLogDate(placement.startDate, timezone)
    const end = normalizeHourLogDate(placement.endDate, timezone)
    if (normalizedDate.getTime() < start.getTime() || normalizedDate.getTime() > end.getTime()) {
      throw new BadRequestException(
        `la fecha está fuera del periodo de la práctica (rango válido: ${formatDateIso(start)} a ${formatDateIso(end)})`,
      )
    }
  }
}

/**
 * G2-24: Normaliza la fecha de un registro de horas (`HourLog.date`) para que
 * represente el día calendario en la zona horaria de la institución.
 */
export function normalizeHourLogDate(
  input: Date | string | null | undefined,
  timezone: string = getInstitutionTimezone(),
): Date {
  if (input === null || input === undefined) {
    throw new BadRequestException('fecha requerida')
  }

  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) throw new BadRequestException('fecha requerida')

    const directDate = parseCalendarDateString(trimmed)
    if (directDate) return directDate

    input = new Date(trimmed)
  }

  if (input instanceof Date) {
    return normalizeDateObject(input, timezone)
  }

  throw new BadRequestException('tipo de fecha no soportado')
}
