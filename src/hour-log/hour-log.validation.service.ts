import { BadRequestException, Injectable } from '@nestjs/common'

/**
 * Valida las reglas de negocio del libro de horas.
 *
 * Propósito único: recibir valores crudos y lanzar BadRequestException
 * si violan las reglas. No persiste ni notifica nada.
 *
 * Nota D-06: el DTO HTTP acepta hasta 12 horas (validación de formato);
 * este servicio aplica el tope de negocio real: 10 horas por jornada.
 * La divergencia DTO vs. servicio queda en KNOWN_ISSUES hasta que el
 * equipo alinee ambas capas.
 */
@Injectable()
export class HourLogValidationService {
  /**
   * Lanza BadRequestException si las horas están fuera del rango permitido.
   * @param hours Horas declaradas en la jornada.
   */
  validateHourRange(hours: number): void {
    if (hours <= 0 || hours > 10) {
      throw new BadRequestException('las horas deben estar entre 0 y 10')
    }
  }

  /**
   * Lanza BadRequestException si startTime no es anterior a endTime.
   * @param startTime Hora de inicio en formato "HH:MM".
   * @param endTime   Hora de fin en formato "HH:MM".
   */
  validateTimeRange(startTime: string, endTime: string): void {
    const [startHour, startMinute] = startTime.split(':').map(Number)
    const [endHour, endMinute] = endTime.split(':').map(Number)
    if (startHour * 60 + startMinute >= endHour * 60 + endMinute) {
      throw new BadRequestException('la hora de inicio debe ser anterior a la de fin')
    }
  }
}
