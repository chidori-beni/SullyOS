import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { isAlwaysVisibleSystemCard, isHiddenSystemLog } from './chatSystemCards';

const read = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('隐藏系统日志不能吃掉卡片类 system 消息', () => {
  const missed = {
    role: 'system',
    type: 'system',
    metadata: { source: 'incoming-call-missed', callMode: 'voice' },
  };

  it('未接来电在开关打开时依然要显示', () => {
    expect(isAlwaysVisibleSystemCard(missed)).toBe(true);
    expect(isHiddenSystemLog(missed, true)).toBe(false);
    expect(isHiddenSystemLog(missed, false)).toBe(false);
  });

  it('通话小结 / 见面完结 / 见面邀请 / 评分卡同样豁免', () => {
    for (const source of ['call-end-popup', 'date-end-popup', 'date-meeting-invite']) {
      expect(isHiddenSystemLog({ role: 'system', type: 'system', metadata: { source } }, true)).toBe(false);
    }
    expect(isHiddenSystemLog({ role: 'system', type: 'score_card', metadata: {} }, true)).toBe(false);
  });

  it('真正的系统旁白仍然被隐藏', () => {
    const log = { role: 'system', type: 'system', metadata: { source: 'system-log' } };
    expect(isHiddenSystemLog(log, true)).toBe(true);
    expect(isHiddenSystemLog(log, false)).toBe(false);
    expect(isHiddenSystemLog({ role: 'system', type: 'system' }, true)).toBe(true);
    expect(isHiddenSystemLog({ role: 'system', type: 'system', metadata: null }, true)).toBe(true);
  });

  it('非 system 消息永远不受这个开关影响', () => {
    expect(isHiddenSystemLog({ role: 'assistant', type: 'text', metadata: {} }, true)).toBe(false);
    expect(isHiddenSystemLog({ role: 'user', type: 'text', metadata: {} }, true)).toBe(false);
  });
});

describe('Chat.tsx 的两处过滤必须共用同一个判定', () => {
  const chat = read('../apps/Chat.tsx');

  it('读库和渲染都调用 isHiddenSystemLog，不再各写各的白名单', () => {
    expect(chat).toContain("import { isHiddenSystemLog } from '../utils/chatSystemCards';");
    expect(chat).toContain('isHiddenSystemLog(m, currentChar?.hideSystemLogs)');
    expect(chat).toContain('isHiddenSystemLog(m, char?.hideSystemLogs)');
    // 手写白名单一处都不能留：留一处就等于下次再漏一种卡片。
    expect(chat).not.toContain("m.metadata?.source !== 'call-end-popup'");
    expect(chat).not.toContain("m.type !== 'score_card'");
  });
});

describe('MessageItem 里渲染的 system 卡片都在白名单里', () => {
  const item = read('../components/chat/MessageItem.tsx');

  it('isSystem 段出现的每种 source 都不会被开关隐藏', () => {
    const start = item.indexOf('// --- SYSTEM MESSAGE RENDERING ---');
    expect(start).toBeGreaterThan(-1);
    const body = item.slice(start);
    const sources = new Set(
      Array.from(body.matchAll(/m\.metadata\?\.source === '([a-z0-9-]+)'/g)).map(m => m[1]),
    );
    expect(sources.size).toBeGreaterThan(0);
    for (const source of sources) {
      expect(
        isAlwaysVisibleSystemCard({ role: 'system', type: 'system', metadata: { source } }),
        `MessageItem 渲染了 ${source} 卡片，但 chatSystemCards 白名单里没有它`,
      ).toBe(true);
    }
  });
});
