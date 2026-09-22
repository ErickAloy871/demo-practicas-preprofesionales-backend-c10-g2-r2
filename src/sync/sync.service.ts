import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { type Checkpoint, decodeCheckpoint, encodeCheckpoint } from './checkpoint'
import type { SyncOperationInput, SyncOperationResult } from './dto/push.dto'

type StoredResponse = SyncOperationResult

const P2002 = 'P2002'

function asStoredResponse(value: unknown): StoredResponse {
  return value as StoredResponse
}

function extractHourLogData(payload: Record<string, unknown>) {
  return {
    date: new Date(String(payload.date)),
    startTime: String(payload.startTime),
    endTime: String(payload.endTime),
    hours: Number(payload.hours),
    activity: String(payload.activity),
  }
}

export interface SyncPullResponse {
  changes: { placements: unknown[]; hourLogs: unknown[]; documents: unknown[]; evaluations: unknown[] }
  checkpoint: string | null
  hasMore: boolean
}

export interface SyncPushResponse {
  results: SyncOperationResult[]
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(private readonly prisma: PrismaService) {}

  async pull(userId: number, since: string | undefined, limit: number): Promise<SyncPullResponse> {
    const cursor = decodeCheckpoint(since)
    const where = cursor
      ? {
          OR: [
            { updatedAt: { gt: new Date(cursor.updatedAt) } },
            { updatedAt: new Date(cursor.updatedAt), id: { gt: cursor.id } },
          ],
        }
      : {}
    const order = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }]
    const scope = { placement: { OR: [{ studentId: userId }, { tutorId: userId }] } }

    const [placements, hourLogs, documents, evaluations] = await Promise.all([
      this.prisma.placement.findMany({
        where: { ...where, OR: [{ studentId: userId }, { tutorId: userId }] },
        orderBy: order,
        take: limit,
      }),
      this.prisma.hourLog.findMany({ where: { ...where, ...scope }, orderBy: order, take: limit }),
      this.prisma.document.findMany({ where: { ...where, ...scope }, orderBy: order, take: limit }),
      this.prisma.evaluation.findMany({ where: { ...where, ...scope }, orderBy: order, take: limit }),
    ])

    const newest = [...placements, ...hourLogs, ...documents, ...evaluations].sort((a, b) => {
      const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      if (timeDiff !== 0) return timeDiff
      return b.id - a.id
    })[0]

    const checkpoint: Checkpoint | null = newest
      ? { updatedAt: new Date(newest.updatedAt).toISOString(), id: newest.id }
      : cursor

    return {
      changes: { placements, hourLogs, documents, evaluations },
      checkpoint: checkpoint ? encodeCheckpoint(checkpoint) : null,
      hasMore: [placements, hourLogs, documents, evaluations].some((rows) => rows.length === limit),
    }
  }

  async push(userId: number, ops: SyncOperationInput[]): Promise<SyncPushResponse> {
    const results: SyncOperationResult[] = []
    for (const op of ops) {
      results.push(await this.processOperation(userId, op))
    }
    return { results }
  }

  private async processOperation(userId: number, op: SyncOperationInput): Promise<SyncOperationResult> {
    const cached = await this.fetchStored(op.clientOpId)
    if (cached) return cached

    try {
      return await this.applyAndStore(userId, op)
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await this.fetchStored(op.clientOpId)
        if (winner) return winner
      }
      this.logger.warn(`Error al aplicar operación ${op.clientOpId}: ${err instanceof Error ? err.message : String(err)}`)
      return this.reject(op.clientOpId, err)
    }
  }

  private async fetchStored(clientOpId: string): Promise<StoredResponse | null> {
    const row = await this.prisma.syncOperation.findUnique({ where: { clientOpId } })
    return row ? asStoredResponse(row.response) : null
  }

  private async applyAndStore(userId: number, op: SyncOperationInput): Promise<SyncOperationResult> {
    return this.prisma.$transaction(async (tx) => {
      const winner = await tx.syncOperation.findUnique({ where: { clientOpId: op.clientOpId } })
      if (winner) return asStoredResponse(winner.response)

      const applied = await this.applyOperation(tx, userId, op)
      if (applied.status === 'applied') {
        await tx.syncOperation.create({
          data: {
            clientOpId: op.clientOpId,
            userId,
            response: applied as unknown as Prisma.InputJsonValue,
          },
        })
      }
      return applied
    })
  }

  private reject(clientOpId: string, err: unknown): SyncOperationResult {
    return {
      clientOpId,
      status: 'rejected',
      server: null,
      reason: err instanceof Error ? err.message : 'no se pudo aplicar la operación',
    }
  }

  private async applyOperation(
    tx: Prisma.TransactionClient,
    userId: number,
    op: SyncOperationInput,
  ): Promise<SyncOperationResult> {
    if (op.entity !== 'hourLog') {
      return rejectOp(op.clientOpId, 'entidad no sincronizable desde el cliente')
    }

    if (op.op === 'create') return this.createHourLog(tx, userId, op)
    return this.mutateHourLog(tx, userId, op)
  }

  private async createHourLog(
    tx: Prisma.TransactionClient,
    userId: number,
    op: SyncOperationInput,
  ): Promise<SyncOperationResult> {
    const placement = await tx.placement.findUnique({ where: { id: Number(op.payload.placementId) } })
    if (!placement || placement.studentId !== userId) {
      return rejectOp(op.clientOpId, 'el placement no pertenece al usuario')
    }

    const created = await tx.hourLog.create({
      data: {
        placementId: Number(op.payload.placementId),
        ...extractHourLogData(op.payload),
        status: 'SUBMITTED',
      },
    })
    return applyOp(op.clientOpId, created)
  }

  private async mutateHourLog(
    tx: Prisma.TransactionClient,
    userId: number,
    op: SyncOperationInput,
  ): Promise<SyncOperationResult> {
    const existing = await tx.hourLog.findUnique({
      where: { id: Number(op.payload.id) },
      include: { placement: true },
    })
    if (!existing || existing.placement.studentId !== userId) {
      return rejectOp(op.clientOpId, 'el registro no pertenece al usuario')
    }

    if (op.op === 'update') {
      // El servidor manda sobre el estado: una hora ya revisada no se pisa.
      if (existing.status === 'APPROVED' || existing.status === 'REJECTED') {
        return rejectOp(op.clientOpId, 'el tutor ya revisó esta hora; tu edición no se aplicó')
      }

      const updated = await tx.hourLog.update({
        where: { id: Number(op.payload.id) },
        data: {
          ...extractHourLogData(op.payload),
          version: { increment: 1 },
        },
      })
      return applyOp(op.clientOpId, updated)
    }

    const deleted = await tx.hourLog.update({
      where: { id: Number(op.payload.id) },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    })
    return applyOp(op.clientOpId, deleted)
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === P2002
}

function rejectOp(clientOpId: string, reason: string): SyncOperationResult {
  return { clientOpId, status: 'rejected', server: null, reason }
}

function applyOp(clientOpId: string, server: unknown): SyncOperationResult {
  return { clientOpId, status: 'applied', server: server as Record<string, unknown>, reason: null }
}