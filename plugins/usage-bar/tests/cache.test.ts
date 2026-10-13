import { describe, expect, test } from 'claude-code/testing';
import {
  type CacheInputs,
  type ColdInputs,
  cacheLength,
  isCold,
} from '../hooks/cache';
import { MODEL, session, week } from './helpers';

// A Pro subscriber within the plan's included usage, on Haiku, nothing set: the default 1 hour (plan A2).
const inputs = (over: Partial<CacheInputs> = {}): CacheInputs => ({
  env: {},
  setting: undefined,
  model: MODEL,
  rateLimits: [session(25), week(10)],
  cacheSeen: null,
  written: null,
  ...over,
});

const at = (hhmm: string) => Date.parse(`2026-10-09T${hhmm}:00Z`);

// The plan's step 5 setting: 150k tokens, 1-hour cache, last reply 13:10, now 14:20, idle, default settings.
const coldInputs = (over: Partial<ColdInputs> = {}): ColdInputs => ({
  warnCold: true,
  coldTokens: 100_000,
  working: false,
  lastRequest: { at: at('13:10'), tokens: 150_000 },
  resumed: null,
  cacheLength: '1h',
  lengthFromFile: false,
  now: at('14:20'),
  ...over,
});

describe('cache length', () => {
  test('isOneHour_forASubscriberWithinIncludedUsage', () => {
    expect(cacheLength(inputs())).toBe('1h');
  });

  test('isFiveMinutes_onUsageCredits_whenAWindowIsAt100', () => {
    expect(cacheLength(inputs({ rateLimits: [session(100), week(40)] }))).toBe(
      '5m',
    );
  });

  // An API key or a cloud provider reports no limit windows; so does a gateway's spend_limit alone.
  test('isFiveMinutes_withoutLimitWindows', () => {
    expect(cacheLength(inputs({ rateLimits: [] }))).toBe('5m');
    expect(
      cacheLength(
        inputs({ rateLimits: [{ kind: 'spend_limit', percentUsed: 10 }] }),
      ),
    ).toBe('5m');
  });

  test('takesTheEnvOverTheSetting_andTheSettingOverTheDefault', () => {
    expect(
      cacheLength(inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' } })),
    ).toBe('5m');
    expect(cacheLength(inputs({ setting: '5m' }))).toBe('5m');
    expect(
      cacheLength(
        inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, setting: '5m' }),
      ),
    ).toBe('1h');
    expect(cacheLength(inputs({ rateLimits: [], setting: '1h' }))).toBe('1h');
  });

  test('forcesFiveMinutes_overTheEnvAndSetting', () => {
    expect(
      cacheLength(
        inputs({
          env: {
            FORCE_PROMPT_CACHING_5M: '1',
            CLAUDE_CODE_PROMPT_CACHE_TTL: '1h',
          },
          setting: '1h',
        }),
      ),
    ).toBe('5m');
  });

  // Claude Code reads 1, true, yes and on as on; FORCE_PROMPT_CACHING_5M=true forced 5 minutes, =0 did not (A12).
  test('readsAnOnOffVariable_asClaudeCodeDoes', () => {
    for (const value of ['1', 'true', 'YES', ' on ']) {
      expect(
        cacheLength(inputs({ env: { FORCE_PROMPT_CACHING_5M: value } })),
      ).toBe('5m');
    }
    for (const value of ['0', 'false', '']) {
      expect(
        cacheLength(inputs({ env: { FORCE_PROMPT_CACHING_5M: value } })),
      ).toBe('1h');
    }
  });

  test('isOneHour_withEnable1h_whenNoLimitWindowsShow', () => {
    expect(
      cacheLength(
        inputs({ rateLimits: [], env: { ENABLE_PROMPT_CACHING_1H: '1' } }),
      ),
    ).toBe('1h');
  });

  test('ignoresAnUnknownLengthValue', () => {
    expect(
      cacheLength(
        inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '10m' }, setting: 5 }),
      ),
    ).toBe('1h');
  });

  test('isOff_whenCachingIsDisabled_whateverElseIsSet', () => {
    expect(
      cacheLength(
        inputs({
          env: { DISABLE_PROMPT_CACHING: '1', FORCE_PROMPT_CACHING_5M: '1' },
        }),
      ),
    ).toBe('off');
  });

  test('isOff_onlyForTheSessionsModelsSwitch', () => {
    expect(
      cacheLength(inputs({ env: { DISABLE_PROMPT_CACHING_HAIKU: '1' } })),
    ).toBe('off');
    expect(
      cacheLength(inputs({ env: { DISABLE_PROMPT_CACHING_OPUS: '1' } })),
    ).toBe('1h');
    expect(
      cacheLength(
        inputs({
          model: 'claude-opus-5-5',
          env: { DISABLE_PROMPT_CACHING_OPUS: '1' },
        }),
      ),
    ).toBe('off');
  });

  test('isOff_whenTheLatestReplyOnThisModelUsedNoCache', () => {
    expect(
      cacheLength(inputs({ cacheSeen: { model: MODEL, cached: false } })),
    ).toBe('off');
  });

  test('matchesFableAndMythos_byName', () => {
    expect(
      cacheLength(
        inputs({
          model: 'claude-fable-5-1',
          env: { DISABLE_PROMPT_CACHING_FABLE: '1' },
        }),
      ),
    ).toBe('off');
    expect(
      cacheLength(
        inputs({
          model: 'claude-mythos-1',
          env: { DISABLE_PROMPT_CACHING_MYTHOS: '1' },
        }),
      ),
    ).toBe('off');
    expect(
      cacheLength(
        inputs({
          model: 'claude-fable-5-1',
          env: { DISABLE_PROMPT_CACHING_MYTHOS: '1' },
        }),
      ),
    ).toBe('1h');
  });

  // Live, claude-haiku-4-5 with DISABLE_PROMPT_CACHING_HAIKU=1 still read 23,750 tokens from the cache: Claude
  // Code's switch covers only the family's default model (A15). The reply corrects the family-name guess.
  test('trustsTheReply_overAPerModelSwitch_onTheSameModel', () => {
    const old = {
      model: 'claude-haiku-4-5',
      env: { DISABLE_PROMPT_CACHING_HAIKU: '1' },
    };
    expect(cacheLength(inputs(old))).toBe('off');
    expect(
      cacheLength(
        inputs({
          ...old,
          cacheSeen: { model: 'claude-haiku-4-5-20251001', cached: true },
        }),
      ),
    ).toBe('1h');
  });

  test('ignoresAReplyFromAnotherModel', () => {
    const switched = {
      model: 'claude-opus-5-5',
      env: { DISABLE_PROMPT_CACHING_OPUS: '1' },
    };
    expect(
      cacheLength(
        inputs({ ...switched, cacheSeen: { model: MODEL, cached: true } }),
      ),
    ).toBe('off');
    expect(
      cacheLength(
        inputs({ cacheSeen: { model: 'claude-opus-5-5', cached: false } }),
      ),
    ).toBe('1h');
  });

  test('takesAModelWithAContextSuffix_asTheSameModel', () => {
    expect(
      cacheLength(
        inputs({
          model: 'claude-opus-5-5[1m]',
          cacheSeen: { model: 'claude-opus-5-5', cached: false },
        }),
      ),
    ).toBe('off');
  });

  // The length the latest reply's cache was written with (A18) is what the rules only guess at.
  test('takesTheWrittenLength_overTheRules', () => {
    expect(cacheLength(inputs({ rateLimits: [], written: '1h' }))).toBe('1h');
    expect(cacheLength(inputs({ written: '5m' }))).toBe('5m');
    expect(
      cacheLength(
        inputs({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }, written: '1h' }),
      ),
    ).toBe('1h');
  });

  test('isOff_whateverWasWritten_whenCachingIsDisabled', () => {
    expect(
      cacheLength(
        inputs({ env: { DISABLE_PROMPT_CACHING: '1' }, written: '1h' }),
      ),
    ).toBe('off');
    expect(
      cacheLength(
        inputs({ cacheSeen: { model: MODEL, cached: false }, written: '1h' }),
      ),
    ).toBe('off');
  });
});

describe('cold check', () => {
  test('isCold_whenTheLastReplyIsOlderThanTheCache', () => {
    expect(isCold(coldInputs())).toBe(true);
  });

  test('isNotCold_withinTheCacheLength', () => {
    expect(
      isCold(coldInputs({ lastRequest: { at: at('13:40'), tokens: 150_000 } })),
    ).toBe(false);
    expect(isCold(coldInputs({ now: at('14:10') }))).toBe(false);
  });

  test('isColdAfterFiveMinutes_withAFiveMinuteCache', () => {
    expect(isCold(coldInputs({ cacheLength: '5m', now: at('13:15') }))).toBe(
      false,
    );
    expect(isCold(coldInputs({ cacheLength: '5m', now: at('13:16') }))).toBe(
      true,
    );
  });

  test('isNotCold_underColdTokens', () => {
    expect(
      isCold(coldInputs({ lastRequest: { at: at('11:00'), tokens: 60_000 } })),
    ).toBe(false);
    expect(
      isCold(
        coldInputs({
          lastRequest: { at: at('11:00'), tokens: 60_000 },
          coldTokens: 50_000,
        }),
      ),
    ).toBe(true);
  });

  test('isNotCold_whileATurnRuns', () => {
    expect(isCold(coldInputs({ working: true }))).toBe(false);
  });

  test('isNotCold_whenCachingIsOffOrWarningIsOff', () => {
    expect(isCold(coldInputs({ cacheLength: 'off' }))).toBe(false);
    expect(isCold(coldInputs({ warnCold: false }))).toBe(false);
  });

  // After /clear or a compaction the size is unknown until the next reply.
  test('isNotCold_withoutALastRequest', () => {
    expect(isCold(coldInputs({ lastRequest: null }))).toBe(false);
  });

  // With no length from the file, Claude Code's verdict counts right after a resume.
  test('takesClaudeCodesVerdict_rightAfterAResume_whenTheFileGaveNoLength', () => {
    const resumed = { cacheLikelyExpired: true };
    expect(
      isCold(
        coldInputs({
          resumed,
          lastRequest: { at: at('14:13'), tokens: 150_000 },
        }),
      ),
    ).toBe(true);
  });

  // Claude Code judges by the last reply's split alone, or its rules when that is empty; the file's older write knows.
  test('goesByTheFileLength_overClaudeCodesVerdict_rightAfterAResume', () => {
    const resumed = { cacheLikelyExpired: true };
    const inputs = {
      resumed,
      lengthFromFile: true,
      lastRequest: { at: at('14:00'), tokens: 150_000 },
    };
    expect(isCold(coldInputs(inputs))).toBe(false);
    expect(isCold(coldInputs({ ...inputs, now: at('15:01') }))).toBe(true);
  });

  test('turnsColdByTime_afterAResumeWhoseCacheWasStillWarm', () => {
    const resumed = { cacheLikelyExpired: false };
    expect(
      isCold(
        coldInputs({
          resumed,
          lastRequest: { at: at('14:10'), tokens: 150_000 },
        }),
      ),
    ).toBe(false);
    expect(
      isCold(
        coldInputs({
          resumed,
          lastRequest: { at: at('14:10'), tokens: 150_000 },
          now: at('15:11'),
        }),
      ),
    ).toBe(true);
  });
});
