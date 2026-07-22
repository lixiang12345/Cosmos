import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'

export interface ObjectStore {
  put(key: string, content: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
  list(prefix: string, continuationToken?: string, limit?: number): Promise<{
    objects: Array<{ key: string; size: number; lastModified: Date }>
    continuationToken: string | null
  }>
}

export class ObjectStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ObjectStorageError'
  }
}

export type S3ObjectStoreOptions = {
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
}

function safeKey(key: string) {
  if (!key || key.length > 1_024 || key.startsWith('/') || key.includes('..') || /[\r\n]/.test(key)) {
    throw new ObjectStorageError('Object storage key is invalid.')
  }
  return key
}

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client

  constructor(private readonly options: S3ObjectStoreOptions) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? false,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    })
  }

  async put(key: string, content: Buffer, contentType: string) {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: safeKey(key),
        Body: content,
        ContentLength: content.byteLength,
        ContentType: contentType,
        ChecksumSHA256: createHash('sha256').update(content).digest('base64'),
        IfNoneMatch: '*',
      }))
    } catch (error) {
      throw new ObjectStorageError('Object storage upload failed.', { cause: error })
    }
  }

  async get(key: string) {
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: safeKey(key),
      }))
      if (!response.Body) throw new ObjectStorageError('Object storage returned an empty body.')
      return Buffer.from(await response.Body.transformToByteArray())
    } catch (error) {
      if (error instanceof S3ServiceException && (error.name === 'NoSuchKey' || error.$metadata.httpStatusCode === 404)) {
        return null
      }
      throw new ObjectStorageError('Object storage download failed.', { cause: error })
    }
  }

  async delete(key: string) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: safeKey(key) }))
    } catch (error) {
      throw new ObjectStorageError('Object storage cleanup failed.', { cause: error })
    }
  }

  async list(prefix: string, continuationToken?: string, limit = 1_000) {
    try {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.options.bucket,
        Prefix: safeKey(prefix),
        ContinuationToken: continuationToken,
        MaxKeys: limit,
      }))
      return {
        objects: (response.Contents ?? []).flatMap((item) => (
          typeof item.Key === 'string' && item.LastModified instanceof Date
            ? [{ key: item.Key, size: item.Size ?? 0, lastModified: item.LastModified }]
            : []
        )),
        continuationToken: response.IsTruncated ? (response.NextContinuationToken ?? null) : null,
      }
    } catch (error) {
      throw new ObjectStorageError('Object storage listing failed.', { cause: error })
    }
  }
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { content: Buffer; contentType: string; lastModified: Date }>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  async put(key: string, content: Buffer, contentType: string) {
    this.objects.set(safeKey(key), { content: Buffer.from(content), contentType, lastModified: this.now() })
  }

  async get(key: string) {
    const value = this.objects.get(safeKey(key))
    return value ? Buffer.from(value.content) : null
  }

  async delete(key: string) {
    this.objects.delete(safeKey(key))
  }

  async list(prefix: string, continuationToken?: string, limit = 1_000) {
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(safeKey(prefix))).sort()
    const start = continuationToken ? Math.max(0, keys.indexOf(continuationToken) + 1) : 0
    const selected = keys.slice(start, start + limit)
    const next = start + selected.length < keys.length ? selected.at(-1) ?? null : null
    return {
      objects: selected.map((key) => {
        const value = this.objects.get(key)!
        return { key, size: value.content.byteLength, lastModified: new Date(value.lastModified) }
      }),
      continuationToken: next,
    }
  }
}
