// The cache warning's rules as plain functions: no engine calls, so they read and test on their own.
// register.tsx gathers their inputs from the engine and the plugin's state.

import type { CacheSeen, CacheWritten, LastRequest, LimitReading, Resumed } from '../types'

// How long the main conversation's prompt cache lives, or 'off' when it isn't used.
export type CacheLength = '5m' | '1h' | 'off'

// What the cache length is worked out from: the env vars by name, the promptCacheTtl setting, the session's
// model id as $.session.model() gives it (`claude-haiku-4-5`), the latest limit windows, what the latest
// reply showed (cacheSeen), and the length the latest cache write used (written; null before one).
export type CacheInputs = {
  env: Partial<Record<CacheEnvName, string>>
  setting: unknown
  model: string
  rateLimits: LimitReading[]
  cacheSeen: CacheSeen | null
  written: CacheWritten | null
}

type CacheEnvName =
  | 'DISABLE_PROMPT_CACHING'
  | 'DISABLE_PROMPT_CACHING_HAIKU'
  | 'DISABLE_PROMPT_CACHING_SONNET'
  | 'DISABLE_PROMPT_CACHING_OPUS'
  | 'DISABLE_PROMPT_CACHING_FABLE'
  | 'DISABLE_PROMPT_CACHING_MYTHOS'
  | 'FORCE_PROMPT_CACHING_5M'
  | 'CLAUDE_CODE_PROMPT_CACHE_TTL'
  | 'ENABLE_PROMPT_CACHING_1H'

// Each per-model switch and the models it covers. Claude Code matches Fable and Mythos by these names, but
// Haiku, Sonnet and Opus only on the family's default model (what `opus` resolves to), which a plugin can't
// learn; the family name stands in for it until a reply shows what the cache did (A15).
const MODEL_SWITCHES = [
  ['claude-fable-', 'DISABLE_PROMPT_CACHING_FABLE'],
  ['claude-mythos-', 'DISABLE_PROMPT_CACHING_MYTHOS'],
  ['haiku', 'DISABLE_PROMPT_CACHING_HAIKU'],
  ['sonnet', 'DISABLE_PROMPT_CACHING_SONNET'],
  ['opus', 'DISABLE_PROMPT_CACHING_OPUS'],
] as const

// One model however it is spelled: a reply names `claude-haiku-4-5-20251001` where $.session.model() gives
// `claude-haiku-4-5`, and a context-window suffix (`[1m]`) may follow.
const baseModel = (model: string) => model.replace(/\[.*\]$/, '').replace(/-\d{8}$/, '')

// Off by a switch: all caching, or the model's own.
const switchedOff = (i: CacheInputs) =>
  isOn(i.env.DISABLE_PROMPT_CACHING) || MODEL_SWITCHES.some(([name, env]) => i.model.includes(name) && isOn(i.env[env]))

// Claude Code's own reading of an on/off variable: `1`, `true`, `yes`, `on`, any case.
const isOn = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())

const asLength = (value: unknown) => (value === '5m' || value === '1h' ? value : undefined)

// The limit windows Claude Code reports for a subscription (A9.1); a gateway's spend_limit is not one.
const PLAN_WINDOWS = ['five_hour', 'seven_day']

// A subscriber within the plan's included usage gets 1 hour; on usage credits (a window at 100% while requests
// still go through), with no windows (API key, cloud provider), it is 5 minutes.
function withinIncludedUsage(rateLimits: LimitReading[]): boolean {
  const windows = rateLimits.filter(limit => PLAN_WINDOWS.includes(limit.kind))

  return windows.length > 0 && windows.every(limit => limit.percentUsed < 100)
}

// The first rule that applies, in Claude Code's own order (plan step 4, A9.1, checked live in A12).
export function cacheLength(i: CacheInputs): CacheLength {
  // A reply on this model shows whether caching is on; the switches decide only before one (after a resume or a
  // /model change). Caching off shows as a request that reads and writes no cache (A7.6).
  const seen = i.cacheSeen && baseModel(i.cacheSeen.model) === baseModel(i.model) ? i.cacheSeen.cached : undefined
  if (seen === false || (seen === undefined && switchedOff(i))) return 'off'
  // What the cache was written with is what the rules below only guess at (A18).
  if (i.written !== null) return i.written
  if (isOn(i.env.FORCE_PROMPT_CACHING_5M)) return '5m'

  return (
    asLength(i.env.CLAUDE_CODE_PROMPT_CACHE_TTL) ??
    asLength(i.setting) ??
    (isOn(i.env.ENABLE_PROMPT_CACHING_1H) ? '1h' : withinIncludedUsage(i.rateLimits) ? '1h' : '5m')
  )
}

// The newest row of the conversation file's tail whose reply wrote the cache, by its split (A18). Rows that only
// read the cache split 0 and 0, and say nothing; the tail's first row may be cut in half.
export function writtenLength(tail: string): CacheWritten | undefined {
  for (const line of tail.split('\n').reverse()) {
    const split = parseRow(line)?.message?.usage?.cache_creation
    if ((split?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
    if ((split?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  }

  return undefined
}

type Row = { message?: { usage?: { cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } } } }

function parseRow(line: string): Row | undefined {
  try {
    return JSON.parse(line) as Row
  } catch {
    return undefined
  }
}

const LENGTH_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

// What the check reads: the user's settings (warnCold, coldTokens), whether a turn runs, the last request,
// a resume's verdict, the cache length and whether the conversation file gave it, and the time now.
export type ColdInputs = {
  warnCold: boolean
  coldTokens: number
  working: boolean
  lastRequest: LastRequest | null
  resumed: Resumed | null
  cacheLength: CacheLength
  lengthFromFile: boolean
  now: number
}

// Cold: the next message re-reads the whole context at the cache-write price (plan step 5).
// Right after a resume, Claude Code's own verdict counts only when the file gave no length: it goes by the last
// reply's split alone, and by its rules when that reply only read the cache (A18).
export function isCold(i: ColdInputs): boolean {
  if (!i.warnCold || i.working || i.cacheLength === 'off' || i.lastRequest === null) return false
  if (i.lastRequest.tokens < i.coldTokens) return false
  if (i.resumed?.cacheLikelyExpired && !i.lengthFromFile) return true

  return i.now - i.lastRequest.at > LENGTH_MS[i.cacheLength]
}
