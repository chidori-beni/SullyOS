/**
 * 通话 App 直达意图。
 *
 * 聊天里的「通话结束」卡片需要穿过 PhoneShell 的 App 切换，
 * 在 CallApp 挂载后直接打开对应的通话记录。这里与 roomLaunch/dateLaunch
 * 一样使用 module-level 一次性意图，不把导航状态写进用户数据。
 */

export interface CallLaunchIntent {
  charId: string;
  sessionId: string;
  /** 从某个 App 深链进来时，记录关闭记录页后的返回目标。 */
  returnTo?: 'chat';
}

let pending: CallLaunchIntent | null = null;

export const callLaunch = {
  request(intent: CallLaunchIntent): void {
    pending = intent;
  },
  peek(): CallLaunchIntent | null {
    return pending;
  },
  consume(): CallLaunchIntent | null {
    const value = pending;
    pending = null;
    return value;
  },
};
