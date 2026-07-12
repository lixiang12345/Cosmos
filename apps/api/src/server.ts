import { createApp } from './app.js'

const app = createApp({
  logger: true,
  corsOrigin: process.env.CORS_ORIGIN ?? false,
})
const port = Number.parseInt(process.env.PORT ?? '8787', 10)
const host = process.env.HOST ?? '0.0.0.0'

const close = async () => {
  await app.close()
  process.exit(0)
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

try {
  await app.listen({ host, port })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}
