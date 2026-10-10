import type { EngineInterface, SessionMeasureInput } from 'claude-code'

// shoot.sh appends this, minus its imports, to a copy of usage-bar's register.tsx and routes each
// reading through `fixture`, so it carries a scenario's fixed figures; it also sets SCENARIO.
type Scenario = 'normal' | 'yellow' | 'red'
const SCENARIO = 'normal' as Scenario

const PERCENTS: Record<Scenario, { session: number; week: number }> = {
  normal: { session: 41, week: 18 },
  yellow: { session: 78, week: 18 },
  red: { session: 41, week: 96 },
}

export async function fixture($: EngineInterface, e: SessionMeasureInput): Promise<SessionMeasureInput> {
  // Whole minutes from now, so the countdown reads 2h10m and 3d2h for the first minute after the reading.
  const now = await $.clock.now()
  const resetsIn = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
  const { session, week } = PERCENTS[SCENARIO]

  return {
    ...e,
    context: { ...e.context, percent: 62 },
    cost: { usd: 1.84 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: session, resetsAt: resetsIn(130) },
      { kind: 'seven_day', percentUsed: week, resetsAt: resetsIn(74 * 60) },
    ],
  }
}
