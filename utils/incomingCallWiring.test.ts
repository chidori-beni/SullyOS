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

describe('预解锁绝不能碰真铃声（幽灵铃声根因）', () => {
  const ringtone = read('./callRingtone.ts');

  /**
   * 8/24 折磨了十几轮的那个 bug：没有来电界面、没有 `start` 日志，却听得见铃声。
   *
   * 根因是 `primeRingtone()` 拿**真铃声 mp3** 做静音预播放。iOS 上 `volume` 对
   * HTMLMediaElement 直接无效，`muted` 在「同一个手势里刚设 true 就 play()」这条路上
   * 会漏出可听见的开头。响多久完全取决于 play() 的 promise 什么时候 settle：
   * 快则 1 秒、慢则十几秒、不 settle 就整首 mp3 播完自己停——用户报的三种时长全对上。
   *
   * 修法不是再加兜底，是把「有声音可漏」这件事消掉：预解锁只播内联静音 WAV。
   * 解锁是**按元素**记的，跟播哪个 URL 无关，所以完全不需要碰铃声文件。
   */
  it('primeRingtone 播的是内联静音 WAV，不是 RINGTONE_URL', () => {
    expect(ringtone).toContain('SILENT_PRIME_URL');
    expect(ringtone).toContain('data:audio/wav;base64,');
    const primeBody = ringtone.slice(
      ringtone.indexOf('export const primeRingtone'),
      ringtone.indexOf('export const isRinging'),
    );
    expect(primeBody).toContain('el.src = SILENT_PRIME_URL');
    expect(primeBody).toContain('el.play()');
    // 关键断言：从「开始预解锁」到「装好回调」这一段**准备代码**里绝不能出现铃声 URL。
    // 元素身上挂的必须是静音源，play() 才不可能漏出铃声。
    // （finishPrime 里把 RINGTONE_URL 接回来是对的——那是解锁完成之后的事。）
    const setup = primeBody.slice(
      primeBody.indexOf('priming = true;'),
      primeBody.indexOf('let settled = false;'),
    );
    expect(setup.length).toBeGreaterThan(0);
    expect(setup).not.toContain('RINGTONE_URL');
  });

  it('预解锁期间 isRinging() 必须返回 false', () => {
    // 否则刚好这时到达的真来电会被 Overlay 判成「已经在响」而直接 return：
    // 界面亮着、没有声音、也没有看门狗，那通电话会永远挂在那儿。
    expect(ringtone).toContain('let priming = false;');
    expect(ringtone).toContain('!priming && (ringActive || (!!audio && !audio.paused))');
  });

  it('预解锁的迟到 promise 不许 pause 已经开始响的真来电', () => {
    // startRingtone 推进 audioEpoch；迟到的 finishPrime 认出自己过期后必须整个跳过，
    // 一个字都不能碰那个元素。旧代码在这里无条件 pause()，会把真铃声掐掉。
    const startBody = ringtone.slice(ringtone.indexOf('export const startRingtone'));
    expect(startBody.slice(0, startBody.indexOf('clearTimers();'))).toContain('audioEpoch += 1;');
    const primeBody = ringtone.slice(
      ringtone.indexOf('export const primeRingtone'),
      ringtone.indexOf('export const isRinging'),
    );
    expect(primeBody.indexOf('if (stale)')).toBeLessThan(primeBody.indexOf('el.pause()'));
  });

  it('预解锁挂了兜底定时器，priming 不会永远悬着', () => {
    expect(ringtone).toContain('PRIME_GUARD_MS');
    expect(ringtone).toContain("finishPrime('prime-guard-timeout')");
  });
});

describe('生命周期事件不许掐掉正在响的真来电', () => {
  const ringtone = read('./callRingtone.ts');

  /**
   * 8/24 第二个实机 bug：铃声不响、来电界面挂死、永远不变未接来电。
   *
   * 根因是 `stopRingtone()` 里的 `clearTimers()` 会把**看门狗一起干掉**，而第 10/13/15 轮
   * 为了扑幽灵铃声，在 pageshow / focus / visibilitychange 上全挂了无条件 `stopRingtone()`。
   * 合并窗口只有 2 秒，iOS 冷启动 / 从通知横幅进来时这几个事件会拖好几秒才到齐，于是一个
   * 迟到的 `focus` 就能让一通刚开始响的真来电既没了声音、也永远不会超时。
   *
   * 幽灵铃声已经在根上修掉了，这些"逢事件必硬停"的锤子只剩误伤，必须让路给合法来电。
   */
  it('有合法来电在响时，恢复事件走"继续响"而不是硬停', () => {
    expect(ringtone).toContain('let ringActive = false;');
    const resumeBody = ringtone.slice(
      ringtone.indexOf('const stopOnAppResume = () => {'),
      ringtone.indexOf("window.addEventListener('pageshow', stopOnAppResume)"),
    );
    expect(resumeBody).toContain('if (ringActive)');
    // ringActive 分支必须在任何 stopRingtone() 之前就 return
    expect(resumeBody.indexOf('if (ringActive)')).toBeLessThan(resumeBody.indexOf('stopRingtone();'));
    expect(resumeBody).toContain('resumeRingtoneForForeground(');
  });

  it('退到后台只按住声音，绝不碰看门狗', () => {
    const pauseBody = ringtone.slice(
      ringtone.indexOf('const pauseRingtoneForBackground'),
      ringtone.indexOf('const resumeRingtoneForForeground'),
    );
    expect(pauseBody.length).toBeGreaterThan(0);
    // 这一条就是 bug 本身：软停里但凡出现 clearTimers()，未接来电就又没了。
    expect(pauseBody).not.toContain('clearTimers()');
    expect(pauseBody).not.toContain('ringActive = false');
    expect(pauseBody).toContain('el.pause()');
  });

  it('visibilitychange=hidden 在响铃时走软停', () => {
    const hiddenBody = ringtone.slice(ringtone.indexOf("if (document.visibilityState === 'hidden')"));
    const cut = hiddenBody.slice(0, hiddenBody.indexOf('lastResumeStopAt = 0;'));
    expect(cut).toContain('if (ringActive)');
    expect(cut).toContain('pauseRingtoneForBackground(');
  });

  it('跨页面熔断不许掐掉本页正在响的来电', () => {
    const crossBody = ringtone.slice(
      ringtone.indexOf('const receiveCrossContextStop'),
      ringtone.indexOf('const ensureRingtoneChannel'),
    );
    expect(crossBody).toContain('if (ringActive)');
    expect(crossBody.indexOf('if (ringActive)')).toBeLessThan(crossBody.indexOf('stopRingtone();'));
  });

  it('stopRingtone 仍然是"这通到此为止"：清看门狗 + 清 ringActive', () => {
    // 接听 / 拒接 / 超时 / 真正离开页面走的还是它，语义不能被软停稀释掉。
    const stopBody = ringtone.slice(
      ringtone.indexOf('export const stopRingtone'),
      ringtone.indexOf('export const __resetRingtoneForTest'),
    );
    expect(stopBody).toContain('clearTimers();');
    expect(stopBody).toContain('ringActive = false;');
  });

  it('isRinging 认 ringActive——后台按住声音的那通电话也算在响', () => {
    // 否则 Overlay 重挂载会以为"没在响"，再 startRingtone 一遍，把已经跑了一半的
    // 看门狗重置掉，30 秒又从头算起。
    expect(ringtone).toContain('ringActive || (!!audio && !audio.paused)');
  });
});

describe('音源是否还挂着，只能自己记，不能读 currentSrc', () => {
  const ringtone = read('./callRingtone.ts');

  /**
   * 8/24 第三个实机 bug：第一通电话正常，**第二通开始有来电界面、有看门狗，就是没有声音**。
   *
   * 第 15 轮的"硬销毁"用 `removeAttribute('src')` + `load()` 切断 iOS 的底层媒体管线，
   * 之后 WebKit 把元素打成 `networkState = NETWORK_NO_SOURCE(3)`，**但 `currentSrc` 里
   * 仍然残留旧的 mp3 URL**。旧的 `getAudio()` 恰恰拿这个字符串判断要不要把源接回来，
   * 残留值让条件永远为 false ⇒ 第一通之后音源再也接不回来，`play()` 落在空元素上。
   *
   * 实机日志里 `networkStateBefore: 3` 配着 `srcBefore: ".../incoming-call.mp3"`
   * 就是这个状态的指纹——两者本不该同时成立。
   */
  const getAudioBody = () => {
    const body = ringtone.slice(ringtone.indexOf('const getAudio'), ringtone.indexOf('const clearTimers'));
    // 注释里提到 currentSrc 是为了警告后人，不能算违规；只看真代码。
    return body
      .split('\n')
      .filter(line => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
  };

  it('getAudio 不许再靠 currentSrc 字符串判断音源在不在', () => {
    const body = getAudioBody();
    expect(body.length).toBeGreaterThan(0);
    expect(body).not.toContain('audio.currentSrc');
    expect(body).not.toContain("includes('incoming-call.mp3')");
  });

  it('改用模块级 srcAttached 标志，外加 networkState 兜底', () => {
    expect(ringtone).toContain('let srcAttached = false;');
    const body = getAudioBody();
    expect(body).toContain('!srcAttached');
    expect(body).toContain('NETWORK_NO_SOURCE');
    expect(body).toContain('NETWORK_EMPTY');
  });

  it('每一处摘掉音源的地方都必须把 srcAttached 置回 false', () => {
    // 漏掉任何一处，那条路走过之后铃声就再也不会响了。
    const stopBody = ringtone.slice(
      ringtone.indexOf('export const stopRingtone'),
      ringtone.indexOf('export const __resetRingtoneForTest'),
    );
    expect(stopBody).toContain("el.removeAttribute('src');");
    expect(stopBody).toContain('srcAttached = false;');

    const primeBody = ringtone.slice(
      ringtone.indexOf('export const primeRingtone'),
      ringtone.indexOf('export const isRinging'),
    );
    // 预解锁把静音 WAV 挂上去时也等于摘掉了铃声源
    expect(primeBody).toContain('srcAttached = false;');
    // 解锁完成后必须走同一个 helper 把铃声接回来
    expect(primeBody).toContain('attachRingtoneSrc(el);');
  });

  it('start 日志带上音源状态，下次"有界面没声音"能一眼看出来', () => {
    const startBody = ringtone.slice(
      ringtone.indexOf('export const startRingtone'),
      ringtone.indexOf('export const stopRingtone'),
    );
    expect(startBody).toContain('srcAttached,');
    expect(startBody).toContain('networkStateBefore: el?.networkState');
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
