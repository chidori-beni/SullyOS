import { ActiveMsgStore } from './activeMsgStore';
import { ActiveMsgClient } from './activeMsgClient';
import { describePushCapabilityGap } from './pushSubscribeShared';
import { isUnifiedPushPlatform } from './unifiedPushPlugin';
import { makeDebugLogger } from './devDebug';

/**
 * 推送订阅被系统收回后的自愈。
 *
 * iOS 的规矩是每条 push 都必须弹通知，前台压掉横幅满 3 次就把订阅收回，而且不发
 * pushsubscriptionchange——refreshPushSubscriptionIfMarked 那条路根本等不到标记。
 * 表现是「主动消息 2.0 的通知权限、即时对话自己关了」：Worker 那边还登记着旧端点，
 * 推出去全被苹果拒收，角色消息只能等打开 App 时补收，横幅一条都不弹。
 *
 * SW 那边已经补了「每次推送都弹」的兜底（worker/sw-keep-alive.ts 1.21.0），这里管
 * 已经被收回的情况：页面回到前台时看一眼，浏览器这侧没订阅、Worker 那边却登记着（说明
 * 用户开过推送），就静默重订一次；重订被拒（iOS 可能要求用户亲手点）就挂一条横幅，
 * 让用户一点恢复。
 */

const log = makeDebugLogger('amsg', '推送自愈');

/** 两次自检的最小间隔。回前台事件扎堆（visibilitychange + pageshow + focus），一次就够。 */
const CHECK_INTERVAL_MS = 60_000;

export type PushRevokeHealResult = 'ok' | 'skipped' | 'healed' | 'needs-tap';

type Snapshot = { needsTap: boolean; working: boolean; error: string };

let snapshot: Snapshot = { needsTap: false, working: false, error: '' };
const listeners = new Set<() => void>();
let lastCheckAt = 0;
let running: Promise<PushRevokeHealResult> | null = null;

const setSnapshot = (next: Partial<Snapshot>) => {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
};

const runCheck = async (): Promise<PushRevokeHealResult> => {
  if (isUnifiedPushPlatform() || describePushCapabilityGap()) return 'skipped';
  const config = await ActiveMsgStore.getGlobalConfig();
  if (!config.workerUrl?.trim() || !config.initializedAt) return 'skipped';

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'skipped';
  if (await registration.pushManager.getSubscription()) {
    if (snapshot.needsTap) setSnapshot({ needsTap: false, error: '' });
    return 'ok';
  }

  // 浏览器这侧没订阅。Worker 那边也没登记的，是用户本来就没开推送，不打扰。
  const remote = await ActiveMsgClient.getRemotePushSubscription();
  if (!remote?.exists) return 'skipped';

  if (Notification.permission === 'granted') {
    try {
      await ActiveMsgClient.registerPushSubscription();
      log.info('推送订阅被系统收回，已静默重订');
      setSnapshot({ needsTap: false, error: '' });
      return 'healed';
    } catch (error) {
      log.warn('静默重订失败，改为请用户点一下', { error });
    }
  }
  setSnapshot({ needsTap: true });
  return 'needs-tap';
};

export const amsgPushRevokeHeal = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => snapshot,

  /** 回前台 / 启动时调。自带节流与并发合并，可以随便调。 */
  check(): Promise<PushRevokeHealResult> {
    if (running) return running;
    const now = Date.now();
    if (now - lastCheckAt < CHECK_INTERVAL_MS) return Promise.resolve('skipped');
    lastCheckAt = now;
    running = runCheck()
      .catch((error) => {
        log.warn('推送订阅自检没做成（不影响别的功能）', { error });
        return 'skipped' as const;
      })
      .finally(() => { running = null; });
    return running;
  },

  /** 横幅上的按钮：用户手势里重订（iOS 要求权限请求出自用户点击）。 */
  async restoreByTap(): Promise<boolean> {
    setSnapshot({ working: true, error: '' });
    try {
      await ActiveMsgClient.registerPushSubscription();
      setSnapshot({ needsTap: false, working: false });
      return true;
    } catch (error) {
      setSnapshot({ working: false, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  },

  dismiss() {
    setSnapshot({ needsTap: false, error: '' });
  },
};
