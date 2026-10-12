const DEFAULT_CORS_ORIGIN = 'http://localhost:5173'

export function getAllowedCorsOrigins(configuredOrigins: string | undefined): string[] {
  const origins = configuredOrigins
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  return origins?.length ? origins : [DEFAULT_CORS_ORIGIN]
}
