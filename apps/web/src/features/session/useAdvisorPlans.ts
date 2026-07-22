import type { AdvisorPlanDto } from '@cosmos/contracts'
import { useEffect, useState } from 'react'
import { listAdvisorPlans, type CosmosApiAuthContext } from '../../services/cosmosApi'

const ADVISOR_PLAN_POLL_MS = 2_000

export type AdvisorPlanState = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  plans: AdvisorPlanDto[]
  error?: string
  replacePlan?: (plan: AdvisorPlanDto) => void
}

export function useAdvisorPlans(options: {
  organizationId: string
  spaceId: string
  sessionId?: string
  credentialVersion: number
  auth: CosmosApiAuthContext
  enabled: boolean
  pollMs?: number
}) {
  const { organizationId, spaceId, sessionId, credentialVersion, auth, enabled, pollMs = ADVISOR_PLAN_POLL_MS } = options
  const requestKey = `${organizationId}\u0000${spaceId}\u0000${sessionId ?? ''}\u0000${credentialVersion}`
  const [request, setRequest] = useState<(AdvisorPlanState & { key: string })>()
  useEffect(() => {
    if (!enabled || !sessionId) return
    const controller = new AbortController()
    let timer: number | undefined
    let first = true
    const poll = async () => {
      try {
        const response = await listAdvisorPlans(organizationId, spaceId, sessionId, auth, controller.signal)
        if (controller.signal.aborted) return
        setRequest({ key: requestKey, status: 'ready', plans: response.items })
        first = false
        timer = window.setTimeout(() => { void poll() }, pollMs)
      } catch (cause) {
        if (controller.signal.aborted) return
        setRequest((current) => ({
          key: requestKey,
          status: 'error',
          plans: first || current?.key !== requestKey ? [] : current.plans,
          error: cause instanceof Error ? cause.message : 'Unable to load Advisor plans.',
        }))
        timer = window.setTimeout(() => { void poll() }, pollMs)
      }
    }
    void poll()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      controller.abort()
    }
  }, [auth, enabled, organizationId, pollMs, requestKey, sessionId, spaceId])
  const replacePlan = (plan: AdvisorPlanDto) => {
    setRequest((current) => current?.key === requestKey
      ? { ...current, plans: [...current.plans.filter((item) => item.id !== plan.id), plan] }
      : current)
  }
  if (!enabled || !sessionId) return { status: 'idle', plans: [], replacePlan } satisfies AdvisorPlanState
  if (request?.key !== requestKey) return { status: 'loading', plans: [], replacePlan } satisfies AdvisorPlanState
  return { ...request, replacePlan }
}
