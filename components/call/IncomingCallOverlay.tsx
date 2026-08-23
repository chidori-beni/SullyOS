import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneDisconnect, VideoCamera } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { DB } from '../../utils/db';
import { useBlobRefUrl } from '../../utils/blobRef';
import {
  INCOMING_CALL_EVENT,
  clearPendingIncomingCall,
  getPendingIncomingCall,
  type PendingIncomingCall,
} from '../../utils/incomingCall';

/**
 * 角色主动来电的全屏界面。挂在 PhoneShell 最外层，盖在所有 App 之上。
 *
 * 为什么不做成一个 App：来电必须能盖住"用户此刻正在用的任何东西"，包括锁屏和别的
 * App。做成 App 就得先 openApp、把用户手上那个页面顶掉，拒接之后还回不去原来的地方。
 *
 * ⚠️ 铃声元素**必须只有一个、且永远挂在树上**，别写成「有来电时渲染 A、没来电时渲染 B」。
 * 8/23 实测炸过一次：两个分支各有一个 <audio>，来电界面一收起来，React 把正在放的那个
 * 元素从 DOM 上摘掉、同时把 audioRef 指向了新的那个——**正在响的那个元素成了孤儿**，
 * 停不下来也找不到，用户只能划掉整个 App 才能让铃声停。脱离 DOM 的 <audio> 是会继续
 * 播的，这一点跟直觉相反，务必记住。
 */

const RINGTONE_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'sounds/incoming-call.mp3').replace(/([^:])\/\/+/g, '$1/');

/** 响多久没人接算未接。真手机是 30 秒左右，照抄。 */
const RING_TIMEOUT_MS = 30_000;

/**
 * 页面在后台时，这通电话最多"举着"多久等你回来。
 *
 * 8/23 实测出来的坑：推送到了、横幅弹了，但用户是**从后台切回来**的（没点横幅）。
 * 那一刻补收在后台就跑完了，来电界面在看不见的页面上响了 30 秒然后自己判成未接——
 * 用户切回来时什么都没有。所以页面不可见时**根本不开始计时**，等回到前台再响。
 * 超过这个岁数才认命记未接：隔了半小时才回来的电话，响起来只会吓人。
 */
const BACKGROUND_HOLD_MS = 5 * 60_000;

/** 震动节奏（安卓有效；iOS Safari 直接忽略 navigator.vibrate，不是 bug）。 */
const VIBRATE_PATTERN = [400, 200, 400, 1400];

const IncomingCallOverlay: React.FC = () => {
  const { openApp, characters } = useOS();
  const [call, setCall] = useState<PendingIncomingCall | null>(() => getPendingIncomingCall());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const vibrateTimerRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  // 接听/拒接/超时会在同一帧里被触发两次（点按 + 超时同时到），落两条未接记录。
  const settledRef = useRef(false);

  const char = call ? characters.find(c => c.id === call.charId) : undefined;
  const avatarUrl = useBlobRefUrl(char?.avatar || call?.charAvatar);

  /**
   * 停铃。**任何**路径退出来电都要过这里，包括组件卸载。
   *
   * 直接用 audioRef 而不是闭包捕获的变量：元素是常驻的、引用一辈子不变，
   * 所以这里拿到的永远是正在响的那一个（见文件头那条警告）。
   */
  const stopRinging = () => {
    if (timeoutRef.current != null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (vibrateTimerRef.current != null) { window.clearInterval(vibrateTimerRef.current); vibrateTimerRef.current = null; }
    try { navigator.vibrate?.(0); } catch { /* 不支持就算了 */ }
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.loop = false;
        audio.currentTime = 0;
      } catch { /* 同上 */ }
    }
  };

  // 组件被卸载（换主题 / 热更新 / PhoneShell 重建）时也必须停铃，否则又是一个孤儿。
  useEffect(() => stopRinging, []);

  /**
   * 借用户的第一次触摸解锁铃声。
   *
   * iOS 的自动播放限制是**按元素**算的：聊天里放过语音，解锁的是语音那个 <audio>，
   * 跟这里这个毫无关系。所以第一批实测「电话打进来了但一点声音都没有」——铃声元素
   * 从来没被任何手势碰过，play() 直接被拒。
   *
   * 做法跟 CallApp 的 primeCallAudioFromGesture 一样：随便哪次触摸，把这个元素静音
   * 播一下再立刻停掉，之后它就一直是"解锁"状态了。只做一次，做完就把监听摘掉。
   *
   * 正在响铃时**不解锁**——那一下会把真正的铃声掐掉。
   */
  useEffect(() => {
    let primed = false;
    const detach = () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('touchend', prime);
      window.removeEventListener('keydown', prime);
    };
    function prime() {
      if (primed) return;
      const audio = audioRef.current;
      if (!audio) return;
      if (!audio.paused) { primed = true; detach(); return; } // 已经在响了，本身就是解锁状态
      primed = true;
      audio.volume = 0;
      const done = () => {
        try { audio.pause(); audio.currentTime = 0; } catch { /* 忽略 */ }
        audio.volume = 1;
      };
      try {
        const attempt = audio.play();
        if (attempt) void attempt.then(done).catch(() => { audio.volume = 1; });
        else done();
      } catch {
        audio.volume = 1;
      }
      detach();
    }
    window.addEventListener('pointerdown', prime, { passive: true });
    window.addEventListener('touchend', prime, { passive: true });
    window.addEventListener('keydown', prime);
    return detach;
  }, []);

  useEffect(() => {
    const onIncoming = (event: Event) => {
      const detail = (event as CustomEvent<PendingIncomingCall>).detail;
      if (!detail) return;
      settledRef.current = false;
      setCall(detail);
    };
    window.addEventListener(INCOMING_CALL_EVENT, onIncoming as EventListener);
    return () => window.removeEventListener(INCOMING_CALL_EVENT, onIncoming as EventListener);
  }, []);

  const settle = async (action: 'accept' | 'declined' | 'missed') => {
    if (settledRef.current) return;
    settledRef.current = true;
    const target = call;
    stopRinging();
    if (!target) return;
    if (action === 'accept') {
      // 待接来电**不在这里清**：CallApp 挂载后要靠它才知道这通是谁打来的、说什么开场白。
      // 由 CallApp 消费完自己清（跟 suspendedCall / clearSuspendedCall 同一条约定）。
      setCall(null);
      openApp(AppID.Call);
      return;
    }
    clearPendingIncomingCall();
    setCall(null);
    await persistMissedCall(target, action === 'declined' ? 'declined' : 'missed');
  };

  // 响铃 + 震动 + 超时。页面不可见时先按住不动，等切回前台再响（见 BACKGROUND_HOLD_MS）。
  useEffect(() => {
    if (!call) return;
    let disposed = false;

    const startRinging = () => {
      if (disposed || settledRef.current) return;
      const audio = audioRef.current;
      if (audio) {
        audio.loop = true;
        audio.volume = 0.85;
        // 播放失败只记一行日志：自动播放被拦是预期内的一种结果，不是错误。
        void audio.play().catch(err => {
          console.log('[IncomingCall] 铃声被浏览器拦下（这个元素还没被任何手势解锁过）:', err?.name || err);
        });
      }
      try {
        navigator.vibrate?.(VIBRATE_PATTERN);
        vibrateTimerRef.current = window.setInterval(() => {
          try { navigator.vibrate?.(VIBRATE_PATTERN); } catch { /* 同上 */ }
        }, 2400);
      } catch { /* iOS 没有这个 API */ }
      timeoutRef.current = window.setTimeout(() => { void settle('missed'); }, RING_TIMEOUT_MS);
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      startRinging();
      return () => { disposed = true; stopRinging(); };
    }

    // 页面在后台：先不响。回到前台再开始，或者举太久了就认命记未接。
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      if (Date.now() - call.ringAt > BACKGROUND_HOLD_MS) { void settle('missed'); return; }
      startRinging();
    };
    document.addEventListener('visibilitychange', onVisible);
    const holdTimer = window.setTimeout(() => { void settle('missed'); }, BACKGROUND_HOLD_MS);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(holdTimer);
      stopRinging();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.charId, call?.ringAt]);

  const isVideo = call?.mode === 'video';
  const name = char?.name || call?.charName || '';

  return (
    <>
      {/*
        铃声元素：**无条件常驻，永远是同一个节点**。挪进下面那个条件块里就会重演
        8/23 那个「孤儿铃声停不下来」的事故（见文件头）。
      */}
      <audio ref={audioRef} src={RINGTONE_URL} preload="auto" playsInline className="hidden" />

      {call && (
        <div
          className="fixed inset-0 z-[100000] flex flex-col items-center justify-between bg-[#0b0b12] text-white animate-fade-in"
          style={{
            paddingTop: 'max(12vh, calc(env(safe-area-inset-top) + 3rem))',
            // 按钮绝不能被 Home 条压掉——压掉就等于一通停不下来、也接不起来的电话。
            paddingBottom: 'max(10vh, calc(env(safe-area-inset-bottom) + 3rem))',
          }}
        >
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
            />
          )}

          <div className="relative flex flex-col items-center px-8 text-center">
            <div className="mb-6 h-28 w-28 overflow-hidden rounded-full border border-white/15 bg-white/5 shadow-2xl">
              {avatarUrl
                ? <img src={avatarUrl} alt={name} className="h-full w-full object-cover" />
                : <div className="flex h-full w-full items-center justify-center text-3xl opacity-60">{name.slice(0, 1)}</div>}
            </div>
            <h1 className="text-[26px] font-semibold tracking-wide">{name}</h1>
            <p className="mt-2 flex items-center gap-1.5 text-[13px] tracking-[0.18em] text-white/55">
              {isVideo ? <VideoCamera size={15} weight="fill" /> : <Phone size={15} weight="fill" />}
              {isVideo ? '邀请你视频通话…' : '来电…'}
            </p>
          </div>

          <div className="relative flex w-full max-w-xs shrink-0 items-center justify-between px-6">
            <button
              type="button"
              aria-label="拒接"
              onClick={() => { void settle('declined'); }}
              className="flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#ff3b30] shadow-lg shadow-[#ff3b30]/25 active:scale-95 transition-transform"
            >
              <PhoneDisconnect size={30} weight="fill" />
            </button>
            <button
              type="button"
              aria-label="接听"
              onClick={() => { void settle('accept'); }}
              className="flex h-[68px] w-[68px] animate-bounce-slow items-center justify-center rounded-full bg-[#34c759] shadow-lg shadow-[#34c759]/25 active:scale-95 transition-transform"
            >
              {isVideo ? <VideoCamera size={30} weight="fill" /> : <Phone size={30} weight="fill" />}
            </button>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * 未接来电落一条系统消息，并让聊天界面立刻刷出来。
 *
 * **两件事缺一不可**。8/23 第一版只落了库没刷界面，结果用户从后台切回来时聊天页一片
 * 干净——电话在数据库里，人在界面上什么都看不到，跟没发生过一样。
 *
 * 为什么一定要落库：不落的话这通电话在角色眼里等于从没发生过，它下一轮读历史时看不到
 * 自己打过、也看不到你没接，不会自然地提一句「刚给你打电话没人接」。
 *
 * 导出给 utils/applyAssistantPostProcessing 复用（冷却 / 过期 / 忙线拦下的那几种也走这里，
 * 一通被系统吞掉的电话不该在任何一条路上凭空消失）。
 */
export const persistMissedCall = async (
  target: { charId: string; charName: string; mode: 'voice' | 'video'; ringAt: number },
  reason: 'missed' | 'declined' | 'stale' | 'cooldown' | 'busy',
): Promise<void> => {
  try {
    await DB.saveMessage({
      charId: target.charId,
      role: 'system',
      type: 'system',
      content: reason === 'declined' ? `未接来电 · ${target.charName}（已拒接）` : `未接来电 · ${target.charName}`,
      metadata: {
        source: 'incoming-call-missed',
        callMode: target.mode,
        characterName: target.charName,
        reason,
        ringAt: target.ringAt,
      },
    } as any);
    // 聊天页靠这个事件重读消息列表（推送落库走的是同一条路，见 activeMsgRuntime）。
    window.dispatchEvent(new CustomEvent('active-msg-progress', { detail: { charId: target.charId } }));
  } catch (e) {
    console.error('[IncomingCall] 未接来电落库失败', e);
  }
};

export default IncomingCallOverlay;
