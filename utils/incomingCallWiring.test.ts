import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 来电这条链上几个**实机炸过**的接线，用源码级断言钉住。
 *
 * 这些都不是逻辑能单测出来的（React 的卸载/元素复用行为、跨模块的语义误用、
 * 组件挂在哪棵树上），但每一个都会让用户立刻听到最难受的那种故障——
 * **响个不停、界面上却找不到任何按钮**——而且改别的地方时很容易被顺手改回去。
 * 同 utils/callAppRuntimeReferences.test.ts / utils/amsgStateSync.gaps.test.ts 的路子。
 */

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('铃声必须活在 React 之外', () => {
  const overlay = read('../components/call/IncomingCallOverlay.tsx');
  const ringtone = read('./callRingtone.ts');

  it('来电界面里一个 <audio> 都没有', () => {
    // 8/23 连炸两次的根源：铃声挂在这个组件里，而 PhoneShell 在开机动画 / 数据加载 /
    // 锁屏三种情况下都会提前 return，整棵子树连 <audio> 一起消失。被摘出页面的
    // <audio> **会继续播**（跟直觉相反），而 React 在跑清理函数前就断开了 ref，
    // 代码想停也拿不到它 —— 用户听得见铃声、界面上什么都没有，只能划掉整个 App。
    expect(overlay).not.toContain('<audio');
  });

  it('铃声单例用 new Audio()，从不进 DOM', () => {
    expect(ringtone).toContain('new Audio(');
    expect(ringtone).not.toContain('document.createElement');
  });

  it('开响就必须挂看门狗——声音是唯一一种"出错了用户还关不掉"的故障', () => {
    expect(ringtone).toContain('watchdog = setTimeout(');
    // 看门狗里必须真的停，不能只回调
    const watchdogBody = ringtone.slice(ringtone.indexOf('watchdog = setTimeout('));
    expect(watchdogBody).toContain('stopRingtone();');
  });

  it('停铃是幂等的，谁都能调', () => {
    expect(ringtone).toContain('export const stopRingtone');
  });

  it('页面退出时也主动停掉单例声音', () => {
    expect(ringtone).toContain("window.addEventListener('pagehide', stopOnPageExit)");
    expect(ringtone).toContain("window.addEventListener('beforeunload', stopOnPageExit)");
  });

  it('PWA 恢复时硬停旧 Audio，并合并同一次恢复的多个浏览器事件', () => {
    expect(ringtone).toContain("window.addEventListener('pageshow', stopOnAppResume)");
    expect(ringtone).toContain("window.addEventListener('focus', stopOnAppResume)");
    expect(ringtone).toContain('RESUME_EVENT_COALESCE_MS');
    expect(ringtone).toContain('stopOnAppResume();');
  });
});

describe('来电界面必须挂在锁屏那棵树上', () => {
  const shell = read('../components/PhoneShell.tsx');

  it('PhoneShell 的两个分支都渲染了 IncomingCallOverlay', () => {
    // 只挂在解锁那棵树上的话，响铃途中一锁屏界面就整个消失（铃声还在响）。
    // 顺带也是对的产品行为：真手机就是能在锁屏上接电话。
    const matches = shell.match(/<IncomingCallOverlay \/>/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('其中一处排在 isLocked 的提前 return 之前', () => {
    const lockedAt = shell.indexOf('if (isLocked) {');
    const firstOverlayAt = shell.indexOf('<IncomingCallOverlay />');
    expect(lockedAt).toBeGreaterThan(-1);
    expect(firstOverlayAt).toBeGreaterThan(lockedAt);
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

describe('Overlay 重挂载时不能让过期来电重新响铃', () => {
  const overlay = read('../components/call/IncomingCallOverlay.tsx');

  it('真正 startRingtone 前再次调用过期判定', () => {
    expect(overlay).toContain('isStaleIncomingCall(call.ringAt)');
    expect(overlay).toContain("void settle('missed')");
    expect(overlay.indexOf('isStaleIncomingCall(call.ringAt)')).toBeLessThan(overlay.indexOf('startRingtone(onTimeout)'));
  });
});

describe('这条链上最容易被别的上传悄悄覆盖掉的两处', () => {
  it('chatPrompts 里还教着 [[ACTION:CALL]]', () => {
    const src = readFileSync(path.resolve(__dirname, './chatPrompts.ts'), 'utf8');
    expect(src).toContain('[[ACTION:CALL');
    expect(src).toContain('要打就带上那一行，不打就别说要打');
  });

  it('CallApp 还认得待接来电，也还知道方向', () => {
    const src = readFileSync(path.resolve(__dirname, '../apps/CallApp.tsx'), 'utf8');
    expect(src).toContain('getPendingIncomingCall');
    expect(src).toContain('clearPendingIncomingCall');
    expect(src).toContain('callDirection');
  });

  it('运行时提醒接在 volatileState 上（不能进 stable，会打断前缀缓存）', () => {
    const src = readFileSync(path.resolve(__dirname, './chatPrompts.ts'), 'utf8');
    expect(src).toContain('volatileState += buildCallHintFromMessages(currentMsgs)');
  });
});
