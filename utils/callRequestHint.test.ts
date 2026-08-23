import { describe, it, expect } from 'vitest';
import type { Message } from '../types';
import {
  buildCallHint,
  buildCallHintFromMessages,
  characterPromisedCall,
  readCallTurnContext,
  userAskedForCall,
} from './callRequestHint';

let seq = 0;
const msg = (role: Message['role'], content: string, metadata?: Record<string, any>): Message => ({
  id: ++seq,
  charId: 'c1',
  role,
  type: 'text',
  content,
  timestamp: 1_700_000_000_000 + seq * 1000,
  ...(metadata ? { metadata } : {}),
} as Message);

describe('userAskedForCall', () => {
  it('各种要电话的说法都认', () => {
    for (const t of ['给我打电话!', '打给我', '你拨过来', '来个电话', '晚上连麦吧', '视频通话可以吗', 'call me']) {
      expect(userAskedForCall(t)).toBe(true);
    }
  });

  it('「别打电话」这类否定不算要求', () => {
    for (const t of ['别打电话了', '先不用打给我', '不要打电话过来', '甭打电话']) {
      expect(userAskedForCall(t)).toBe(false);
    }
  });

  it('没提电话的普通话不算', () => {
    expect(userAskedForCall('今天好累啊')).toBe(false);
    expect(userAskedForCall('')).toBe(false);
  });
});

describe('characterPromisedCall', () => {
  it('抓得住「这就给你拨过去」这类台词', () => {
    expect(characterPromisedCall('行，颜大领导发话了，手机拿好，这就给你拨过去。')).toBe(true);
    expect(characterPromisedCall('接驾。')).toBe(true);
    expect(characterPromisedCall('等我电话')).toBe(true);
  });

  it('没承诺的普通回复不算', () => {
    expect(characterPromisedCall('这命令下得挺理直气壮啊。')).toBe(false);
  });
});

describe('readCallTurnContext', () => {
  it('拆得出「用户这一轮」和「上一轮 assistant」', () => {
    const ctx = readCallTurnContext([
      msg('user', '很早以前的话'),
      msg('assistant', '更早的回复'),
      msg('user', '给我打电话!'),
      msg('user', '现在就要'),
    ]);
    expect(ctx.userTurnText).toBe('给我打电话!\n现在就要');
    expect(ctx.lastAssistantTurnText).toBe('更早的回复');
  });

  it('assistant 连发多个气泡算同一轮', () => {
    const ctx = readCallTurnContext([
      msg('user', '给我打电话!'),
      msg('assistant', '这命令下得挺理直气壮啊。'),
      msg('assistant', '这就给你拨过去。'),
    ]);
    expect(ctx.lastAssistantTurnText).toBe('这命令下得挺理直气壮啊。\n这就给你拨过去。');
  });

  it('未接来电（system 消息）算通话痕迹，且不打断 assistant 那一轮', () => {
    const ctx = readCallTurnContext([
      msg('user', '给我打电话!'),
      msg('assistant', '这就给你拨过去。'),
      msg('system', '未接来电 · 萧逸', { source: 'incoming-call-missed' }),
    ]);
    expect(ctx.hasCallEvidenceAfterPromise).toBe(true);
    expect(ctx.lastAssistantTurnText).toBe('这就给你拨过去。');
  });

  it('通话结束卡片也算痕迹', () => {
    const ctx = readCallTurnContext([
      msg('assistant', '这就给你拨过去。'),
      msg('system', '通话结束 · 萧逸', { source: 'call-end-popup', callSessionId: 's1' }),
    ]);
    expect(ctx.hasCallEvidenceAfterPromise).toBe(true);
  });
});

describe('buildCallHint', () => {
  const none = { userTurnText: '', lastAssistantTurnText: '', hasCallEvidenceAfterPromise: false };

  it('什么都没发生时一个字都不注入', () => {
    expect(buildCallHint(none)).toBe('');
    expect(buildCallHint({ ...none, userTurnText: '今天好累' })).toBe('');
  });

  it('说了要打却没打 —— 最高优先级', () => {
    const hint = buildCallHint({
      userTurnText: '嗯',
      lastAssistantTurnText: '这就给你拨过去。',
      hasCallEvidenceAfterPromise: false,
    });
    expect(hint).toContain('并没有真的打出去');
    expect(hint).toContain('[[ACTION:CALL');
  });

  it('说了要打、而且真的打了 —— 不再唠叨', () => {
    expect(buildCallHint({
      userTurnText: '嗯',
      lastAssistantTurnText: '这就给你拨过去。',
      hasCallEvidenceAfterPromise: true,
    })).toBe('');
  });

  it('用户点名要电话', () => {
    const hint = buildCallHint({ ...none, userTurnText: '给我打电话!' });
    expect(hint).toContain('明确点名要你打电话');
    expect(hint).toContain('不想打');
  });

  it('用户说别打时不注入', () => {
    expect(buildCallHint({ ...none, userTurnText: '今天别打电话了' })).toBe('');
  });

  it('端到端：8/23 那次实机的历史会触发提醒', () => {
    const hint = buildCallHintFromMessages([
      msg('user', '给我打电话!'),
      msg('assistant', '这命令下得挺理直气壮啊，萧小五。'),
      msg('assistant', '<语音>手机拿好，这就给你拨过去。</语音>'),
      msg('assistant', '接驾。'),
    ]);
    expect(hint).toContain('并没有真的打出去');
  });

  it('端到端：同样的历史，但电话真的打过了 → 不注入', () => {
    const hint = buildCallHintFromMessages([
      msg('user', '给我打电话!'),
      msg('assistant', '这就给你拨过去。'),
      msg('system', '未接来电 · 萧逸', { source: 'incoming-call-missed' }),
    ]);
    expect(hint).toBe('');
  });
});
