/**
 * 手机这一侧的放映室连接：建房间（配对）+ 一条会自己重连的 WebSocket。
 * Worker 那边见 worker/amsg/src/watchRoom.ts，它只转发，不看内容。
 */
import { ActiveMsgStore } from '../activeMsgStore';
import { watchSocketUrl, type CinemaPairing } from './cinema';

export class WatchRoomError extends Error {
    constructor(message: string, readonly code?: string) {
        super(message);
        this.name = 'WatchRoomError';
    }
}

/** 读「主动消息 2.0」里填好的 Worker 地址和共享密钥。影院复用同一台 Worker。 */
export async function readWorkerConfig(): Promise<{ workerUrl: string; serverToken: string }> {
    const config = await ActiveMsgStore.getGlobalConfig();
    const workerUrl = (config.workerUrl || '').trim().replace(/\/+$/, '');
    if (!workerUrl) throw new WatchRoomError('还没有填 Worker 地址。先去「设置 → 主动消息 2.0」把 Worker 连上，影院要借它传画面。', 'NO_WORKER');
    return { workerUrl, serverToken: config.serverToken || '' };
}

/** 建一间新放映室，拿到配对码。旧的配对随之作废（电脑要重新输码）。 */
export async function createWatchRoom(): Promise<CinemaPairing> {
    const { workerUrl, serverToken } = await readWorkerConfig();
    let res: Response;
    try {
        res = await fetch(`${workerUrl}/watch-room/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(serverToken ? { 'X-Client-Token': serverToken } : {}) },
            body: '{}',
        });
    } catch (error: any) {
        throw new WatchRoomError(`连不上 Worker：${error?.message || error}`);
    }
    const body: any = await res.json().catch(() => null);
    if (res.ok && body?.data?.code && body?.data?.secret) {
        return { id: 'cinema-pair', workerUrl, code: body.data.code, secret: body.data.secret, createdAt: Date.now() };
    }
    if (res.status === 404 && !body?.error) {
        throw new WatchRoomError('Worker 上还没有放映室功能。去「设置 → 主动消息 2.0」点一次「更新 Worker」，再回来。', 'OLD_WORKER');
    }
    throw new WatchRoomError(body?.error?.message ? `${body.error.message}（HTTP ${res.status}）` : `建放映室失败（HTTP ${res.status}）`, body?.error?.code);
}

export type WatchMessage = { type: string; [key: string]: unknown };
export type WatchConnState = 'connecting' | 'open' | 'closed';

/**
 * 会自己重连的放映室连接。iPhone 锁屏 / 切后台会把 WebSocket 掐掉，
 * 回到前台时立刻重连；平时断了按 1s、2s、4s……最多 15s 重试。
 */
export class WatchRoomSocket {
    private ws: WebSocket | null = null;
    private stopped = false;
    private retry = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private pingTimer: ReturnType<typeof setInterval> | null = null;
    private readonly onVisible = () => {
        if (document.visibilityState === 'visible' && !this.stopped && (!this.ws || this.ws.readyState > 1)) {
            this.retry = 0;
            this.connect();
        }
    };

    constructor(
        private readonly pairing: CinemaPairing,
        private readonly handlers: {
            onMessage: (msg: WatchMessage) => void;
            onState: (state: WatchConnState, detail?: string) => void;
        },
    ) {}

    start() {
        this.stopped = false;
        document.addEventListener('visibilitychange', this.onVisible);
        this.connect();
    }

    stop() {
        this.stopped = true;
        document.removeEventListener('visibilitychange', this.onVisible);
        if (this.retryTimer) clearTimeout(this.retryTimer);
        if (this.pingTimer) clearInterval(this.pingTimer);
        try { this.ws?.close(1000, 'bye'); } catch { /* ignore */ }
        this.ws = null;
    }

    send(msg: WatchMessage): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
        this.ws.send(JSON.stringify(msg));
        return true;
    }

    private connect() {
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
        try { this.ws?.close(); } catch { /* ignore */ }
        this.handlers.onState('connecting');
        let ws: WebSocket;
        try {
            ws = new WebSocket(watchSocketUrl(this.pairing.workerUrl, this.pairing, 'phone'));
        } catch (error: any) {
            this.handlers.onState('closed', error?.message || String(error));
            this.scheduleRetry();
            return;
        }
        this.ws = ws;
        ws.onopen = () => {
            this.retry = 0;
            this.handlers.onState('open');
            if (this.pingTimer) clearInterval(this.pingTimer);
            this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 25_000);
        };
        ws.onmessage = (event) => {
            if (typeof event.data !== 'string') return;
            try {
                const msg = JSON.parse(event.data);
                if (msg && typeof msg.type === 'string' && msg.type !== 'pong') this.handlers.onMessage(msg);
            } catch { /* 不是 JSON 就不理 */ }
        };
        ws.onclose = (event) => {
            if (this.ws !== ws) return;
            if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
            // 握手就被拒（密钥不对 / 房间没了）时浏览器只给 1006，没有更多信息
            this.handlers.onState('closed', event.code === 1006 ? '连接断开（1006）' : `连接断开（${event.code}）`);
            if (!this.stopped) this.scheduleRetry();
        };
    }

    private scheduleRetry() {
        if (this.stopped || document.visibilityState !== 'visible') return;
        const delay = Math.min(15_000, 1000 * 2 ** this.retry);
        this.retry += 1;
        this.retryTimer = setTimeout(() => this.connect(), delay);
    }
}
