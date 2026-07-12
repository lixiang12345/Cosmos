export type ApiConfig = {
  host: string
  port: number
  corsOrigin: boolean | string
  databaseUrl?: string
}

function parsePort(value: string | undefined) {
  const port = Number.parseInt(value ?? '8787', 10)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.')
  }
  return port
}

function parseCorsOrigin(value: string | undefined, environment: string | undefined) {
  const origin = value?.trim()
  if (environment === 'production' && !origin) {
    throw new Error('CORS_ORIGIN is required in production.')
  }
  return origin || false
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const databaseUrl = env.DATABASE_URL?.trim()
  if (env.NODE_ENV === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL is required in production.')
  }

  return {
    host: env.HOST?.trim() || '0.0.0.0',
    port: parsePort(env.PORT),
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN, env.NODE_ENV),
    databaseUrl: databaseUrl || undefined,
  }
}
