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
 * 铃声的现实：iOS PWA 里 `<audio>` 不经用户手势不一定放得出声。绝大多数情况下没问题
 * ——角色打来电话之前你刚跟它说过话（发消息本身就是手势），音频通道已经解锁；聊天里
 * 放过语音的话更是早就解锁了。真被拦下来时不弹任何报错：横幅/震动/界面本身就是提醒，
 * 铃声只是锦上添花。这一段永远不要 throw，它挂了整通电话就接不起来了。
 */

const RINGTONE_URL = (((import.meta as any).env?.BASE_URL ?? '/') + 'sounds/incoming-call.mp3').replace(/([^:])\/\/+/g, '$1/');

/** 响多久没人接算未接。真手机是 30 秒左右，照抄。 */
const RING_TIMEOUT_MS = 30_000;

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

  const stopRinging = () => {
    if (timeoutRef.current != null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (vibrateTimerRef.current != null) { window.clearInterval(vibrateTimerRef.current); vibrateTimerRef.current = null; }
    try { navigator.vibrate?.(0); } catch { /* 不支持就算了 */ }
    const audio = audioRef.current;
    if (audio) {
      try { audio.pause(); audio.currentTime = 0; } catch { /* 同上 */ }
    }
  };

  // 响铃 + 震动 + 超时。call 变了才重来一遍。
  useEffect(() => {
    if (!call) return;
    const audio = audioRef.current;
    if (audio) {
      audio.loop = true;
      audio.volume = 0.85;
      // 播放失败只记一行日志：自动播放被拦是预期内的一种结果，不是错误。
      void audio.play().catch(err => {
        console.log('[IncomingCall] 铃声被浏览器拦下（没有近期用户手势），只走界面提醒:', err?.name || err);
      });
    }
    try {
      navigator.vibrate?.(VIBRATE_PATTERN);
      vibrateTimerRef.current = window.setInterval(() => {
        try { navigator.vibrate?.(VIBRATE_PATTERN); } catch { /* 同上 */ }
      }, 2400);
    } catch { /* iOS 没有这个 API */ }

    timeoutRef.current = window.setTimeout(() => { void settle('missed'); }, RING_TIMEOUT_MS);
    return stopRinging;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.charId, call?.ringAt]);

  /**
   * 未接 / 拒接都往聊天里落一条系统消息。
   *
   * 为什么一定要落：不落的话这通电话在角色眼里等于没发生过——它下一轮读历史时看不到
   * 自己打过、也看不到你没接，会当作什么都没说过。落了它才可能自然地提一句"刚才给你
   * 打电话没人接"。type 用 'system' 跟"通话结束"那条对齐（CallApp.finishCall）。
   */
  const persistMissed = async (target: PendingIncomingCall, reason: 'missed' | 'declined') => {
    try {
      await DB.saveMessage({
        charId: target.charId,
        role: 'system',
        type: 'system',
        content: reason === 'declined'
          ? `未接来电 · ${target.charName}（已拒接）`
          : `未接来电 · ${target.charName}`,
        metadata: {
          source: 'incoming-call-missed',
          callMode: target.mode,
          reason,
          ringAt: target.ringAt,
        },
      } as any);
    } catch (e) {
      console.error('[IncomingCall] 未接来电落库失败', e);
    }
  };

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
    await persistMissed(target, action === 'declined' ? 'declined' : 'missed');
  };

  if (!call) return null;

  const isVideo = call.mode === 'video';
  const name = char?.name || call.charName;

  return (
    <div className="fixed inset-0 z-[100000] flex flex-col items-center justify-between bg-[#0b0b12] text-white animate-fade-in">
      {/* 铃声：即使被拦下也要留着这个节点，用户点"接听"那一下会给音频通道解锁 */}
      <audio ref={audioRef} src={RINGTONE_URL} preload="auto" playsInline />

      {avatarUrl && (
        <img
          src={avatarUrl}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-2xl"
        />
      )}

      <div className="relative mt-[18vh] flex flex-col items-center px-8 text-center">
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

      <div className="relative mb-[12vh] flex w-full max-w-xs items-center justify-between px-6">
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
  );
};

export default IncomingCallOverlay;
