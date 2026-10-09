export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  contextPercent?: number
  usd?: number
  rateLimits: LimitReading[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { reading: Reading | null }
  }
}
