import { BadRequestException } from '@nestjs/common'
import { ApplicationStatus, Role } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { OfferService } from '../offer/offer.service'
import { ApplicationService } from './application.service'

/**
 * SPIKE de reproducción (NO arregla nada): sobrecupo por dos aceptaciones
 * simultáneas sobre una oferta con una sola plaza libre. Subtarea G2-18.
 *
 * Dónde está la ventana (base: develop @ 6f6e269):
 *   src/application/application.service.ts:62  lee cuántas aceptadas hay
 *   src/application/application.service.ts:63  compara contra offer.seats
 *   src/application/application.service.ts:66  recién ahí escribe la aceptación
 *   src/offer/offer.service.ts:77-81           prisma.application.count (el SELECT)
 * Entre la lectura (62) y la escritura (66) no hay transacción, ni bloqueo, ni
 * restricción única, ni UPDATE condicional: dos peticiones leen "0 aceptadas"
 * con seats = 1 y las dos escriben.
 *
 * Determinismo: no se depende del scheduler. Una barrera de dos obliga a que
 * LAS DOS lecturas de count terminen antes de que ninguna continúe, de modo que
 * ambas leen el mismo estado previo (0 aceptadas) en una sola corrida.
 */

const OFFER_ID = 1
const COMPANY_ID = 1
const DECIDER_ID = 42

interface OfferRow {
  id: number
  companyId: number
  seats: number
  status: string
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
      [OFFER_ID, { id: OFFER_ID, companyId: COMPANY_ID, seats: 1, status: 'PUBLISHED' }],
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

function makePrisma(store: ReturnType<typeof makeFixture>, barrier: Gate) {
  return {
    user: { findUnique: async () => ({ companyId: COMPANY_ID }) },
    offer: { findUnique: async ({ where }: { where: { id: number } }) => store.offers.get(where.id) ?? null },
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

describe('Spike sobrecupo (G2-18): dos aceptaciones simultáneas', () => {
  function buildScenario(barrier: Gate = makeTwoPartyBarrier()) {
    const store = makeFixture()
    const prisma = makePrisma(store, barrier)
    // ApplicationService decide con el OfferService real, que es quien hace count.
    return { store, service: new ApplicationService(prisma as never, new OfferService(prisma as never)) }
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

  it('(bug) deja 2 aceptadas en una oferta de 1 plaza: ambas peticiones pasan', async () => {
    const { store, service } = buildScenario()

    const [first, second] = await Promise.all([decideAccepted(service, 10), decideAccepted(service, 11)])

    // Ninguna recibió "la oferta ya no tiene cupos": las dos pasaron.
    expect([first.status, second.status]).toEqual([ApplicationStatus.ACCEPTED, ApplicationStatus.ACCEPTED])
    // Sobrecupo: dos plazas ocupadas donde había una.
    expect(acceptedCount(store)).toBe(2)
  })

  it.fails('(invariante) solo una debería aceptarse y la otra rechazarse', async () => {
    const { store, service } = buildScenario()

    const results = await Promise.allSettled([decideAccepted(service, 10), decideAccepted(service, 11)])

    // Con el bug llegan las dos a fulfilled: este expect falla, y por eso el
    // test está marcado it.fails. Cuando se arregle, debe quedar en verde.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(acceptedCount(store)).toBe(1)
  })
})
