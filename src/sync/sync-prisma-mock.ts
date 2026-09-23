import { Prisma } from '@prisma/client'
import { vi, type Mock } from 'vitest'

type SyncOperationRow = { clientOpId: string; userId: number; response: unknown }
type HourLogRow = { id: number; placementId: number; version: number }

type TxClient = {
  syncOperation: { findUnique: Mock; create: Mock }
  placement: { findUnique: Mock }
  hourLog: { findUnique: Mock; create: Mock; update: Mock }
}

export class SyncPrismaMock {
  readonly state = { syncOps: new Map<string, SyncOperationRow>(), hourLogs: [] as HourLogRow[] }
  private readonly locks = new Set<string>()
  private nextId = 1
  readonly client: {
    placement: { findMany: Mock; findUnique: Mock }
    hourLog: { findMany: Mock; findUnique: Mock; create: Mock; update: Mock }
    document: { findMany: Mock }
    evaluation: { findMany: Mock }
    syncOperation: { findUnique: Mock; create: Mock }
    $transaction: Mock
  }

  constructor() {
    const pFindUnique = vi.fn().mockResolvedValue(null)
    const hFindUnique = vi.fn().mockResolvedValue(null)
    const hUpdate = vi.fn().mockResolvedValue(null)

    this.client = {
      placement: { findMany: vi.fn().mockResolvedValue([]), findUnique: pFindUnique },
      hourLog: { findMany: vi.fn().mockResolvedValue([]), findUnique: hFindUnique, create: vi.fn(), update: hUpdate },
      document: { findMany: vi.fn().mockResolvedValue([]) },
      evaluation: { findMany: vi.fn().mockResolvedValue([]) },
      syncOperation: { findUnique: vi.fn().mockImplementation((a) => this.findSyncOp(a)), create: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => this.runTx(cb, pFindUnique, hFindUnique, hUpdate)),
    }
  }

  private findSyncOp(args: unknown): Promise<unknown> {
    const { clientOpId } = (args as { where: { clientOpId: string } }).where
    return Promise.resolve(this.state.syncOps.get(clientOpId) ?? null)
  }

  private async runTx(cb: (tx: TxClient) => Promise<unknown>, pU: Mock, hU: Mock, hUp: Mock): Promise<unknown> {
    const handle = new TxHandle(this.state, this.locks, this.nextId, pU, hU, hUp)
    let ok = false
    try {
      const res = await cb(handle.client)
      ok = true
      handle.commit()
      return res
    } finally {
      if (!ok) handle.rollback()
      this.nextId = handle.nextId
    }
  }
}

class TxHandle {
  readonly client: TxClient
  private readonly pendingHours: HourLogRow[] = []
  private pendingSyncOp: SyncOperationRow | null = null

  constructor(
    private readonly state: { syncOps: Map<string, SyncOperationRow>; hourLogs: HourLogRow[] },
    private readonly locks: Set<string>,
    public nextId: number,
    pU: Mock, hU: Mock, hUp: Mock,
  ) {
    this.client = {
      syncOperation: {
        findUnique: vi.fn().mockImplementation((a) => Promise.resolve(this.state.syncOps.get(a.where.clientOpId) ?? null)),
        create: vi.fn().mockImplementation((a) => this.createSyncOp(a)),
      },
      placement: { findUnique: pU },
      hourLog: { findUnique: hU, create: vi.fn().mockImplementation((a) => this.createHour(a)), update: hUp },
    }
  }

  private createSyncOp(args: unknown): Promise<SyncOperationRow> {
    const { data } = args as { data: SyncOperationRow }
    if (this.state.syncOps.has(data.clientOpId) || this.locks.has(data.clientOpId)) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
    }
    this.locks.add(data.clientOpId)
    this.pendingSyncOp = data
    return Promise.resolve(data)
  }

  private createHour(args: unknown): Promise<HourLogRow> {
    const { data } = args as { data: { placementId: number } }
    const created = { id: this.nextId++, placementId: data.placementId, version: 1 }
    this.pendingHours.push(created)
    return Promise.resolve(created)
  }

  commit(): void {
    this.state.hourLogs.push(...this.pendingHours)
    if (this.pendingSyncOp) {
      this.state.syncOps.set(this.pendingSyncOp.clientOpId, this.pendingSyncOp)
      this.locks.delete(this.pendingSyncOp.clientOpId)
    }
  }

  rollback(): void {
    this.nextId -= this.pendingHours.length
    if (this.pendingSyncOp) this.locks.delete(this.pendingSyncOp.clientOpId)
  }
}