export interface AccreditationInput {
  placementId: number
  studentName: string
  requiredHours: number
  approvedHours: number
  pendingHours: number
  hasAgreement: boolean
  hasInsurance: boolean
  hasFinalReport: boolean
  tutorEvaluationScore: number | null
  companyEvaluationScore: number | null
  placementStatus: string
}

export type AccreditationLevel =
  | 'ACREDITADO'
  | 'ACREDITADO_CON_OBSERVACIONES'
  | 'PENDIENTE'
  | 'NO_ACREDITADO'

export interface AccreditationResult {
  placementId: number
  studentName: string
  level: AccreditationLevel
  reasons: string[]
  completionPercentage: number
}

/** Nivel y motivos que resuelve una regla cuando aplica. */
export interface AccreditationDecision {
  readonly level: AccreditationLevel
  readonly reasons: readonly string[]
}

/**
 * Una regla de acreditación.
 *
 * - `summary`: la regla en una frase, para revisarla sin abrir la implementación.
 * - `appliesWhen`: cuándo manda esta regla.
 * - `decide`: qué se resuelve cuando manda.
 */
export interface AccreditationRule {
  readonly id: string
  readonly summary: string
  readonly appliesWhen: (input: AccreditationInput) => boolean
  readonly decide: (input: AccreditationInput) => AccreditationDecision
}

const MINIMUM_EVALUATION = 3

/** Motivo de horas pendientes: solo se añade cuando de verdad queda algo por revisar. */
const pendingHours = (input: AccreditationInput, detail: string): string[] =>
  input.pendingHours > 0 ? [`hay ${input.pendingHours} ${detail}`] : []

/**
 * Tabla de decisión de la acreditación, en orden de prioridad.
 *
 * El motor recorre la tabla de arriba abajo y se queda con la primera regla que
 * aplica; las demás no se miran. Por eso:
 * - el orden es la prioridad (una práctica abandonada gana a cualquier otra regla),
 * - ajustar una regla es editar solo su objeto,
 * - añadir una regla es insertar un objeto nuevo en la posición que le toque,
 *   sin tocar las reglas que ya están.
 *
 * La red de tests (`accreditation.spec.ts`, historia E5-01) fija el
 * comportamiento; esta tabla solo cambia cómo está escrita la decisión.
 */
export const ACCREDITATION_RULES: readonly AccreditationRule[] = [
  {
    id: 'placement-abandonado',
    summary: 'Una práctica abandonada nunca se acredita, aunque el expediente esté completo.',
    appliesWhen: (input) => input.placementStatus === 'ABANDONED',
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: ['placement abandonado', ...pendingHours(input, 'horas pendientes sin revisar')],
    }),
  },
  {
    id: 'placement-suspendido',
    summary: 'Una práctica suspendida nunca se acredita; se advierte si el convenio sigue vigente.',
    appliesWhen: (input) => input.placementStatus === 'SUSPENDED',
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: [
        'placement suspendido',
        ...(input.hasAgreement ? ['convenio vigente pese a la suspensión'] : []),
      ],
    }),
  },
  {
    id: 'horas-insuficientes',
    summary: 'Con menos horas aprobadas que las exigidas queda pendiente, y se dice cuántas siguen sin revisar.',
    appliesWhen: (input) => input.approvedHours < input.requiredHours,
    decide: (input) => ({
      level: 'PENDIENTE',
      reasons: ['horas insuficientes', ...pendingHours(input, 'horas pendientes de aprobación')],
    }),
  },
  {
    id: 'falta-convenio',
    summary: 'Sin convenio validado no se acredita; se advierte si el seguro sí está validado.',
    appliesWhen: (input) => !input.hasAgreement,
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: [
        'falta convenio',
        ...(input.hasInsurance ? ['seguro vigente pese a la falta de convenio'] : []),
      ],
    }),
  },
  {
    id: 'falta-seguro',
    summary: 'Sin seguro validado no se acredita, y se avisa de las horas que siguen sin revisar.',
    appliesWhen: (input) => !input.hasInsurance,
    decide: (input) => ({
      level: 'NO_ACREDITADO',
      reasons: ['falta seguro', ...pendingHours(input, 'horas pendientes de aprobación')],
    }),
  },
  {
    id: 'falta-informe-final',
    summary: 'Sin informe final la práctica queda pendiente.',
    appliesWhen: (input) => !input.hasFinalReport,
    decide: () => ({ level: 'PENDIENTE', reasons: ['falta informe final'] }),
  },
  {
    id: 'falta-evaluacion-tutor',
    summary: 'Si el tutor todavía no evaluó, la práctica queda pendiente.',
    appliesWhen: (input) => input.tutorEvaluationScore === null,
    decide: () => ({ level: 'PENDIENTE', reasons: ['falta evaluación del tutor'] }),
  },
  {
    id: 'evaluacion-tutor-baja',
    summary: 'Una nota del tutor por debajo del mínimo no acredita la práctica.',
    appliesWhen: (input) =>
      input.tutorEvaluationScore !== null && input.tutorEvaluationScore < MINIMUM_EVALUATION,
    decide: () => ({
      level: 'NO_ACREDITADO',
      // Llegados aquí el informe final ya está validado: lo exige la regla anterior.
      reasons: [
        'evaluación del tutor por debajo del mínimo',
        'informe final entregado pese a evaluación baja',
      ],
    }),
  },
  {
    id: 'evaluacion-empresa-baja-o-ausente',
    summary: 'Si la empresa no evaluó o evaluó por debajo del mínimo, se acredita con observaciones.',
    appliesWhen: (input) =>
      input.companyEvaluationScore === null || input.companyEvaluationScore < MINIMUM_EVALUATION,
    decide: () => ({
      level: 'ACREDITADO_CON_OBSERVACIONES',
      reasons: ['falta evaluación de la empresa o es baja'],
    }),
  },
]

/** Cuando ninguna regla aplica, el expediente está completo y se acredita. */
const NO_OBSERVATIONS: AccreditationDecision = { level: 'ACREDITADO', reasons: [] }

export function calculateAccreditationStatus(input: AccreditationInput): AccreditationResult {
  const rule = ACCREDITATION_RULES.find((candidate) => candidate.appliesWhen(input))
  const decision = rule ? rule.decide(input) : NO_OBSERVATIONS

  return {
    placementId: input.placementId,
    studentName: input.studentName,
    level: decision.level,
    reasons: [...decision.reasons],
    completionPercentage: Math.round((input.approvedHours / input.requiredHours) * 100),
  }
}
