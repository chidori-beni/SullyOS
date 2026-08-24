import { describe, it, expect } from 'vitest';
import {
  isVoiceMessage,
  countRecentVoiceUsage,
  buildVoiceUsageHint,
  shouldHardBlockVoiceThisTurn,
  buildVoiceHardBlockTail,
  STREAK_LIMIT,
} from './voiceFrequency';
import type { Message } from '../types';

let seq = 0;
const msg = (role: Message['role'], content: string): Message =>
  ({ id: ++seq, charId: 'c', role, type: 'text', content, timestamp: seq } as Message);

const ai = (content: string) => msg('assistant', content);
const user = (content = '嗯') => msg('user', content);
const voice = (text = '行吧') => ai(`<语音>${text}</语音>`);

describe('isVoiceMessage', () => {
  it('认出带 <语音> 标签的 AI 消息', () => {
    expect(isVoiceMessage(voice())).toBe(true);
    expect(isVoiceMessage(ai('<語音>繁體也认</語音>'))).toBe(true);
    expect(isVoiceMessage(ai('<语音 emotion="sad">带属性也认</语音>'))).toBe(true);
  });
  it('普通文字不算', () => {
    expect(isVoiceMessage(ai('就打个字'))).toBe(false);
  });
  it('用户自己发的不算（只统计 AI 的用量）', () => {
    expect(isVoiceMessage(msg('user', '<语音>我说的</语音>'))).toBe(false);
  });
});

describe('countRecentVoiceUsage', () => {
  it('空历史返回全 0', () => {
    expect(countRecentVoiceUsage([])).toEqual({ turns: 0, voiceTurns: 0, streak: 0 });
  });

  it('一轮被切成多个气泡时只算一轮', () => {
    const stats = countRecentVoiceUsage([user(), ai('在'), voice(), ai('就这样')]);
    expect(stats.turns).toBe(1);
    expect(stats.voiceTurns).toBe(1);
  });

  it('这正是按气泡数会算错的地方：3 个气泡 1 条语音 ≠ 33%，而是这一轮发了语音', () => {
    const stats = countRecentVoiceUsage([user(), ai('a'), ai('b'), voice()]);
    expect(stats.voiceTurns / stats.turns).toBe(1);
  });

  it('user 消息隔开就算换轮', () => {
    const stats = countRecentVoiceUsage([user(), voice(), user(), ai('打字'), user(), voice()]);
    expect(stats.turns).toBe(3);
    expect(stats.voiceTurns).toBe(2);
  });

  it('streak 从最近一轮往回数连续的语音轮', () => {
    const stats = countRecentVoiceUsage([user(), ai('打字'), user(), voice(), user(), voice()]);
    expect(stats.streak).toBe(2);
  });

  it('最近一轮是打字时 streak 归零（哪怕更早连着发过）', () => {
    const stats = countRecentVoiceUsage([user(), voice(), user(), voice(), user(), ai('打字')]);
    expect(stats.streak).toBe(0);
    expect(stats.voiceTurns).toBe(2);
  });

  it('只看窗口内的轮数', () => {
    const history: Message[] = [];
    for (let i = 0; i < 20; i++) { history.push(user()); history.push(voice()); }
    expect(countRecentVoiceUsage(history, 10).turns).toBe(10);
  });

  it('system 消息不打断一轮', () => {
    const stats = countRecentVoiceUsage([user(), ai('a'), msg('system', '注入'), voice()]);
    expect(stats.turns).toBe(1);
    expect(stats.voiceTurns).toBe(1);
  });
});

describe('buildVoiceUsageHint', () => {
  it('用量正常时什么都不注入', () => {
    expect(buildVoiceUsageHint({ turns: 10, voiceTurns: 2, streak: 0 })).toBe('');
    expect(buildVoiceUsageHint({ turns: 10, voiceTurns: 3, streak: 1 })).toBe('');
  });

  it('连着两轮语音 → 硬性叫停这一轮', () => {
    const hint = buildVoiceUsageHint({ turns: 5, voiceTurns: 2, streak: 2 });
    expect(hint).toContain('这一轮用打字');
    expect(hint).toContain('连着 2 轮');
  });

  it('总体偏多 → 提醒收敛（阈值收紧到三成，样本窗口收紧到 3 轮）', () => {
    const hint = buildVoiceUsageHint({ turns: 10, voiceTurns: 4, streak: 1 });
    expect(hint).toContain('10 轮里你有 4 轮');
    expect(hint).toContain('优先打字');
  });

  it('样本太少时不下判断（只有两轮，刚开聊别急着管）', () => {
    expect(buildVoiceUsageHint({ turns: 2, voiceTurns: 2, streak: 1 })).toBe('');
  });

  it('三轮就够判断了（MIN_TURNS_FOR_RATIO 收紧到 3，比原来更快反应）', () => {
    const hint = buildVoiceUsageHint({ turns: 3, voiceTurns: 2, streak: 1 });
    expect(hint).toContain('优先打字');
  });

  it('样本少但连着发照样叫停（streak 不看样本量）', () => {
    expect(buildVoiceUsageHint({ turns: 2, voiceTurns: 2, streak: 2 })).toContain('这一轮用打字');
  });

  it('完全没发过语音时保持安静', () => {
    expect(buildVoiceUsageHint({ turns: 10, voiceTurns: 0, streak: 0 })).toBe('');
  });
});

describe('shouldHardBlockVoiceThisTurn / buildVoiceHardBlockTail', () => {
  it('没连着发时不硬性拦', () => {
    expect(shouldHardBlockVoiceThisTurn({ turns: 10, voiceTurns: 9, streak: 1 })).toBe(false);
    expect(buildVoiceHardBlockTail({ turns: 10, voiceTurns: 9, streak: 1 })).toBe('');
  });

  it('连着达到上限就硬性拦，且措辞是明确禁止而不是建议', () => {
    const stats = { turns: 5, voiceTurns: 2, streak: STREAK_LIMIT };
    expect(shouldHardBlockVoiceThisTurn(stats)).toBe(true);
    const tail = buildVoiceHardBlockTail(stats);
    expect(tail).toContain('禁止出现');
    expect(tail).toContain('最高优先级');
    expect(tail).toContain(`连续 ${STREAK_LIMIT} 轮`);
  });

  it('只统计语音用量正常的情况下不会误伤——跟 buildVoiceUsageHint 用同一份 stats 判定一致', () => {
    const stats = { turns: 8, voiceTurns: 1, streak: 0 };
    expect(buildVoiceUsageHint(stats)).toBe('');
    expect(buildVoiceHardBlockTail(stats)).toBe('');
  });
});
