import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAvatarTouchForce, type AvatarTouchHit } from './avatarTouch';
import { normalizeCompanionStartupPerformance } from './companionStartup';
import { live2dActionMatchKey, resolveLive2DActionByKey } from './live2dActionNaming';
import type { AvatarPerformanceDirection } from './avatarPerformance';

/**
 * 换衣服后动作能不能自动适配，取决于一条完整的链路：
 *   保存时写入语义键 → 经过归一化 / 力度处理 / 预设存取都不丢 → 播放前按当前模型解析。
 * 中间任何一环把 `modelActionKey` 吃掉，适配就静默失效（表现为播成别的动作）。
 * 这些测试守的就是这条链。
 */

const direction = (): AvatarPerformanceDirection => ({
  emotion: 'happy',
  gesture: 'talk',
  camera: 'medium',
  gaze: 'viewer',
  intensity: 0.7,
  modelAction: 'motion-9',
  modelActionKey: '坏笑#3#idle',
  modelActions: ['motion-9'],
});

const hit = (): AvatarTouchHit => ({
  nonce: 1,
  x: 0,
  y: 0,
  normalizedX: 0.5,
  normalizedY: 0.5,
  zone: 'head',
  pressure: 0.5,
  durationMs: 200,
} as AvatarTouchHit);

describe('model action key survives the whole pipeline', () => {
  it('is kept by the startup normalizer', () => {
    expect(normalizeCompanionStartupPerformance(direction()).modelActionKey).toBe('坏笑#3#idle');
  });

  it('is kept by the touch force pass', () => {
    expect(applyAvatarTouchForce(direction(), hit()).modelActionKey).toBe('坏笑#3#idle');
  });

  it('is kept through a preset save/load round trip', () => {
    // 预设保存走的是 JSON 深拷贝。
    expect(JSON.parse(JSON.stringify(direction())).modelActionKey).toBe('坏笑#3#idle');
  });
});

describe('an action picked on one outfit lands on the other', () => {
  // 两套衣服的真实命名，位置序号完全对不上。
  const 衬衫 = [
    'X_02_aishang_idle',
    'X_fanshu01_huaixiao3_idle',
    'X_tiaoxiao',
    'X_03_wenrou_idle',
  ].map((rawName, index) => ({ id: `motion-${index}`, rawName }));

  it('re-points the positional id to the right motion in the new outfit', () => {
    const saved = live2dActionMatchKey('X_huaixiao3_idle_微笑'); // 在私服里选的
    const match = resolveLive2DActionByKey(saved, 衬衫);
    expect(match.tier).toBe('exact');
    expect(match.id).toBe('motion-1');
    // 原样沿用保存时的 motion-9 会越界或指向别的动作，这正是要避免的。
    expect(match.id).not.toBe(direction().modelAction);
  });
});

describe('the canvas resolves before it plays, not only for head control', () => {
  const source = () => readFileSync(
    path.resolve(__dirname, '../components/call/Live2DAvatarCanvas.tsx'),
    'utf8',
  );

  it('feeds triggerPerformance the resolved direction', () => {
    // 曾经只把解析结果写进 performanceRef（供机位/锁头用），而
    // triggerPerformance(performance) 仍拿原始 prop——于是真正播放的动作没被换算。
    const text = source();
    expect(text).not.toMatch(/triggerPerformance\(performance\)/);
    expect(text).toMatch(/resolveDirectionModelActions\(performance, configRef\.current\)/);
  });

  it('also resolves what the render loop reads', () => {
    expect(source()).toMatch(/performanceRef\.current = resolveDirectionModelActions\(/);
  });
});
