import { describe, expect, it } from 'vitest'
import {
  ACCREDITATION_RULES,
  calculateAccreditationStatus,
  type AccreditationInput,
} from './accreditation'

const inputWith = (overrides: Partial<AccreditationInput> = {}): AccreditationInput => ({
  placementId: 9,
  studentName: 'Prueba de tabla',
  requiredHours: 480,
  approvedHours: 480,
  pendingHours: 0,
  hasAgreement: true,
  hasInsurance: true,
  hasFinalReport: true,
  tutorEvaluationScore: 4,
  companyEvaluationScore: 4,
  placementStatus: 'COMPLETED',
  ...overrides,
})

describe('tabla de reglas de acreditación', () => {
  it('usa un id único y estable por regla', () => {
    const ids = ACCREDITATION_RULES.map((rule) => rule.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+(-[a-z]+)+$/)
    }
  })

  it('resume cada regla en una frase', () => {
    for (const rule of ACCREDITATION_RULES) {
      expect(rule.summary.trim().length).toBeGreaterThan(20)
    }
  })

  it('acredita sin observaciones cuando ninguna regla aplica', () => {
    const result = calculateAccreditationStatus(inputWith())

    expect(result.level).toBe('ACREDITADO')
    expect(result.reasons).toEqual([])
  })

  it('decide con la primera regla que aplica', () => {
    const casos: AccreditationInput[] = [
      inputWith({ placementStatus: 'ABANDONED' }),
      inputWith({ hasInsurance: false, pendingHours: 4 }),
      inputWith({ tutorEvaluationScore: null }),
    ]

    for (const caso of casos) {
      const regla = ACCREDITATION_RULES.find((candidate) => candidate.appliesWhen(caso))
      const esperado = regla ? regla.decide(caso) : { level: 'ACREDITADO', reasons: [] }

      const { level, reasons } = calculateAccreditationStatus(caso)
      expect({ level, reasons }).toEqual({ level: esperado.level, reasons: [...esperado.reasons] })
    }
  })
})
