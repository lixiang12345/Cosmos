import { describe, expect, it } from 'vitest'
import { loadObjectStorageConfig } from './object-storage-config.js'

const configured = {
  NODE_ENV: 'production',
  OBJECT_STORAGE_ENDPOINT: 'https://objects.example.test',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'cosmos-production',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'access-id',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret-value',
}

describe('Object Storage configuration', () => {
  it('requires complete storage configuration in production', () => {
    expect(() => loadObjectStorageConfig({ NODE_ENV: 'production' })).toThrow('must be configured')
    expect(() => loadObjectStorageConfig({ ...configured, OBJECT_STORAGE_BUCKET: '' })).toThrow('complete')
  })

  it('allows no storage only in local environments and validates endpoint security', () => {
    expect(loadObjectStorageConfig({ NODE_ENV: 'development' })).toBeUndefined()
    expect(loadObjectStorageConfig({
      ...configured,
      NODE_ENV: 'development',
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000/',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    })).toMatchObject({ endpoint: 'http://127.0.0.1:9000', forcePathStyle: true })
    expect(() => loadObjectStorageConfig({
      ...configured, OBJECT_STORAGE_ENDPOINT: 'http://objects.example.test',
    })).toThrow('HTTPS')
  })
})
