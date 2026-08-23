import { describe, expect, it } from 'vitest';
import { buildFallbackNaturalProfile, decideNaturalProactive, enrichNaturalProfileForCharacter, naturalUnansweredHardCap } from './naturalProactive';
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
  it('热络程度对应独立的未回复安全上限', () => {
    expect(naturalUnansweredHardCap('low')).toBe(1);
    expect(naturalUnansweredHardCap('normal')).toBe(2);
    expect(naturalUnansweredHardCap('high')).toBe(3);
  });

  it('沉默足够久且没有未回复消息时允许联系', () => {
    expect(decide().shouldSend).toBe(true);
  });

  it('刚主动联系过时不会机械连发', () => {
    const nowMs = Date.parse('2026-08-23T12:00:00Z');
    expect(decide({ nowMs, recentSelfSendAts: [nowMs - 5 * 60_000] }).shouldSend).toBe(false);
  });

  it('连续未获回复达到强度上限后硬停止', () => {
    expect(decide({ intensity: 'low', unansweredCount: 1 }).shouldSend).toBe(false);
    expect(decide({ intensity: 'normal', unansweredCount: 2 }).shouldSend).toBe(false);
    expect(decide({ intensity: 'high', unansweredCount: 3 }).shouldSend).toBe(false);
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
