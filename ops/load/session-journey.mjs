import { loadSessionJourneyConfig, runSessionJourneys } from './session-journey-lib.mjs'

try {
  const result = await runSessionJourneys(loadSessionJourneyConfig(process.env))
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Session journey failed.'}\n`)
  process.exitCode = 1
}
