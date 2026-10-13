import type { On, SessionRateLimit } from 'claude-code';
import {
  describe,
  type Engine,
  expect,
  type MockClock,
  mock,
  test,
} from 'claude-code/testing';
import {
  abovePrompt,
  completeTurn,
  engineBeneath,
  engineUsage,
  lineText,
  MODEL,
  measure,
  modelBeneath,
  mountLine,
  NOW,
  SURFACES,
  session,
  sessionEventsBeneath,
  startTurn,
  step,
  turnsBeneath,
  usage,
  week,
} from './helpers';

// A 150k-token reply at NOW (the test's modelBeneath answers it), on a subscriber's 1-hour cache, then `idle` minutes.
async function replyThenIdle($: Engine, clock: MockClock, idle: number) {
  await measure($, [session(41), week(18)], 62, 1.84);
  await step($);
  await clock.advance(idle * 60_000);
}

// Where Claude Code keeps this session's conversation file, as classic.SessionStart names it.
const TRANSCRIPT = '/Users/u/.claude/projects/p/s.jsonl';

// One reply's row in the conversation file, as Claude Code writes it: the cache write split by length (A18).
const row = (oneHour: number, fiveMinutes: number) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      model: MODEL,
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: oneHour + fiveMinutes,
        cache_read_input_tokens: 150_000,
        output_tokens: 5,
        cache_creation: {
          ephemeral_1h_input_tokens: oneHour,
          ephemeral_5m_input_tokens: fiveMinutes,
        },
      },
    },
  });

// Stands for the conversation file beneath the plugin: each command run reads `rows`, oldest first, or fails
// as a missing file when they are null. Records each command, so a test can tell when the file was read.
function fileBeneath(on: On, rows: string[] | null) {
  const file = { rows, reads: [] as (readonly string[])[] };
  on('process.run', (_$, e) => {
    file.reads.push(e.argv);
    const result = {
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    };

    return {
      value:
        file.rows === null
          ? {
              ...result,
              exitCode: 1,
              stdout: '',
              stderr: `tail: ${TRANSCRIPT}: No such file or directory`,
            }
          : {
              ...result,
              exitCode: 0,
              stdout: file.rows.map((r) => `${r}\n`).join(''),
            },
    };
  });

  return file;
}

// A new session whose conversation file is TRANSCRIPT; a 150k-token turn at NOW with these limit windows,
// then `idle` minutes. The file's rows are whatever fileBeneath holds when the plugin reads it.
async function fileReplyThenIdle(
  $: Engine,
  clock: MockClock,
  rateLimits: SessionRateLimit[],
  idle: number,
) {
  await $.classic.SessionStart({
    source: 'startup',
    transcript_path: TRANSCRIPT,
  });
  await measure($, rateLimits, 62, 1.84);
  await startTurn($);
  await step($);
  await completeTurn($);
  await clock.advance(idle * 60_000);
}

// A resume of TRANSCRIPT: 150k tokens, the last reply `secondsAgo` before NOW, Claude Code's verdict on the cache.
const resumeFile = (
  $: Engine,
  secondsAgo: number,
  cacheLikelyExpired: boolean,
  source: 'resume' | 'fork' = 'resume',
) =>
  $.classic.SessionStart({
    source,
    transcript_path: TRANSCRIPT,
    seconds_since_last_response: secondsAgo,
    context_tokens: 150_000,
    prompt_cache_likely_expired: cacheLikelyExpired,
  });

describe('cold line', () => {
  test('showsCacheColdInRed_afterItsOwnContextItem_onceTheCacheExpires', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    await replyThenIdle($, clock, 61);

    for (const surface of SURFACES) {
      const { line, texts } = await mountLine($, surface);
      expect(line).toBe(
        'context 62% · cache cold · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 1h9m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d)',
      );
      expect(texts.find((t) => t.text === 'cache cold')?.props.color).toBe(
        'error',
      );
    }
  });

  test('showsNoColdItem_withinTheCacheLength', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    await replyThenIdle($, clock, 59);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });

  test('namesItColdOrSnowflake_inTheNarrowerLayouts', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    await replyThenIdle($, clock, 61);

    const layouts = [
      'context 62% · cache cold · $1.84 · session ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 1h9m) · week ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d)',
      'ctx 62% · cold · $1.84 · s ⣿⣿⣿⣀⣀⣀⣀⣀ 41% (↻ 1h9m) · w ⣿⣀⣀⣀⣀⣀⣀⣀ 18% (↻ 3d)',
      'ctx 62% · cold · $1.84 · s 41% (↻ 1h9m) · w 18% (↻ 3d)',
      'ctx 62% · ❆ · $1.84 · s 41% · w 18%',
    ];
    for (const surface of SURFACES) {
      for (const [i, line] of layouts.entries()) {
        expect(await lineText($, surface, line.length)).toBe(line);
        expect(await lineText($, surface, line.length - 1)).toBe(
          layouts[i + 1] ?? line,
        );
      }
    }
  });

  // The docs' "At most" widths: both windows at 100%, $123.45, and the longest countdowns.
  test('needsAtMost101_82_64_40Columns_withTheColdItem', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    await step($);
    await clock.advance(61 * 60_000);
    const longest = (minutes: number) =>
      new Date(NOW + 61 * 60_000 + minutes * 60_000).toISOString();
    await measure(
      $,
      [session(100, longest(4 * 60 + 59)), week(100, longest(23 * 60 + 59))],
      100,
      123.45,
    );

    const widths = [101, 82, 64, 40];
    for (const [i, width] of widths.entries()) {
      const line = await lineText($, 'terminal', width);
      expect(line?.length).toBe(width);
      // The narrowest layout shows even where it doesn't fit.
      if (i < 3)
        expect(await lineText($, 'terminal', width - 1)).not.toBe(line);
      else expect(line).toContain('❆');
    }
  });

  test('turnsCold_onTheMinuteTimer_withoutANewReading', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    on('session.start', (_$, e) => ({ cwd: e.cwd }));
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    await $.session.start({
      cwd: '/',
      surface: 'terminal',
      isInteractive: true,
    });
    await replyThenIdle($, clock, 59);

    const ui = await $.ui.mount({
      plugin: 'usage-bar',
      surface: 'terminal',
      ...abovePrompt(),
    });
    const coldItem = async () =>
      (await ui.findAll({ type: 'Box' })).find((box) => box.key === 'item:1')
        ?.text;
    expect(await coldItem()).toBe('$1.84');
    await clock.advance(2 * 60_000);
    expect(await coldItem()).toBe('cache cold');
    await ui.unmount();
  });

  test('hidesTheColdItem_whileAReplyRuns', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    await replyThenIdle($, clock, 61);

    await startTurn($);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });

  test('showsNoColdItem_whenCachingIsDisabled', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on, {
      env: { DISABLE_PROMPT_CACHING: '1' },
    });
    // With caching off a reply reads and writes no cache, its whole context uncached (A2).
    modelBeneath(on, [usage(150_000, 0, 0, 0)]);
    await replyThenIdle($, clock, 61);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });

  test(
    'showsNoColdItem_whenWarnColdIsOffInConfig',
    { options: { warnCold: false } },
    async ($, on) => {
      mock.store(on);
      const { clock } = engineBeneath(on);
      modelBeneath(on, [usage(2, 150_000, 0, 0)]);
      await replyThenIdle($, clock, 61);

      expect(await lineText($, 'terminal')).not.toContain('cold');
    },
  );

  // The default 100k leaves a 60k conversation alone; a lower coldTokens in /config warns about it.
  test(
    'warnsAboutASmallerConversation_whenColdTokensIsLowered',
    { options: { coldTokens: 50_000 } },
    async ($, on) => {
      mock.store(on);
      const { clock } = engineBeneath(on);
      modelBeneath(on, [usage(2, 60_000, 0, 0)]);
      await replyThenIdle($, clock, 61);

      expect(await lineText($, 'terminal')).toContain('cache cold');
    },
  );

  test('leavesASmallerConversationAlone_withTheDefaultColdTokens', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    modelBeneath(on, [usage(2, 60_000, 0, 0)]);
    await replyThenIdle($, clock, 61);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });
});

describe('cache length from the conversation file', () => {
  // An API key reports no limit windows, so the rules say 5 minutes; the reply's own write says 1 hour.
  test('staysWarmPastFiveMinutes_whenTheFileShowsAOneHourWrite_withoutLimitWindows', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    fileBeneath(on, [row(15_798, 0)]);

    await fileReplyThenIdle($, clock, [], 6);
    expect(await lineText($, 'terminal')).toBe('context 62% · $1.84');
    await clock.advance(55 * 60_000);
    expect(await lineText($, 'terminal')).toBe(
      'context 62% · cache cold · $1.84',
    );
  });

  // Usage credits or a server switch can give a subscriber 5 minutes; only the reply shows it (Still open 1).
  test('turnsColdAfterFiveMinutes_whenTheFileShowsAFiveMinuteWrite_forASubscriber', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    fileBeneath(on, [row(0, 11_237)]);

    await fileReplyThenIdle($, clock, [session(41), week(18)], 6);

    expect(await lineText($, 'terminal')).toContain('cache cold');
  });

  // The review of 2026-10-12: with no windows the rules said 5 minutes, and a warm 1-hour cache showed cold early.
  test('staysWarmFor59Minutes_afterAWarmResumeOfAOneHourCache_withoutLimitWindows', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    engineUsage(on, { percent: 75, usd: 3.2 });
    fileBeneath(on, [row(15_798, 0)]);

    await resumeFile($, 60, false);
    await clock.advance(58 * 60_000);
    expect(await lineText($, 'terminal')).toBe('context 75% · $3.20');
    await clock.advance(2 * 60_000);
    expect(await lineText($, 'terminal')).toBe(
      'context 75% · cache cold · $3.20',
    );
  });

  // A reply that only read the cache has both split fields 0: it says nothing about the length.
  test('skipsARowThatOnlyReadTheCache_forAnOlderWrite', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    fileBeneath(on, [row(15_798, 0), row(0, 0)]);

    await fileReplyThenIdle($, clock, [], 6);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });

  // Resumed 20 minutes after a reply that only read the cache, on an API key: Claude Code's verdict goes by the
  // 5-minute rule, the file's older write says 1 hour (review of 2026-10-12).
  test('staysWarmAfterAResume_whenTheLastReplyOnlyReadAOneHourCache_withoutLimitWindows', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    engineUsage(on, { percent: 75, usd: 3.2 });
    fileBeneath(on, [row(15_798, 0), row(0, 0)]);

    await resumeFile($, 20 * 60, true);

    expect(await lineText($, 'terminal')).toBe('context 75% · $3.20');
  });

  // Reading the file's last bytes starts mid-row; that row is no reason to give up on the rest.
  test('readsTheRowsAfterOneTheReadCutInHalf', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    fileBeneath(on, ['input_tokens":0}}}}', row(15_798, 0)]);

    await fileReplyThenIdle($, clock, [], 6);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });

  // Without windows the rules say 5 minutes: cold after 6.
  test('fallsBackToTheRules_whenNoRowWroteTheCache', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    fileBeneath(on, [row(0, 0)]);

    await fileReplyThenIdle($, clock, [], 6);

    expect(await lineText($, 'terminal')).toContain('cache cold');
  });

  test('fallsBackToTheRules_whenTheFileCantBeRead', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    fileBeneath(on, null);

    await fileReplyThenIdle($, clock, [], 6);

    expect(await lineText($, 'terminal')).toContain('cache cold');
  });

  test('keepsTheLastKnownLength_whenALaterReadFails', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0), usage(2, 150_000, 0, 0)]);
    const file = fileBeneath(on, [row(15_798, 0)]);

    await fileReplyThenIdle($, clock, [], 1);
    file.rows = null;
    await startTurn($);
    await step($);
    await completeTurn($);
    await clock.advance(6 * 60_000);

    expect(await lineText($, 'terminal')).not.toContain('cold');
  });

  // The reply reaches the file 300–600 ms after the request returns (A18); read sooner, the newest row is the
  // previous reply's.
  test('readsTheFileOneSecondAfterAMainTurn_whenItsReplyHasLanded', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    modelBeneath(on, [usage(2, 150_000, 0, 0)]);
    const file = fileBeneath(on, [row(15_798, 0)]);

    await $.classic.SessionStart({
      source: 'startup',
      transcript_path: TRANSCRIPT,
    });
    await measure($, [session(41), week(18)], 62, 1.84);
    await startTurn($);
    await step($);
    await completeTurn($);
    expect(file.reads).toEqual([]);
    await clock.advance(500);
    file.rows = [row(15_798, 0), row(0, 11_237)];
    await clock.advance(499);
    expect(file.reads).toEqual([]);
    await clock.advance(1);
    expect(file.reads).toHaveLength(1);
    expect(file.reads[0]?.at(-1)).toBe(TRANSCRIPT);

    await clock.advance(6 * 60_000);
    expect(await lineText($, 'terminal')).toContain('cache cold');
  });

  // A subagent's run ends mid-turn; its replies go to a file of its own.
  test('doesNotReadTheFile_whenASubagentsRunCompletes', async ($, on) => {
    mock.store(on);
    const { clock } = engineBeneath(on);
    sessionEventsBeneath(on);
    turnsBeneath(on);
    const file = fileBeneath(on, [row(15_798, 0)]);

    await $.classic.SessionStart({
      source: 'startup',
      transcript_path: TRANSCRIPT,
    });
    await startTurn($);
    await completeTurn($, 'answer', 'agent-1');
    await clock.advance(2_000);

    expect(file.reads).toEqual([]);
  });

  // On resume or fork the last reply's row is already in the file (A18 reading 2).
  test('readsTheFileAtOnce_onAResumeOrFork', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    const file = fileBeneath(on, [row(15_798, 0)]);

    await $.classic.SessionStart({
      source: 'startup',
      transcript_path: TRANSCRIPT,
    });
    expect(file.reads).toEqual([]);
    await resumeFile($, 60, false);
    expect(file.reads).toHaveLength(1);
    await resumeFile($, 60, false, 'fork');
    expect(file.reads).toHaveLength(2);
  });

  // An API key reports no windows; the line used to wait for the next reply's reading (review of 2026-10-12).
  test('showsContextCostAndColdAfterAResume_withoutLimitWindows', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    engineUsage(on, { percent: 75, usd: 3.2 });
    fileBeneath(on, [row(15_798, 0)]);

    await resumeFile($, 2 * 3_600, true);

    for (const surface of SURFACES) {
      expect(await lineText($, surface)).toBe(
        'context 75% · cache cold · $3.20',
      );
    }
  });

  test('showsNoDataPlaceholder_afterAResume_whenTheEngineHasNoContextNorLimits', async ($, on) => {
    mock.store(on);
    engineBeneath(on);
    sessionEventsBeneath(on);
    engineUsage(on, {});
    fileBeneath(on, [row(15_798, 0)]);

    await resumeFile($, 2 * 3_600, true);

    expect(await lineText($, 'terminal')).toBe('usage: no data yet');
  });
});
