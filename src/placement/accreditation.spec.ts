import { describe, expect, it } from 'vitest'
import { calculateAccreditationStatus } from './accreditation'

const base = {
  placementId: 1,
  studentName: 'Estudiante 0',
  requiredHours: 240,
  approvedHours: 240,
  pendingHours: 0,
  hasAgreement: true,
  hasInsurance: true,
  hasFinalReport: true,
  tutorEvaluationScore: 4.5,
  companyEvaluationScore: 4.2,
  placementStatus: 'COMPLETED',
}

describe('calculateAccreditationStatus', () => {
  it('accredits a placement with all hours, documents and evaluations', () => {
    const result = calculateAccreditationStatus(base)

    expect(result.level).toBe('ACREDITADO')
    expect(result.reasons).toHaveLength(0)
    expect(result.completionPercentage).toBe(100)
  })

  it('marks as PENDIENTE when hours are still missing', () => {
    const result = calculateAccreditationStatus({ ...base, approvedHours: 120, pendingHours: 40, placementStatus: 'ACTIVE' })

    expect(result.level).toBe('PENDIENTE')
    expect(result.reasons).toContain('horas insuficientes')
    expect(result.completionPercentage).toBe(50)
  })

  describe('result shape', () => {
    it('echoes placementId and studentName from the input', () => {
      const result = calculateAccreditationStatus({ ...base, placementId: 77, studentName: 'Ana Pérez' })

      expect(result.placementId).toBe(77)
      expect(result.studentName).toBe('Ana Pérez')
    })
  })

  describe('placement ABANDONED', () => {
    it('is NO_ACREDITADO with the abandonment reason only when nothing is pending', () => {
      const result = calculateAccreditationStatus({ ...base, placementStatus: 'ABANDONED' })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['placement abandonado'])
    })

    it('adds the pending-hours reason when there are unreviewed hours', () => {
      const result = calculateAccreditationStatus({ ...base, placementStatus: 'ABANDONED', pendingHours: 12 })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['placement abandonado', 'hay 12 horas pendientes sin revisar'])
    })

    it('takes precedence over a fully complete file', () => {
      const result = calculateAccreditationStatus({ ...base, placementStatus: 'ABANDONED', approvedHours: 300 })

      expect(result.level).toBe('NO_ACREDITADO')
    })
  })

  describe('placement SUSPENDED', () => {
    it('is NO_ACREDITADO without extra reasons when there is no agreement', () => {
      const result = calculateAccreditationStatus({ ...base, placementStatus: 'SUSPENDED', hasAgreement: false })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['placement suspendido'])
    })

    it('notes the agreement still in force when there is one', () => {
      const result = calculateAccreditationStatus({ ...base, placementStatus: 'SUSPENDED' })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['placement suspendido', 'convenio vigente pese a la suspensión'])
    })

    it('does not mention pending hours, unlike ABANDONED', () => {
      const result = calculateAccreditationStatus({ ...base, placementStatus: 'SUSPENDED', pendingHours: 8 })

      expect(result.reasons).not.toContain('hay 8 horas pendientes sin revisar')
      expect(result.reasons.some((reason) => reason.includes('pendientes'))).toBe(false)
    })
  })

  describe('insufficient hours', () => {
    it('is PENDIENTE with only the hours reason when nothing is pending', () => {
      const result = calculateAccreditationStatus({ ...base, approvedHours: 239, placementStatus: 'ACTIVE' })

      expect(result.level).toBe('PENDIENTE')
      expect(result.reasons).toEqual(['horas insuficientes'])
    })

    it('adds the pending-hours reason when there are hours awaiting approval', () => {
      const result = calculateAccreditationStatus({ ...base, approvedHours: 100, pendingHours: 30, placementStatus: 'ACTIVE' })

      expect(result.reasons).toEqual(['horas insuficientes', 'hay 30 horas pendientes de aprobación'])
    })

    it('does not look at documents or evaluations while hours are short', () => {
      const result = calculateAccreditationStatus({
        ...base,
        approvedHours: 0,
        hasAgreement: false,
        hasInsurance: false,
        hasFinalReport: false,
        tutorEvaluationScore: null,
      })

      expect(result.level).toBe('PENDIENTE')
      expect(result.reasons).toEqual(['horas insuficientes'])
    })
  })

  describe('hours boundary', () => {
    it('counts exactly the required hours as enough', () => {
      const result = calculateAccreditationStatus({ ...base, approvedHours: 240, requiredHours: 240 })

      expect(result.level).toBe('ACREDITADO')
    })

    it('counts one hour less than required as not enough', () => {
      const result = calculateAccreditationStatus({ ...base, approvedHours: 239 })

      expect(result.level).toBe('PENDIENTE')
    })
  })

  describe('documents (hours already complete)', () => {
    it('notes the insurance in force when the agreement is missing', () => {
      const result = calculateAccreditationStatus({ ...base, hasAgreement: false, hasInsurance: true })

      expect(result.reasons).toEqual(['falta convenio', 'seguro vigente pese a la falta de convenio'])
    })

    it('does not note the insurance when both agreement and insurance are missing', () => {
      const result = calculateAccreditationStatus({ ...base, hasAgreement: false, hasInsurance: false })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['falta convenio'])
    })

    it('is NO_ACREDITADO when the insurance is missing', () => {
      const result = calculateAccreditationStatus({ ...base, hasInsurance: false })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['falta seguro'])
    })

    it('adds the pending-hours reason when the insurance is missing and hours are pending', () => {
      const result = calculateAccreditationStatus({ ...base, hasInsurance: false, pendingHours: 5 })

      expect(result.reasons).toEqual(['falta seguro', 'hay 5 horas pendientes de aprobación'])
    })

    it('is PENDIENTE when the final report is missing', () => {
      const result = calculateAccreditationStatus({ ...base, hasFinalReport: false })

      expect(result.level).toBe('PENDIENTE')
      expect(result.reasons).toEqual(['falta informe final'])
    })

    it('checks the agreement before the insurance before the final report', () => {
      const result = calculateAccreditationStatus({
        ...base,
        hasAgreement: false,
        hasInsurance: false,
        hasFinalReport: false,
      })

      expect(result.reasons).toEqual(['falta convenio'])
    })

    it('checks the insurance before the final report', () => {
      const result = calculateAccreditationStatus({ ...base, hasInsurance: false, hasFinalReport: false })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual(['falta seguro'])
    })
  })

  describe('tutor evaluation', () => {
    it('is PENDIENTE when the tutor has not evaluated yet', () => {
      const result = calculateAccreditationStatus({ ...base, tutorEvaluationScore: null })

      expect(result.level).toBe('PENDIENTE')
      expect(result.reasons).toEqual(['falta evaluación del tutor'])
    })

    it('is NO_ACREDITADO when the tutor score is below 3', () => {
      const result = calculateAccreditationStatus({ ...base, tutorEvaluationScore: 2.9 })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons).toEqual([
        'evaluación del tutor por debajo del mínimo',
        'informe final entregado pese a evaluación baja',
      ])
    })

    it('treats a tutor score of exactly 3 as passing', () => {
      const result = calculateAccreditationStatus({ ...base, tutorEvaluationScore: 3 })

      expect(result.level).toBe('ACREDITADO')
    })

    it('treats a tutor score of 0 as an evaluation below the minimum, not as missing', () => {
      const result = calculateAccreditationStatus({ ...base, tutorEvaluationScore: 0 })

      expect(result.level).toBe('NO_ACREDITADO')
      expect(result.reasons[0]).toBe('evaluación del tutor por debajo del mínimo')
    })

    it('ignores the company score when the tutor score is below 3', () => {
      const result = calculateAccreditationStatus({ ...base, tutorEvaluationScore: 2, companyEvaluationScore: 5 })

      expect(result.level).toBe('NO_ACREDITADO')
    })
  })

  describe('company evaluation', () => {
    it('accredits with observations when the company has not evaluated', () => {
      const result = calculateAccreditationStatus({ ...base, companyEvaluationScore: null })

      expect(result.level).toBe('ACREDITADO_CON_OBSERVACIONES')
      expect(result.reasons).toEqual(['falta evaluación de la empresa o es baja'])
    })

    it('accredits with observations when the company score is below 3', () => {
      const result = calculateAccreditationStatus({ ...base, companyEvaluationScore: 2.5 })

      expect(result.level).toBe('ACREDITADO_CON_OBSERVACIONES')
      expect(result.reasons).toEqual(['falta evaluación de la empresa o es baja'])
    })

    it('treats a company score of exactly 3 as passing', () => {
      const result = calculateAccreditationStatus({ ...base, companyEvaluationScore: 3 })

      expect(result.level).toBe('ACREDITADO')
      expect(result.reasons).toHaveLength(0)
    })

    it('treats a company score of 0 like a low score, not like a missing one', () => {
      const result = calculateAccreditationStatus({ ...base, companyEvaluationScore: 0 })

      expect(result.level).toBe('ACREDITADO_CON_OBSERVACIONES')
    })
  })

  describe('placementStatus outside ABANDONED and SUSPENDED', () => {
    it.each(['COMPLETED', 'ACTIVE', 'PENDING_DOCS', 'DESCONOCIDO'])(
      'does not change the result when the status is %s',
      (placementStatus) => {
        const result = calculateAccreditationStatus({ ...base, placementStatus })

        expect(result.level).toBe('ACREDITADO')
      },
    )
  })

  describe('completionPercentage', () => {
    it('rounds to the nearest integer', () => {
      expect(calculateAccreditationStatus({ ...base, approvedHours: 100 }).completionPercentage).toBe(42)
      expect(calculateAccreditationStatus({ ...base, approvedHours: 101 }).completionPercentage).toBe(42)
      expect(calculateAccreditationStatus({ ...base, approvedHours: 102 }).completionPercentage).toBe(43)
    })

    it('is not capped at 100 when approved hours exceed the required ones', () => {
      const result = calculateAccreditationStatus({ ...base, approvedHours: 360 })

      expect(result.completionPercentage).toBe(150)
    })

    it('is computed for ABANDONED and SUSPENDED placements too', () => {
      expect(calculateAccreditationStatus({ ...base, approvedHours: 60, placementStatus: 'ABANDONED' }).completionPercentage).toBe(25)
      expect(calculateAccreditationStatus({ ...base, approvedHours: 60, placementStatus: 'SUSPENDED' }).completionPercentage).toBe(25)
    })

    it('is 0 when no hours are approved', () => {
      expect(calculateAccreditationStatus({ ...base, approvedHours: 0 }).completionPercentage).toBe(0)
    })
  })

  describe('requiredHours of 0 (current behavior)', () => {
    it('yields NaN as the percentage when nothing is required and nothing is approved', () => {
      const result = calculateAccreditationStatus({ ...base, requiredHours: 0, approvedHours: 0 })

      expect(result.completionPercentage).toBeNaN()
      expect(result.level).toBe('ACREDITADO')
    })

    it('yields Infinity as the percentage when nothing is required but some hours are approved', () => {
      const result = calculateAccreditationStatus({ ...base, requiredHours: 0, approvedHours: 10 })

      expect(result.completionPercentage).toBe(Infinity)
      expect(result.level).toBe('ACREDITADO')
    })
  })
})
