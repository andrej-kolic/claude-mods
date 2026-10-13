import type { On } from 'claude-code';
import { describe, type Engine, expect, mock, test } from 'claude-code/testing';
import {
  completeTurn,
  engineBeneath,
  MODEL,
  modelBeneath,
  NOW,
  SUMMARY,
  sessionEventsBeneath,
  startTurn,
  step,
  turnsBeneath,
  usage,
} from './helpers';

// The plugin's state as it last wrote it, by key; a key never written is absent.
function stateWrites(on: On): Record<string, unknown> {
  const written: Record<string, unknown> = {};
  on('state.set', (_$, e, next) => {
    written[e.key] = e.value;
    return next(e);
  });

  return written;
}

// What Claude Code reported in the live probe's `--continue` after 461 s (plan A7).
const resume = ($: Engine, source: 'resume' | 'fork' = 'resume') =>
  $.classic.SessionStart({
    source,
    seconds_since_last_response: 461,
    context_tokens: 38_863,
    prompt_cache_likely_expired: true,
    estimated_cache_write_usd: 0.3109,
  });

const compact = (
  $: Engine,
  trigger: 'manual' | 'auto' | 'precompute' = 'manual',
  agentId?: string,
) =>
  $.session.compact({
    trigger,
    messages: SUMMARY,
    ...(agentId && { agentId }),
  });

describe('last request', () => {
  test('savesTheTimeAndTheWholeContext_ofAMainConversationRequest', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [usage(2, 23_410, 15_245, 300)]);

    await step($);

    expect(state.lastRequest).toEqual({ at: NOW, tokens: 38_957 });
  });

  // A tool turn makes several requests; each carries the whole context, so summing them would count it twice.
  test('keepsTheLatestRequestsSize_notTheTurnsSum', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [
      usage(2, 27_298, 11_405, 100),
      usage(2, 38_703, 155, 50),
    ]);

    await step($, 0);
    await clock.advance(2_000);
    await step($, 1);

    expect(state.lastRequest).toEqual({ at: NOW + 2_000, tokens: 38_910 });
  });

  test('ignoresASubagentsRequest', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [usage(2, 38_000, 100, 50), usage(0, 0, 0, 10)]);

    await step($);
    await step($, 0, 'agent-1');

    expect(state.lastRequest).toEqual({ at: NOW, tokens: 38_152 });
    expect(state.cacheSeen).toEqual({ model: MODEL, cached: true });
  });

  test('keepsThePreviousRequest_whenAResponseCarriesNoUsage', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [usage(2, 38_000, 100, 50), null]);

    await step($);
    await step($, 1);

    expect(state.lastRequest).toEqual({ at: NOW, tokens: 38_152 });
  });

  test('seesNoCaching_whenARequestReadsAndWritesNoCache', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [usage(38_663, 0, 0, 5)]);

    await step($);

    expect(state.cacheSeen).toEqual({ model: MODEL, cached: false });
  });

  // The first request of a session writes the cache and reads none; that is caching at work.
  test('seesCaching_whenARequestOnlyWritesTheCache', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [usage(2, 0, 38_787, 5)]);

    await step($);

    expect(state.cacheSeen).toEqual({ model: MODEL, cached: true });
  });

  // The latest reply counts: caching can come back on, as after a /model change away from a switched-off model.
  test('keepsWhatTheLatestReplyShowed', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [
      usage(38_663, 0, 0, 5),
      usage(2, 0, 38_787, 5, 'claude-opus-5-5'),
    ]);

    await step($);
    await step($);

    expect(state.cacheSeen).toEqual({ model: 'claude-opus-5-5', cached: true });
  });
});

describe('working', () => {
  test('isWorking_fromTurnStartUntilTurnComplete', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    turnsBeneath(on);
    const state = stateWrites(on);

    await startTurn($);
    expect(state.working).toBe(true);
    await completeTurn($);
    expect(state.working).toBe(false);
  });

  test('stopsWorking_whenTheTurnIsInterruptedOrFails', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    turnsBeneath(on);
    const state = stateWrites(on);

    for (const reason of ['aborted', 'error'] as const) {
      await startTurn($);
      await completeTurn($, reason);
      expect(state.working).toBe(false);
    }
  });

  test('staysWorking_whenASubagentsRunCompletesMidTurn', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    turnsBeneath(on);
    const state = stateWrites(on);

    await startTurn($);
    await completeTurn($, 'answer', 'agent-1');

    expect(state.working).toBe(true);
  });
});

describe('session changes', () => {
  test('takesTheLastRequestAndCacheVerdict_fromAResumeOrFork', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    const state = stateWrites(on);

    for (const source of ['resume', 'fork'] as const) {
      await resume($, source);

      expect(state.lastRequest).toEqual({ at: NOW - 461_000, tokens: 38_863 });
      expect(state.resumed).toEqual({ cacheLikelyExpired: true });
    }
  });

  // Claude Code's verdict was about the pause before the resume; the first request answers it.
  test('dropsTheResumeVerdict_onTheFirstRequest', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    const state = stateWrites(on);
    modelBeneath(on, [usage(2, 0, 39_026, 5)]);

    await resume($);
    await step($);

    expect(state.resumed).toBeNull();
    expect(state.lastRequest).toEqual({ at: NOW, tokens: 39_033 });
  });

  test('forgetsTheLastRequest_afterClear', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    const state = stateWrites(on);

    await resume($);
    await $.classic.SessionStart({ source: 'clear' });

    expect(state.lastRequest).toBeNull();
    expect(state.resumed).toBeNull();
  });

  test('leavesTheLastRequestAlone_atStartup', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    const state = stateWrites(on);

    await $.classic.SessionStart({ source: 'startup' });

    expect('lastRequest' in state).toBe(false);
  });

  // 400k tokens compacted to a 30k summary: a warning about re-reading 400k would be wrong.
  test('forgetsTheSizeAndResumeVerdict_afterAManualOrAutoCompaction', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    const state = stateWrites(on);

    for (const trigger of ['manual', 'auto'] as const) {
      await resume($);
      await compact($, trigger);

      expect(state.lastRequest).toBeNull();
      expect(state.resumed).toBeNull();
    }
  });

  test('keepsTheSize_whenACompactionIsPrecomputedForASubagentOrVetoed', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on, 'blocked by a PreCompact hook');
    const state = stateWrites(on);

    await resume($);
    await compact($, 'precompute');
    await compact($, 'manual', 'agent-1');
    await compact($, 'manual');

    expect(state.lastRequest).toEqual({ at: NOW - 461_000, tokens: 38_863 });
    expect(state.resumed).toEqual({ cacheLikelyExpired: true });
  });
});
