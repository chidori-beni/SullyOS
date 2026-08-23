// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  INCOMING_CALL_COOLDOWN_MS,
  clearPendingIncomingCall,
  extractCallInvite,
  formatCallInviteTag,
  getPendingIncomingCall,
  getIncomingCallPresentedAt,
  hasIncomingCallBeenPresented,
  isStaleIncomingCall,
  isCallCoolingDown,
  markCallFired,
  markIncomingCallPresented,
  readLastCallAt,
  requestIncomingCall,
  STALE_CALL_MS,
} from './incomingCall';

describe('extractCallInvite', () => {
  it('规范写法：模式 + 开场白', () => {
    const r = extractCallInvite('等下说。[[ACTION:CALL|video|想看看你现在在干嘛]]');
    expect(r.invite).toEqual({ mode: 'video', opening: '想看看你现在在干嘛' });
    expect(r.cleanedText).toBe('等下说。');
    expect(r.malformedCount).toBe(0);
  });

  it('中文别名 + 全角竖线 + 冒号形态都认', () => {
    expect(extractCallInvite('[[ACTION：CALL｜语音｜睡了吗]]').invite)
      .toEqual({ mode: 'voice', opening: '睡了吗' });
    expect(extractCallInvite('[[ACTION:CALL:视频|开门]]').invite)
      .toEqual({ mode: 'video', opening: '开门' });
  });

  it('没写模式时按语音——视频是更重的打扰，不替它选重的那个', () => {
    expect(extractCallInvite('[[ACTION:CALL|喂，在吗]]').invite)
      .toEqual({ mode: 'voice', opening: '喂，在吗' });
  });

  it('开场白里有逗号不会被劈开', () => {
    expect(extractCallInvite('[[ACTION:CALL|voice|喂，在吗，我刚下班]]').invite)
      .toEqual({ mode: 'voice', opening: '喂，在吗，我刚下班' });
  });

  it('只有模式、没有开场白 → 让它接通后自己现编', () => {
    expect(extractCallInvite('[[ACTION:CALL|video]]').invite)
      .toEqual({ mode: 'video', opening: '' });
  });

  it('开场白跨行也能整条吃掉', () => {
    const r = extractCallInvite('好。\n[[ACTION:CALL|voice|第一行\n第二行]]\n结束');
    expect(r.invite?.opening).toBe('第一行\n第二行');
    expect(r.cleanedText).toBe('好。\n\n结束');
  });

  it('一轮吐好几个只认第一个——多打几通电话没有任何语义', () => {
    const r = extractCallInvite('[[ACTION:CALL|voice|一]][[ACTION:CALL|video|二]]');
    expect(r.invite).toEqual({ mode: 'voice', opening: '一' });
    expect(r.cleanedText).toBe('');
  });

  it('空标签算 malformed，但正文照样剥干净', () => {
    const r = extractCallInvite('话说完了[[ACTION:CALL|]]');
    expect(r.invite).toBeNull();
    expect(r.malformedCount).toBe(1);
    expect(r.cleanedText).toBe('话说完了');
  });

  it('没有标签时原样返回', () => {
    const r = extractCallInvite('普通一句话');
    expect(r).toEqual({ cleanedText: '普通一句话', invite: null, malformedCount: 0 });
  });

  it('不误伤别的 ACTION 标签', () => {
    const r = extractCallInvite('[[ACTION:CHANGE_SCHEDULE|20:00|和你连麦]]');
    expect(r.invite).toBeNull();
    expect(r.cleanedText).toBe('[[ACTION:CHANGE_SCHEDULE|20:00|和你连麦]]');
  });

  it('拼回去的标签能再解析回来', () => {
    const invite = { mode: 'video' as const, opening: '接一下' };
    expect(extractCallInvite(formatCallInviteTag(invite)).invite).toEqual(invite);
  });
});

describe('冷却', () => {
  // 间隔显式传进来：上面那个常量在测试期被临时改成 0 了，机制本身照测。
  const TEN_MIN = 10 * 60 * 1000;

  it('间隔内算冷却，超过就放行', () => {
    const now = 1_000_000_000;
    expect(isCallCoolingDown(now - 1, now, TEN_MIN)).toBe(true);
    expect(isCallCoolingDown(now - TEN_MIN + 1, now, TEN_MIN)).toBe(true);
    expect(isCallCoolingDown(now - TEN_MIN, now, TEN_MIN)).toBe(false);
    expect(isCallCoolingDown(null, now, TEN_MIN)).toBe(false);
  });

  it('间隔设成 0 = 关掉冷却（测试期就是这个状态）', () => {
    expect(isCallCoolingDown(Date.now(), Date.now(), 0)).toBe(false);
  });

  it('读不到 / 读到脏值时不当成冷却——宁可多响一次也不要哑火', () => {
    localStorage.setItem('sully-incoming-call-cooldown-v1:x', 'not-a-number');
    expect(readLastCallAt('x')).toBeNull();
    expect(readLastCallAt('从没打过')).toBeNull();
  });
});

describe('requestIncomingCall', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPendingIncomingCall();
  });

  const call = { charId: 'c1', charName: '萧逸', mode: 'voice' as const, opening: '睡了吗' };

  it('第一通放行，并把待接来电和事件都发出去', () => {
    const seen: any[] = [];
    const handler = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('sully-incoming-call', handler);
    expect(requestIncomingCall(call)).toBe('ringing');
    window.removeEventListener('sully-incoming-call', handler);

    expect(seen).toHaveLength(1);
    expect(seen[0].charId).toBe('c1');
    expect(getPendingIncomingCall()?.opening).toBe('睡了吗');
  });

  // 下面两条要靠 INCOMING_CALL_COOLDOWN_MS 真的大于 0。测试期它被临时改成 0，
  // 这两条自动跳过；改回 10 分钟时它们会自己醒过来，别删。
  const cooldownOn = INCOMING_CALL_COOLDOWN_MS > 0;

  it.skipIf(!cooldownOn)('冷却期内的第二通被挡下', () => {
    markCallFired('c1');
    expect(requestIncomingCall(call)).toBe('cooldown');
    expect(getPendingIncomingCall()).toBeNull();
  });

  it.skipIf(!cooldownOn)('没接的电话也占冷却配额——不接就被连着打是更差的体验', () => {
    expect(requestIncomingCall(call)).toBe('ringing');
    clearPendingIncomingCall();
    expect(requestIncomingCall(call)).toBe('cooldown');
  });

  it('已经在响一通时，后到的那通丢掉', () => {
    expect(requestIncomingCall(call)).toBe('ringing');
    expect(requestIncomingCall({ ...call, charId: 'c2', charName: '别人' })).toBe('busy');
    expect(getPendingIncomingCall()?.charId).toBe('c1');
  });

  it('ringAt 可以由调用方指定（补收路径传 push 的发送时刻）', () => {
    const justNow = Date.now() - 1_000;
    requestIncomingCall({ ...call, ringAt: justNow });
    expect(getPendingIncomingCall()?.ringAt).toBe(justNow);
  });

  it('补收回来的旧电话不响，只让调用方记一条未接', () => {
    expect(requestIncomingCall({ ...call, ringAt: Date.now() - STALE_CALL_MS - 1 })).toBe('stale');
    expect(getPendingIncomingCall()).toBeNull();
  });

  it.skipIf(!cooldownOn)('旧电话也占冷却配额——补收一次性灌进来五条时只该记一条', () => {
    expect(requestIncomingCall({ ...call, ringAt: Date.now() - STALE_CALL_MS - 1 })).toBe('stale');
    expect(requestIncomingCall({ ...call, ringAt: Date.now() - STALE_CALL_MS - 1 })).toBe('cooldown');
  });
});

describe('过期来电守门', () => {
  it('刚到的电话不算过期，超过界线才算过期', () => {
    const now = 10_000;
    expect(isStaleIncomingCall(now - STALE_CALL_MS, now)).toBe(false);
    expect(isStaleIncomingCall(now - STALE_CALL_MS - 1, now)).toBe(true);
  });

  it('脏时间戳不应误触发过期清理', () => {
    expect(isStaleIncomingCall(Number.NaN, 10_000)).toBe(false);
    expect(isStaleIncomingCall(9_000, Number.NaN)).toBe(false);
  });
});

describe('来电已响过标记', () => {
  beforeEach(() => sessionStorage.clear());

  it('同一 char + ringAt 可跨 Overlay 重挂载识别为已响过', () => {
    const call = { charId: 'c-presented', ringAt: 20_000 };
    expect(hasIncomingCallBeenPresented(call, 20_000)).toBe(false);
    markIncomingCallPresented(call, 20_001);
    expect(hasIncomingCallBeenPresented(call, 20_002)).toBe(true);
    expect(getIncomingCallPresentedAt(call, 20_002)).toBe(20_001);
  });

  it('超过保留期自动清掉旧标记', () => {
    const call = { charId: 'c-expired-presented', ringAt: 20_000 };
    markIncomingCallPresented(call, 20_001);
    expect(hasIncomingCallBeenPresented(call, 20_001 + 24 * 60 * 60 * 1000 + 1)).toBe(false);
  });
});
