export type ObjectStorageConfig = {
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
}

function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required when Object Storage is enabled.`)
  return value
}

function parseBoolean(value: string | undefined, name: string, defaultValue: boolean) {
  if (value === undefined) return defaultValue
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false.`)
  return value === 'true'
}

function validateEndpoint(value: string, environment: string) {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('OBJECT_STORAGE_ENDPOINT must be a valid URL.') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(environment === 'development' && url.protocol === 'http:' && loopback)) {
    throw new Error('OBJECT_STORAGE_ENDPOINT must use HTTPS except for development loopback storage.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('OBJECT_STORAGE_ENDPOINT must not contain credentials, query, or fragment.')
  }
  return url.toString().replace(/\/$/, '')
}

export function loadObjectStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
  environment = env.NODE_ENV?.trim() || 'development',
): ObjectStorageConfig | undefined {
  const names = [
    'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_REGION', 'OBJECT_STORAGE_BUCKET',
    'OBJECT_STORAGE_ACCESS_KEY_ID', 'OBJECT_STORAGE_SECRET_ACCESS_KEY',
  ]
  const configured = names.filter((name) => Boolean(env[name]?.trim())).length
  if (configured === 0) {
    if (environment === 'staging' || environment === 'production') {
      throw new Error('Object Storage must be configured in staging and production.')
    }
    return undefined
  }
  if (configured !== names.length) throw new Error('Object Storage configuration must be complete.')
  const bucket = required(env, 'OBJECT_STORAGE_BUCKET')
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) throw new Error('OBJECT_STORAGE_BUCKET must be a valid bucket name.')
  const region = required(env, 'OBJECT_STORAGE_REGION')
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(region)) throw new Error('OBJECT_STORAGE_REGION must be a valid region.')
  return {
    endpoint: validateEndpoint(required(env, 'OBJECT_STORAGE_ENDPOINT'), environment),
    region,
    bucket,
    accessKeyId: required(env, 'OBJECT_STORAGE_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'OBJECT_STORAGE_SECRET_ACCESS_KEY'),
    forcePathStyle: parseBoolean(env.OBJECT_STORAGE_FORCE_PATH_STYLE, 'OBJECT_STORAGE_FORCE_PATH_STYLE', false),
  }
}
