import React, { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { amsgPushRevokeHeal } from '../utils/amsgPushRevokeHeal';
import './WebUpdateNotice.css';

/**
 * 推送订阅被系统收回、又没法静默重订时的一键恢复横幅（判定见 utils/amsgPushRevokeHeal.ts）。
 * 放在顶部，免得和底部的「新版本已准备好」叠在一起。
 */
export default function PushRevokedNotice() {
  const state = useSyncExternalStore(amsgPushRevokeHeal.subscribe, amsgPushRevokeHeal.getSnapshot, amsgPushRevokeHeal.getSnapshot);
  if (!state.needsTap) return null;
  return createPortal(
    <aside
      className="sully-web-update"
      role="region"
      aria-label="消息通知已断开"
      style={{ top: 'calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 18px)', bottom: 'auto' }}
    >
      <strong>消息通知被系统关掉了</strong>
      <p>角色发来的消息还在，只是不会弹通知。点一下就能恢复。</p>
      {state.error && <p role="status">{state.error}</p>}
      <div>
        <button type="button" disabled={state.working} onClick={() => void amsgPushRevokeHeal.restoreByTap()}>
          {state.working ? '正在恢复…' : '恢复通知'}
        </button>
        <button type="button" disabled={state.working} onClick={() => amsgPushRevokeHeal.dismiss()}>稍后</button>
      </div>
    </aside>, document.body,
  );
}
