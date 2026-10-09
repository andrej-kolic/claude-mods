export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  contextPercent?: number
  usd?: number
  rateLimits: LimitReading[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { reading: Reading | null }
  }
}
