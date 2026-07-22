import { loadHttpSmokeConfig, runHttpLoad } from './http-smoke-lib.mjs'

try {
  const result = await runHttpLoad(loadHttpSmokeConfig(process.env))
  process.stdout.write(`${JSON.stringify(result.summary)}\n`)
  if (result.failures.length > 0) {
    process.stderr.write(`Load smoke failed: ${result.failures.join('; ')}\n`)
    process.exitCode = 1
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Load smoke failed.'}\n`)
  process.exitCode = 1
}
