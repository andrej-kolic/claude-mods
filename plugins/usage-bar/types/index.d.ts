export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

export type Reading = {
  contextPercent?: number
  usd?: number
  rateLimits: LimitReading[]
}

// The main conversation's latest model request: when its response arrived, and the context it carried
// (input + cache read + cache write + output tokens).
export type LastRequest = { at: number; tokens: number }

// Claude Code's verdict on the cache when a session was resumed or forked, kept until its first request.
export type Resumed = { cacheLikelyExpired: boolean }

// What the main conversation's latest reply showed: the model that answered (`claude-haiku-4-5-20251001`) and
// whether the request read or wrote the prompt cache.
export type CacheSeen = { model: string; cached: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { reading: Reading | null; minute: number; lastRequest: LastRequest | null; cacheSeen: CacheSeen | null; working: boolean; resumed: Resumed | null }
  }
}
