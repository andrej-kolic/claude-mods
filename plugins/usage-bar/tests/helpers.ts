import type {
  On,
  RenderElement,
  SessionMessage,
  SessionRateLimit,
} from 'claude-code';
import { type Engine, expect, type MockClock, mock } from 'claude-code/testing';

export const abovePrompt = (bodyColumns = 120) =>
  ({
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  }) as const;

export const SURFACES = ['terminal', 'desktop'] as const;

// The clock every test runs at, and the resets the line counts down to from it.
export const NOW = Date.parse('2026-10-09T05:00:00Z');
export const SESSION_PERIOD = '2026-10-09T07:10:00Z'; // (↻ 2h10m)
export const PERIOD = '2026-10-12T07:00:00Z'; // (↻ 3d2h)

export const week = (
  percentUsed: number,
  resetsAt = PERIOD,
): SessionRateLimit => ({
  kind: 'seven_day',
  percentUsed,
  resetsAt,
});

// Stands for the engine beneath the plugin: records toasts, answers session.measure, and runs a clock from NOW.
// `band` is the text drawn beneath the plugin in the row above the prompt (a survey, another mod); without it, core's own drawing.
export function engineBeneath(
  on: On,
  { env = {}, band }: { env?: Record<string, string>; band?: string } = {},
): { toasts: string[]; clock: MockClock } {
  const clock = mock.clock(on, { now: NOW });
  const toasts: string[] = [];
  on('ui.toast', (_$, e) => {
    toasts.push(e.text);

    return { value: undefined };
  });
  // The engine's own measure beneath the plugin, echoing what changed.
  on('session.measure', (_$, e) => ({ changed: e.changed }));
  // What the cache-length rule reads: a Haiku session with no settings, in the environment given.
  mock.env(on, env);
  on('settings.read', () => ({ value: {} }));
  on('session.model', () => ({ value: MODEL }));
  // h is typed loosely (any node, null or undefined); given a component it makes an element.
  // With no band, core answers as it does: its own drawing, an `engine` node, which only some Boxes may hold.
  on('ui.render', ($, e) =>
    band === undefined
      ? { type: 'engine', ref: 0 }
      : (h($.ui.resolve(e).Text, null, band) as RenderElement),
  );

  return { toasts, clock };
}

export const measure = (
  $: Engine,
  rateLimits: SessionRateLimit[],
  percent = 10,
  usd = 0,
) =>
  $.session.measure({
    context: { window: 200_000, percent },
    rateLimits,
    cost: { usd },
    changed: ['context', 'rateLimits', 'cost'],
  });

export const session = (
  percentUsed: number,
  resetsAt = SESSION_PERIOD,
): SessionRateLimit => ({ kind: 'five_hour', percentUsed, resetsAt });

export async function mountLine(
  $: Engine,
  surface: (typeof SURFACES)[number],
  bodyColumns?: number,
) {
  const ui = await $.ui.mount({
    plugin: 'usage-bar',
    surface,
    ...abovePrompt(bodyColumns),
  });
  // Items are drawn apart with a dot between; ` · ` stands for that.
  const boxes = await ui.findAll({ type: 'Box' });
  const lineBox = boxes.find((box) => box.key === 'line');
  const items = boxes
    .filter((box) => box.key?.startsWith('item:'))
    .map((box) => box.text);
  // The whole line sits at the right edge, and the gap either side of each dot is the layout's, not typed spaces.
  expect(lineBox?.props.justifyContent).toBe('flex-end');
  if (items.length > 0) expect(lineBox?.props.columnGap).toBe(1);
  const line = items.length > 0 ? items.join(' · ') : lineBox?.text;
  const texts = await ui.findAll({ type: 'Text' });
  await ui.unmount();

  return { line, texts };
}

export const lineText = async (
  $: Engine,
  surface: (typeof SURFACES)[number],
  bodyColumns?: number,
) => (await mountLine($, surface, bodyColumns)).line;

// The model every stand-in runs: the session's, and the one each reply names.
export const MODEL = 'claude-haiku-5-5';

// Usage as input / cache read / cache write / output tokens, as the API reports a request's.
export const usage = (
  input: number,
  cacheRead: number,
  cacheWrite: number,
  output: number,
  model = MODEL,
) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
  model,
});

// Stands for the model beneath the plugin: each request answers with the next usage given, null for none.
export function modelBeneath(
  on: On,
  usages: (ReturnType<typeof usage> | null)[],
) {
  let next = 0;
  // biome-ignore lint/correctness/useYield: turn.step takes a generator; this one streams no chunks, only the final step.
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: usages[next++] ?? null,
    };
  });
}

export async function step($: Engine, index = 0, agentId?: string) {
  const stream = $.turn.step({
    turnId: 't1',
    index,
    model: MODEL,
    messageCount: 1,
    ...(agentId && { agentId }),
  });
  for await (const _ of stream);
  return stream.result;
}

// Stands for the engine's turns beneath the plugin.
export function turnsBeneath(on: On) {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }));
  on('turn.complete', (_$, e) => ({ text: e.answer }));
}

export const startTurn = ($: Engine) =>
  $.turn.start({ text: 'hi', turnId: 't1' });

export const completeTurn = (
  $: Engine,
  reason: 'answer' | 'aborted' | 'error' = 'answer',
  agentId?: string,
) =>
  $.turn.complete({
    answer: '',
    durationMs: 1_000,
    isAborted: reason === 'aborted',
    turnId: 't1',
    reason,
    ...(agentId && { agentId }),
  });

// A compaction's transcript and what it leaves: a summary message.
export const SUMMARY: SessionMessage[] = [
  { role: 'user', text: 'Summary of the conversation so far.', toolUses: [] },
];

// Stands for the engine's session events beneath the plugin; a compaction is vetoed when `veto` is given.
export function sessionEventsBeneath(on: On, veto?: string) {
  on('classic.SessionStart', () => ({}));
  on('session.compact', () => (veto ? { skip: veto } : { messages: SUMMARY }));
}

// After /resume no reading comes until the next reply (A7.3); the engine still has the conversation's figures.
export const engineUsage = (
  on: On,
  usage: { percent?: number; usd?: number },
) =>
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: {
        window: 200_000,
        ...(usage.percent !== undefined && { percent: usage.percent }),
      },
      rateLimits: [],
      ...(usage.usd !== undefined && { cost: { usd: usage.usd } }),
    },
  }));
