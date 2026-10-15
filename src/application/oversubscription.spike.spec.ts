import { BadRequestException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { ApplicationService } from './application.service'

/**
 * Spike original (G2-18): reprodujo el sobrecupo por dos aceptaciones
 * simultáneas sobre una oferta con una sola plaza libre, leyendo cuántas
 * aceptadas había y comparando antes de escribir, sin nada entre medio que
 * impidiera que dos lecturas vieran "0 aceptadas" a la vez.
 *
 * G2-19 lo arregló con un UPDATE condicional atómico sobre `offers.acceptedCount`
 * (ver application.service.ts). Ya no hay lectura previa que abrir como ventana,
 * así que la barrera de dos (abajo) ya no es necesaria para que la carrera sea
 * determinista: el mock de `offer.updateMany` no tiene ningún `await` entre leer
 * y escribir el store, así que es tan indivisible como el UPDATE real de Postgres.
 * Se deja la barrera igual, sin uso, para no reescribir de más un archivo ya
 * revisado y aprobado por el equipo.
 */

const OFFER_ID = 1
const COMPANY_ID = 1
const DECIDER_ID = 42

interface OfferRow {
  id: number
  companyId: number
  seats: number
  status: string
  acceptedCount: number
}

interface ApplicationRow {
  id: number
  offerId: number
  studentId: number
  status: ApplicationStatus
  decidedAt?: Date | null
}

/** Una oferta con UNA plaza y dos postulaciones pendientes. */
function makeFixture() {
  return {
    offers: new Map<number, OfferRow>([
      [OFFER_ID, { id: OFFER_ID, companyId: COMPANY_ID, seats: 1, status: 'PUBLISHED', acceptedCount: 0 }],
    ]),
    applications: new Map<number, ApplicationRow>([
      [10, { id: 10, offerId: OFFER_ID, studentId: 100, status: ApplicationStatus.SUBMITTED }],
      [11, { id: 11, offerId: OFFER_ID, studentId: 101, status: ApplicationStatus.SUBMITTED }],
    ]),
  }
}

interface Gate {
  arrive: () => void
  wait: () => Promise<void>
}

/** Barrera de dos: cada llegada espera a que la otra también haya llegado. */
function makeTwoPartyBarrier(): Gate {
  let arrivals = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    arrive: () => {
      arrivals += 1
      if (arrivals >= 2) release()
    },
    wait: () => gate,
  }
}

/** Sin barrera: para los casos secuenciales, donde solo hay una lectura. */
const noBarrier: Gate = { arrive: () => {}, wait: async () => {} }

interface UpdateManyArgs {
  where: { id: number; acceptedCount: { lt: number } }
  data: { acceptedCount: { increment: number } }
}

function makePrisma(store: ReturnType<typeof makeFixture>, barrier: Gate) {
  return {
    user: { findUnique: async () => ({ companyId: COMPANY_ID }) },
    offer: {
      findUnique: async ({ where }: { where: { id: number } }) => store.offers.get(where.id) ?? null,
      // G2-19: UPDATE condicional atómico. Sin ningún await entre leer y
      // escribir el store, nada puede intercalarse a mitad de esta función
      // — así es como Postgres hace indivisible el UPDATE real sobre la fila.
      updateMany: async ({ where, data }: UpdateManyArgs) => {
        const row = store.offers.get(where.id)
        if (!row || row.acceptedCount >= where.acceptedCount.lt) return { count: 0 }
        row.acceptedCount += data.acceptedCount.increment
        return { count: 1 }
      },
    },
    application: {
      findUnique: async ({ where }: { where: { id: number } }) => store.applications.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: number }; data: Partial<ApplicationRow> }) => {
        const row = { ...store.applications.get(where.id), ...data } as ApplicationRow
        store.applications.set(where.id, row)
        return row
      },
      // La lectura que abre la ventana (offer.service.ts:77-81): toma el
      // snapshot del estado ANTES de la barrera y lo devuelve después.
      count: async ({ where }: { where: { offerId: number; status: ApplicationStatus } }) => {
        const snapshot = [...store.applications.values()].filter(
          (row) => row.offerId === where.offerId && row.status === where.status,
        ).length
        barrier.arrive()
        await barrier.wait()
        return snapshot
      },
    },
  }
}

function acceptedCount(store: ReturnType<typeof makeFixture>): number {
  return [...store.applications.values()].filter((row) => row.status === ApplicationStatus.ACCEPTED).length
}

describe('Spike sobrecupo (G2-18/G2-19): dos aceptaciones simultáneas', () => {
  function buildScenario(barrier: Gate = makeTwoPartyBarrier()) {
    const store = makeFixture()
    const prisma = makePrisma(store, barrier)
    return { store, service: new ApplicationService(prisma as never) }
  }

  const decideAccepted = (service: ApplicationService, id: number) =>
    service.decide(id, ApplicationStatus.ACCEPTED, DECIDER_ID, Role.COMPANY)

  it('(control) en secuencia la segunda aceptación sí se rechaza: el chequeo existe', async () => {
    const { store, service } = buildScenario(noBarrier)

    const first = await decideAccepted(service, 10)
    expect(first.status).toBe(ApplicationStatus.ACCEPTED)

    const error: unknown = await decideAccepted(service, 11).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(BadRequestException)
    expect((error as BadRequestException).message).toBe('la oferta ya no tiene cupos')
    expect(acceptedCount(store)).toBe(1)
  })

  it('(G2-19) dos aceptaciones simultáneas: exactamente una pasa, la otra se rechaza', async () => {
    const { store, service } = buildScenario()

    const results = await Promise.allSettled([decideAccepted(service, 10), decideAccepted(service, 11)])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException)
    expect(((rejected[0] as PromiseRejectedResult).reason as BadRequestException).message).toBe(
      'la oferta ya no tiene cupos',
    )
    // Sin sobrecupo: una sola plaza ocupada, como prometía la oferta.
    expect(acceptedCount(store)).toBe(1)
  })
})
