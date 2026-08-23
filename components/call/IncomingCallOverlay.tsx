import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneDisconnect, VideoCamera } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import { AppID } from '../../types';
import { DB } from '../../utils/db';
import { useBlobRefUrl } from '../../utils/blobRef';
import { isRinging, primeRingtone, startRingtone, stopRingtone } from '../../utils/callRingtone';
import {
  INCOMING_CALL_EVENT,
  clearPendingIncomingCall,
  getIncomingCallPresentedAt,
  getPendingIncomingCall,
  isStaleIncomingCall,
  markIncomingCallPresented,
  type PendingIncomingCall,
} from '../../utils/incomingCall';

/**
 * 角色主动来电的全屏界面。挂在 PhoneShell 最外层，盖在所有 App 之上——**包括锁屏**。
 *
 * ⚠️ 这个组件**随时可能被卸载**：PhoneShell 在开机动画 / 数据加载中 / 锁屏这三种情况下
 * 都会提前 return。所以铃声一个字都不能放在这里，全部交给 utils/callRingtone 那个
 * React 之外的单例（那份文件顶上写着两次事故的全过程）。这里只负责画界面和收按键。
 *
 * 为什么不做成一个 App：来电必须能盖住"用户此刻正在用的任何东西"。做成 App 就得先
 * openApp、把用户手上那个页面顶掉，拒接之后还回不去原来的地方。
 */

/**
 * 页面在后台时，这通电话最多"举着"多久等你回来。
 *
 * 8/23 实测出来的坑：推送到了、横幅弹了，但用户是**从后台切回来**的（没点横幅）。
 * 那一刻补收在后台就跑完了，来电界面在看不见的页面上响了 30 秒然后自己判成未接——
 * 用户切回来时什么都没有。所以页面不可见时**根本不开始计时**，等回到前台再响。
 * 超过这个岁数才认命记未接：隔了半小时才回来的电话，响起来只会吓人。
 */
const BACKGROUND_HOLD_MS = 5 * 60_000;

const IncomingCallOverlay: React.FC = () => {
  const { openApp, characters } = useOS();
  const [call, setCall] = useState<PendingIncomingCall | null>(() => getPendingIncomingCall());
  // 接听/拒接/超时会在同一帧里被触发两次（点按 + 看门狗同时到），落两条未接记录。
  const settledRef = useRef(false);

  const char = call ? characters.find(c => c.id === call.charId) : undefined;
  const avatarUrl = useBlobRefUrl(char?.avatar || call?.charAvatar);

  /**
   * 借用户的第一次触摸解锁铃声（详见 utils/callRingtone 的 primeRingtone）。
   * 正在响铃时不解锁——那一下会把真铃声掐掉。
   */
  useEffect(() => {
    const prime = () => {
      if (isRinging()) return;
      primeRingtone();
      detach();
    };
    const detach = () => {
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('touchend', prime);
      window.removeEventListener('keydown', prime);
    };
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
    const target = call ?? getPendingIncomingCall();
    stopRingtone();
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

  // 响铃 + 超时。页面不可见时先按住不动，等切回前台再响（见 BACKGROUND_HOLD_MS）。
  useEffect(() => {
    if (!call) return;
    let disposed = false;
    const onTimeout = () => { void settle('missed'); };

    // Overlay 可能在 APP 重进、锁屏切换或离线补收后重新挂载。pending 是模块级
    // 单例，不能假设它一定是刚刚到达的电话；过期来电只记未接，绝不能重新响铃。
    if (isStaleIncomingCall(call.ringAt)) {
      void settle('missed');
      return () => { disposed = true; stopRingtone(); };
    }

    const begin = () => {
      if (disposed || settledRef.current) return;
      // 锁屏→解锁、开机动画结束等会让 Overlay 重挂载。单例铃声还在响时只保留当前
      // 音频，不能再次从头播放；若音频已因整页重载/离开页面停掉，而这通电话曾经响过，
      // 也不要把旧 pending 当成新来电再次吓用户。
      if (isRinging()) return;
      if (getIncomingCallPresentedAt(call) != null) {
        void settle('missed');
        return;
      }
      markIncomingCallPresented(call);
      startRingtone(onTimeout);
    };

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      begin();
      return () => {
        disposed = true;
        const current = getPendingIncomingCall();
        if (settledRef.current || !current || current.charId !== call.charId || current.ringAt !== call.ringAt) {
          stopRingtone();
        }
      };
    }

    // 页面在后台：先不响。回到前台再开始，或者举太久了就认命记未接。
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      if (Date.now() - call.ringAt > BACKGROUND_HOLD_MS) { void settle('missed'); return; }
      begin();
    };
    document.addEventListener('visibilitychange', onVisible);
    const holdTimer = window.setTimeout(() => { void settle('missed'); }, BACKGROUND_HOLD_MS);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.clearTimeout(holdTimer);
      // pending 仍属于这通未处理的电话时，Overlay 的短暂卸载不能掐掉单例铃声。
      // pagehide/beforeunload 仍会在真正离开页面时兜底 stopRingtone。
      const current = getPendingIncomingCall();
      if (settledRef.current || !current || current.charId !== call.charId || current.ringAt !== call.ringAt) {
        stopRingtone();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.charId, call?.ringAt]);

  if (!call) return null;

  const isVideo = call.mode === 'video';
  const name = char?.name || call.charName;

  return (
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
