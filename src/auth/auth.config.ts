export function parseDurationSeconds(value: string | undefined, fallback: string): number {
  const duration = value ?? fallback
  const match = /^(\d+)([smhd])?$/.exec(duration)
  if (!match) throw new Error(`Duración inválida: ${duration}`)

  const amount = Number(match[1])
  let multiplier: number
  switch (match[2]) {
    case 'd': multiplier = 86400; break
    case 'h': multiplier = 3600; break
    case 'm': multiplier = 60; break
    default: multiplier = 1
  }
  const seconds = amount * multiplier
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`Duración inválida: ${duration}`)
  }
  return seconds
}

export const ACCESS_TOKEN_TTL_SECONDS = parseDurationSeconds(process.env.JWT_EXPIRES_IN, '15m')
export const REFRESH_TOKEN_TTL_SECONDS = parseDurationSeconds(process.env.JWT_REFRESH_EXPIRES_IN, '7d')
