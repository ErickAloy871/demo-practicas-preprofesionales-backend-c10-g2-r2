import { Injectable, Logger } from '@nestjs/common'

/**
 * Notifica al tutor asignado cuando un estudiante registra una jornada de horas.
 *
 * Propósito único: encapsular el canal de notificación al tutor. Hoy usa
 * console.log; en el futuro se puede cambiar a email, push o WebSocket
 * sin tocar ningún otro servicio del módulo.
 */
@Injectable()
export class HourLogNotificationService {
  private readonly logger = new Logger(HourLogNotificationService.name)

  /**
   * Notifica al tutor que existe un nuevo registro de horas pendiente de revisión.
   * @param tutorId   Id del tutor asignado al placement.
   * @param hourLogId Id del registro de horas recién creado.
   */
  notifyTutor(tutorId: number, hourLogId: number): void {
    this.logger.log(`tutor ${tutorId}: nueva hora registrada #${hourLogId}`)
  }
}
