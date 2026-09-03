import { describe, expect, it } from 'vitest';
import { CARD_MESSAGE_TYPES, cardHookProps, isCardMessage, resolveCardHook } from './chatCardHooks';
import { CHAT_CARD_CATALOG } from './chatCardCss';

describe('resolveCardHook', () => {
  it('普通文字消息不是卡片，一个标记都不挂', () => {
    expect(resolveCardHook({ role: 'assistant', type: 'text', content: '你好' })).toBeNull();
    expect(cardHookProps({ role: 'user', type: 'text' })).toEqual({});
    expect(isCardMessage({ role: 'assistant', type: 'image' })).toBe(false);
  });

  it('彼方卡片按消息 type 标记', () => {
    expect(resolveCardHook({ role: 'assistant', type: 'vr_card' })).toEqual({ kind: 'vr_card' });
    expect(cardHookProps({ role: 'assistant', type: 'vr_card' })).toEqual({ 'data-card': 'vr_card' });
  });

  it('score_card 的子类型从 metadata 取，取不到再回落到 content 里的 JSON', () => {
    expect(resolveCardHook({
      role: 'assistant', type: 'score_card', metadata: { scoreCard: { type: 'diary_card' } },
    })).toEqual({ kind: 'score_card', sub: 'diary_card' });

    // 历史消息只把 JSON 塞在 content 里
    expect(resolveCardHook({
      role: 'assistant', type: 'score_card', content: '{"type":"quiz_card","score":3}',
    })).toEqual({ kind: 'score_card', sub: 'quiz_card' });

    // 两边都没有子类型时只挂 data-card，不挂一个空的 data-card-sub
    expect(cardHookProps({ role: 'assistant', type: 'score_card', content: '不是 JSON' }))
      .toEqual({ 'data-card': 'score_card' });
  });

  it('系统事件卡统一归到 data-card="system"，靠 source 细分', () => {
    expect(resolveCardHook({ role: 'system', metadata: { source: 'call-end-popup' } }))
      .toEqual({ kind: 'system', sub: 'call-end-popup' });
    expect(resolveCardHook({ role: 'system', metadata: { source: 'incoming-call-missed' } }))
      .toEqual({ kind: 'system', sub: 'incoming-call-missed' });
    expect(resolveCardHook({ role: 'system', type: 'score_card', metadata: { scoreCard: { type: 'guidebook_card' } } }))
      .toEqual({ kind: 'system', sub: 'guidebook_card' });
  });

  it('没有 source 的系统消息是那条灰色日志小胶囊', () => {
    expect(resolveCardHook({ role: 'system', type: 'system', content: '[System: 添加了纪念日]' }))
      .toEqual({ kind: 'system', sub: 'system-log' });
  });

  it('空消息不会炸', () => {
    expect(resolveCardHook(null)).toBeNull();
    expect(resolveCardHook(undefined)).toBeNull();
    expect(cardHookProps(null)).toEqual({});
  });
});

describe('卡片名录与实际钩子保持一致', () => {
  it('CARD_MESSAGE_TYPES 里的每种卡片都在名录里有条目', () => {
    const catalogCards = new Set(CHAT_CARD_CATALOG.map(entry => entry.card));
    const missing = [...CARD_MESSAGE_TYPES].filter(type => !catalogCards.has(type));
    expect(missing).toEqual([]);
  });

  it('名录里的 data-card 值不是凭空写的（system 之外都得是真的消息 type）', () => {
    const unknown = CHAT_CARD_CATALOG
      .filter(entry => entry.card !== 'system' && !CARD_MESSAGE_TYPES.has(entry.card))
      .map(entry => entry.card);
    expect(unknown).toEqual([]);
  });

  it('名录里没有重复条目', () => {
    const keys = CHAT_CARD_CATALOG.map(entry => `${entry.card}/${entry.sub || ''}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
