import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 来电这条链上两个**实机炸过**的接线，用源码级断言钉住。
 *
 * 这两个都不是逻辑能单测出来的（一个是 React 的元素复用行为，一个是跨模块的语义误用），
 * 但两个都会让用户立刻看到最难受的症状，而且改别的地方时很容易被顺手改回去。
 * 同 utils/callAppRuntimeReferences.test.ts / utils/amsgStateSync.gaps.test.ts 的路子。
 */

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('来电铃声只能有一个 <audio>，而且必须常驻', () => {
  const src = read('../components/call/IncomingCallOverlay.tsx');

  it('整个组件只渲染一个挂着 audioRef 的 <audio>', () => {
    // 8/23 事故：来电时渲染 A、没来电时渲染 B，两个分支各一个 <audio>。
    // 界面一收起来，React 把正在放的那个从 DOM 摘掉、同时把 audioRef 指向新的那个，
    // 正在响的成了孤儿——停不下来也找不到，用户只能划掉整个 App。
    // 脱离 DOM 的 <audio> 会继续播，这一点跟直觉相反。
    const matches = src.match(/<audio\s+ref=\{audioRef\}/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('<audio> 不在 `call` 的条件分支里（常驻，且解锁必须发生在来电之前）', () => {
    const audioAt = src.indexOf('<audio ref={audioRef}');
    const guardAt = src.indexOf('{call && (');
    expect(audioAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(-1);
    // 铃声元素要排在条件块**前面**——排后面就说明它又被塞进分支里了。
    expect(audioAt).toBeLessThan(guardAt);
  });

  it('组件卸载时会停铃', () => {
    expect(src).toContain('useEffect(() => stopRinging, [])');
  });
});

describe('来电时刻只能取 spokenAt', () => {
  const src = read('./applyAssistantPostProcessing.ts');

  it('ringAt 来自 ctx.spokenAt', () => {
    expect(src).toContain('const callRingAt = ctx.spokenAt ??');
    expect(src).toContain('ringAt: callRingAt');
  });

  it('绝不拿 messageTimestamp 当来电时刻', () => {
    // messageTimestamp 是「这条消息该显示成几点」，本地已有更晚消息时会被特意置成
    // undefined（见 activeMsgRuntime 的 resolveBackfillTimestamp）。拿它当来电时刻、
    // 再 `?? Date.now()` 一兜底，几小时前的旧电话就成了「刚刚打来的」——
    // 8/23 实测：用户什么都没做，一进聊天页铃声就响个不停。
    expect(src).not.toContain('ringAt: messageTimestamp');
  });
});
