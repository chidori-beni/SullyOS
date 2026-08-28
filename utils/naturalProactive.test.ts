import { describe, expect, it } from 'vitest';
import { buildFallbackNaturalProfile, decideNaturalProactive, enrichNaturalProfileForCharacter, naturalCheckWindowMinutes, naturalSilenceIntensity, naturalUnansweredHardCap, NATURAL_BATCH_HARD_CAP, NATURAL_UNANSWERED_HARD_CAP, NATURAL_UNANSWERED_PENALTY_CAP, nextNaturalCheckAt } from './naturalProactive';
import type { CharacterProfile, NaturalProactiveProfile } from '../types';

const profile: NaturalProactiveProfile = {
  version: 1,
  archetype: '测试',
  summary: '测试画像',
  weights: { silence: 0.5, timeOfDay: 0.1, emotion: 0.15, pendingTopic: 0.2, spontaneousThought: 0.05 },
  silenceSaturationHours: 4,
  quietHours: [0, 8],
  threshold: 0.5,
  spontaneousChancePerDay: 0,
  derivedAt: 1,
  source: 'fallback',
};

const decide = (overrides: Partial<Parameters<typeof decideNaturalProactive>[0]> = {}) =>
  decideNaturalProactive({
    nowMs: Date.parse('2026-08-23T12:00:00Z'),
    lastUserMessageAt: Date.parse('2026-08-23T04:00:00Z'),
    recentSelfSendAts: [],
    unansweredCount: 0,
    random01: 0.8,
    profile,
    intensity: 'normal',
    bias: 0,
    tzId: 'UTC',
    ...overrides,
  });

describe('自然主动决策', () => {
  it('不同热络程度共用 20 条最终保险，但检查频率不同', () => {
    expect(naturalUnansweredHardCap('low')).toBe(NATURAL_UNANSWERED_HARD_CAP);
    expect(naturalUnansweredHardCap('normal')).toBe(NATURAL_UNANSWERED_HARD_CAP);
    expect(naturalUnansweredHardCap('high')).toBe(NATURAL_UNANSWERED_HARD_CAP);
    expect(NATURAL_BATCH_HARD_CAP).toBe(20);
    expect(naturalCheckWindowMinutes('low', 0)).toBe(30);
    expect(naturalCheckWindowMinutes('low', 0.999999)).toBe(60);
    expect(naturalCheckWindowMinutes('normal', 0)).toBe(15);
    expect(naturalCheckWindowMinutes('normal', 0.999999)).toBe(30);
    expect(naturalCheckWindowMinutes('high', 0)).toBe(8);
    expect(naturalCheckWindowMinutes('high', 0.999999)).toBe(20);
  });

  it('Worker 晚到时从现在重新排，不补跑过期时间线', () => {
    const nowMs = Date.parse('2026-08-23T12:00:00Z');
    expect(nextNaturalCheckAt(nowMs - 60 * 60_000, nowMs, 15)).toBe(nowMs + 15 * 60_000);
    expect(nextNaturalCheckAt(nowMs, nowMs, 15)).toBe(nowMs + 15 * 60_000);
  });

  it('沉默足够久且没有未回复消息时允许联系', () => {
    expect(decide().shouldSend).toBe(true);
  });

  it('刚主动联系过时不会机械连发', () => {
    const nowMs = Date.parse('2026-08-23T12:00:00Z');
    expect(decide({ nowMs, recentSelfSendAts: [nowMs - 5 * 60_000] }).shouldSend).toBe(false);
  });

  it('连续未获回复达到 20 条最终保险后停止', () => {
    expect(decide({ intensity: 'low', unansweredCount: 20 }).shouldSend).toBe(false);
    expect(decide({ intensity: 'normal', unansweredCount: 20 }).shouldSend).toBe(false);
    expect(decide({ intensity: 'high', unansweredCount: 20 }).shouldSend).toBe(false);
  });

  it('沉默超过饱和点后仍继续加分，不再停在 1', () => {
    // 早期版本饱和于 1：沉默 3 倍饱和时长和 1 倍完全同分，于是任何固定扣分一旦压过
    // 阈值就永远翻不回来。这里锁住「越久越高、但涨得越来越慢」。
    expect(naturalSilenceIntensity(4, 4)).toBe(1);
    expect(naturalSilenceIntensity(8, 4)).toBeCloseTo(1.5, 5);
    expect(naturalSilenceIntensity(16, 4)).toBeCloseTo(2, 5);
    // 上限封在 2，再久也不会无限膨胀成催命连发。
    expect(naturalSilenceIntensity(4000, 4)).toBe(2);
    expect(naturalSilenceIntensity(2, 4)).toBeCloseTo(0.5, 5);
    expect(naturalSilenceIntensity(0, 4)).toBe(0);
  });

  it('未回复扣分收敛但不掐死：再沉默久一点仍能重新开口', () => {
    const nowMs = Date.parse('2026-08-23T12:00:00Z');
    // 3 条未回复已经吃满扣分上限，短沉默时确实压得住。
    const shortSilence = decide({
      nowMs,
      lastUserMessageAt: nowMs - 2 * 3_600_000,
      unansweredCount: 3,
    });
    expect(shortSilence.shouldSend).toBe(false);
    // 同样 3 条未回复，沉默拉长之后必须能翻回来——这正是「隔一阵又想起你」。
    const longSilence = decide({
      nowMs,
      lastUserMessageAt: nowMs - 20 * 3_600_000,
      unansweredCount: 3,
    });
    expect(longSilence.shouldSend).toBe(true);
    // 扣分吃满之后不再随条数继续加深，唯一的终止条件是 20 条硬上限。
    expect(NATURAL_UNANSWERED_PENALTY_CAP).toBe(0.24);
    const many = decide({ nowMs, lastUserMessageAt: nowMs - 20 * 3_600_000, unansweredCount: 19 });
    expect(many.score).toBeCloseTo(longSilence.score, 5);
    expect(many.shouldSend).toBe(true);
    expect(decide({ nowMs, lastUserMessageAt: nowMs - 20 * 3_600_000, unansweredCount: 20 }).shouldSend)
      .toBe(false);
  });

  it('安静时段压低联系冲动', () => {
    expect(decide({ nowMs: Date.parse('2026-08-23T03:00:00Z') }).shouldSend).toBe(false);
  });

  it('本地兜底画像会识别人设里的克制与黏人倾向', () => {
    const reserved = buildFallbackNaturalProfile({ name: 'A', description: '寡言、克制、慢热', systemPrompt: '', memories: [] } as unknown as CharacterProfile);
    const clingy = buildFallbackNaturalProfile({ name: 'B', description: '敏感又有点黏人，很容易挂念对方', systemPrompt: '', memories: [] } as unknown as CharacterProfile);
    expect(reserved.threshold).toBeGreaterThan(clingy.threshold);
    expect(reserved.silenceSaturationHours).toBeGreaterThan(clingy.silenceSaturationHours);
  });

  it('每次只是重新确认是否要发消息，检查间隔为 15 到 30 分钟', () => {
    expect(decide({ random01: 0 }).nextCheckMinutes).toBe(15);
    expect(decide({ random01: 0.999999 }).nextCheckMinutes).toBe(30);
  });

  it('情侣且异地时会识别关系并提高主动联系倾向', () => {
    const char = {
      name: 'B',
      description: '我们是恋人，目前异地，只能通过手机联系。',
      systemPrompt: '',
      memories: [],
    } as unknown as CharacterProfile;
    const inferred = buildFallbackNaturalProfile(char);
    expect(inferred.relationship).toBe('romantic');
    expect(inferred.longDistance).toBe(true);
    expect(inferred.threshold).toBeLessThan(0.5);
    const enriched = enrichNaturalProfileForCharacter({ ...profile }, char);
    expect(enriched.relationship).toBe('romantic');
    expect(enriched.longDistance).toBe(true);
    expect(decide({ profile }).score + 0.15).toBeLessThanOrEqual(
      decide({ profile: enriched }).score,
    );
  });
});
