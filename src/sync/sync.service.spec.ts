import { beforeEach, describe, expect, it } from 'vitest'
import type { PrismaService } from '../prisma/prisma.service'
import type { SyncOperationInput } from './dto/push.dto'
import { SyncPrismaMock } from './sync-prisma-mock'
import { SyncService } from './sync.service'

function makeCreateOp(clientOpId: string): SyncOperationInput {
  return {
    clientOpId,
    entity: 'hourLog',
    op: 'create',
    baseVersion: null,
    payload: {
      placementId: 1,
      date: '2026-04-02',
      startTime: '08:00',
      endTime: '12:00',
      hours: 4,
      activity: 'Soporte',
    },
  }
}

describe('SyncService', () => {
  let prisma: SyncPrismaMock
  let service: SyncService

  beforeEach(() => {
    prisma = new SyncPrismaMock()
    // Por defecto, el placement existe y pertenece al estudiante 5.
    prisma.client.placement.findUnique.mockResolvedValue({ id: 1, studentId: 5 })
    service = new SyncService(prisma.client as unknown as PrismaService)
  })

  it('returns changes and a checkpoint from the newest row', async () => {
    prisma.client.hourLog.findMany.mockResolvedValue([
      { id: 9, updatedAt: new Date('2026-04-01T12:00:00.000Z'), placementId: 1 },
    ])

    const result = await service.pull(5, undefined, 200)

    expect(result.changes.hourLogs).toHaveLength(1)
    expect(result.checkpoint).toBeTypeOf('string')
    expect(result.hasMore).toBe(false)
  })

  it('applies a create operation and returns applied', async () => {
    const result = await service.push(5, [makeCreateOp('11111111-1111-4111-8111-111111111111')])

    expect(result.results[0]).toMatchObject({
      status: 'applied',
      clientOpId: '11111111-1111-4111-8111-111111111111',
    })
    expect(prisma.client.$transaction).toHaveBeenCalled()
  })

  // Criterio de aceptación: reintento secuencial con el mismo clientOpId
  // deja una sola fila en HourLog y devuelve el mismo `server.id`.
  it('is idempotent on sequential retries with the same clientOpId', async () => {
    const op = makeCreateOp('33333333-3333-4333-8333-333333333333')

    const first = await service.push(5, [op])
    const second = await service.push(5, [op])
    const third = await service.push(5, [op])

    expect(first.results[0].status).toBe('applied')
    expect(second.results[0].status).toBe('applied')
    expect(third.results[0].status).toBe('applied')
    expect(second.results[0].server).toEqual(first.results[0].server)
    expect(third.results[0].server).toEqual(first.results[0].server)
    expect(prisma.state.hourLogs).toHaveLength(1)
  })

  // Criterio de aceptación: pushes concurrentes con el mismo clientOpId no
  // duplican ni rompen. El camino P2002 (otro proceso ganó la carrera)
  // entrega la respuesta del ganador sin lanzar 500.
  it('is idempotent under concurrent pushes with the same clientOpId', async () => {
    const op = makeCreateOp('22222222-2222-4222-8222-222222222222')

    const responses = await Promise.all([service.push(5, [op]), service.push(5, [op]), service.push(5, [op])])

    for (const r of responses) {
      expect(r.results[0].status).toBe('applied')
      expect(r.results[0].clientOpId).toBe(op.clientOpId)
      expect(r.results[0].reason).toBeNull()
    }

    const ids = responses.map((r) => (r.results[0].server as { id: number }).id)
    expect(new Set(ids).size).toBe(1)
    expect(prisma.state.hourLogs).toHaveLength(1)
    expect(prisma.state.syncOps.size).toBe(1)
  })
})