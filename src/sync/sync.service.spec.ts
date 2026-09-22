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

  it('does not skip records with the exact same millisecond timestamp', async () => {
    const time = new Date('2026-04-01T12:00:00.000Z')
    const allRecords = [
      { id: 10, updatedAt: time, placementId: 1 },
      { id: 11, updatedAt: time, placementId: 1 },
    ]

    prisma.client.hourLog.findMany.mockImplementation(async ({ where, take }) => {
      // Simulate simple filter based on the new cursor logic
      const hasCursor = where?.OR !== undefined
      const gtId = hasCursor ? where.OR[1].id.gt : 0
      return allRecords.filter((r) => r.id > gtId).slice(0, take)
    })

    const result1 = await service.pull(5, undefined, 1)
    expect(result1.changes.hourLogs).toHaveLength(1)
    expect((result1.changes.hourLogs[0] as { id: number }).id).toBe(10)
    expect(result1.hasMore).toBe(true)

    const result2 = await service.pull(5, result1.checkpoint || undefined, 1)
    expect(result2.changes.hourLogs).toHaveLength(1)
    expect((result2.changes.hourLogs[0] as { id: number }).id).toBe(11)
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

  function makeUpdateOp(clientOpId: string): SyncOperationInput {
    return {
      clientOpId,
      entity: 'hourLog',
      op: 'update',
      baseVersion: 1,
      payload: {
        id: 99,
        date: '2026-04-03',
        startTime: '09:00',
        endTime: '13:00',
        hours: 4,
        activity: 'Actualizado offline',
      },
    }
  }

  it('rejects an update when the hour log was already approved or rejected', async () => {
    prisma.client.hourLog.findUnique.mockResolvedValue({
      id: 99,
      status: 'APPROVED',
      placement: { studentId: 5 },
    })

    const result = await service.push(5, [makeUpdateOp('44444444-4444-4444-8444-444444444444')])

    expect(result.results[0]).toMatchObject({ status: 'rejected', server: null })
    expect(result.results[0].reason).toMatch(/tutor/)
    expect(prisma.client.hourLog.update).not.toHaveBeenCalled()
  })

  it('applies an update when the hour log is still draft or submitted', async () => {
    prisma.client.hourLog.findUnique.mockResolvedValue({
      id: 99,
      status: 'SUBMITTED',
      placement: { studentId: 5 },
    })
    prisma.client.hourLog.update.mockResolvedValue({ id: 99, status: 'SUBMITTED', version: 2 })

    const result = await service.push(5, [makeUpdateOp('55555555-5555-4555-8555-555555555555')])

    expect(result.results[0]).toMatchObject({ status: 'applied' })
    expect(prisma.client.hourLog.update).toHaveBeenCalled()
  })
})