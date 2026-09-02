export interface ChatDetailLaunchIntent {
    /** 要直接打开的单聊对象。 */
    charId: string;
    /** 是否顺手清掉这个角色的未读（从通知/预览卡进来时为真）。 */
    clearUnread?: boolean;
}

type ChatDetailLaunchListener = (intent: ChatDetailLaunchIntent) => void;

const CHAT_DETAIL_LAUNCH_EVENT = 'sullyos:chat-detail-launch';
let pending: ChatDetailLaunchIntent | null = null;

/**
 * 消息 App 的「直接进单聊」意图。
 *
 * `AppID.Chat` 挂载的是 Messaging，好友列表 / 单聊详情由它内部的 `view` 决定，
 * 而 `view` 每次挂载都从 'list' 起步。于是所有「点进去应该就是这段对话」的入口
 * ——桌面消息预览卡、推送横幅、通话记录卡返回——都会先落到好友列表。
 *
 * 这里沿用 callLaunch / dateLaunch 的一次性意图：pending 负责 Messaging 尚未挂载
 * 时的首帧直达，自定义事件负责 Messaging 已经开着时的即时切换。Messaging 应用后
 * 立即 consume，绝不污染下一次从桌面正常点开消息 App（那时就该是好友列表）。
 */
export const chatDetailLaunch = {
    request(intent: ChatDetailLaunchIntent): void {
        if (!intent?.charId) return;
        pending = intent;
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent<ChatDetailLaunchIntent>(CHAT_DETAIL_LAUNCH_EVENT, { detail: intent }));
        }
    },
    peek(): ChatDetailLaunchIntent | null {
        return pending;
    },
    consume(): ChatDetailLaunchIntent | null {
        const value = pending;
        pending = null;
        return value;
    },
    subscribe(listener: ChatDetailLaunchListener): () => void {
        if (typeof window === 'undefined') return () => {};
        const handler = (event: Event) => listener((event as CustomEvent<ChatDetailLaunchIntent>).detail);
        window.addEventListener(CHAT_DETAIL_LAUNCH_EVENT, handler);
        return () => window.removeEventListener(CHAT_DETAIL_LAUNCH_EVENT, handler);
    },
};
