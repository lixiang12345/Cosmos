import type { NewTaskInput } from '../../types'

const contextUrlPattern = /https?:\/\/(?:www\.)?(?:github\.com|(?:[a-z0-9-]+\.)*slack\.com)\/[^\s<>"']+/gi

export function detectTaskContextItems(description: string): NewTaskInput['contextItems'] {
  const items = new Map<string, NewTaskInput['contextItems'][number]>()

  for (const match of description.matchAll(contextUrlPattern)) {
    const value = match[0].replace(/[\])},.;!?]+$/, '')
    try {
      const url = new URL(value)
      const kind = url.hostname.endsWith('github.com') ? 'github' : 'slack'
      const path = decodeURIComponent(url.pathname).replace(/^\/|\/$/g, '')
      items.set(url.href, {
        id: `${kind}:${url.href}`,
        kind,
        label: kind === 'github'
          ? `GitHub · ${path || url.hostname}`
          : `Slack · ${url.hostname.split('.')[0]}${path ? ` / ${path.split('/')[0]}` : ''}`,
        url: url.href,
      })
    } catch {
      // Ignore partially typed URLs until they become valid.
    }
  }

  return [...items.values()]
}

export function deriveSessionTitle(prompt: string) {
  const firstLine = prompt.trim().split(/\n/)[0] ?? ''
  const sentence = firstLine.split(/[。！？.!?]/)[0]?.trim() ?? firstLine.trim()
  return sentence.slice(0, 56) || 'New session'
}
