import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'

export interface ObjectStore {
  put(key: string, content: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
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
}

export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { content: Buffer; contentType: string }>()

  async put(key: string, content: Buffer, contentType: string) {
    this.objects.set(safeKey(key), { content: Buffer.from(content), contentType })
  }

  async get(key: string) {
    const value = this.objects.get(safeKey(key))
    return value ? Buffer.from(value.content) : null
  }

  async delete(key: string) {
    this.objects.delete(safeKey(key))
  }
}
