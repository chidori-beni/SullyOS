/**
 * 彼方虚拟邮局 · 客户端 API
 *
 * 对接【所有用户共用】的后端（默认 https://noir2.cc.cd/po）。
 * 匿名：本地一个随机 deviceId，无登录无 PII。
 */

export const DEFAULT_POST_OFFICE_BASE = 'https://noir2.cc.cd/po';
const DEFAULT_BASE = DEFAULT_POST_OFFICE_BASE;
const BASE_KEY = 'vr_po_base';
const DEVICE_KEY = 'vr_po_device';

export type PostOfficeErrorKind = 'network' | 'http' | 'protocol' | 'config';

/** 邮局请求失败的可判别错误，避免把 CORS/TLS/安全网关拦截误报成业务失败。 */
export class PostOfficeError extends Error {
    constructor(
        message: string,
        public readonly kind: PostOfficeErrorKind,
        public readonly status?: number,
        public readonly host?: string,
    ) {
        super(message);
        this.name = 'PostOfficeError';
        Object.setPrototypeOf(this, PostOfficeError.prototype);
    }
}

export type PostOfficeProbeStatus = 'reachable' | 'http_error' | 'invalid_service' | 'network_unreachable' | 'invalid_config';
export interface PostOfficeProbeResult {
    status: PostOfficeProbeStatus;
    base?: string;
    host?: string;
    httpStatus?: number;
    message: string;
}

const postOfficeHost = (base: string): string => {
    try { return new URL(base).host; } catch { return base || '未知地址'; }
};

/** 只接受可信的 HTTPS 邮局地址，不把凭据、查询参数或 hash 持久化。 */
export function normalizePostOfficeBase(value: string): string {
    const raw = (value || '').trim();
    if (!raw) throw new PostOfficeError('请填写邮局后端地址', 'config');
    let url: URL;
    try { url = new URL(raw); } catch { throw new PostOfficeError('邮局地址不是有效的 URL', 'config'); }
    if (url.protocol !== 'https:') throw new PostOfficeError('邮局后端必须使用 HTTPS', 'config');
    if (url.username || url.password) throw new PostOfficeError('邮局地址不能包含账号或密码', 'config');
    if (url.search || url.hash) throw new PostOfficeError('邮局地址不能包含查询参数或 hash', 'config');
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${pathname}`;
}

export function describePostOfficeError(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return '未知错误';
}

const shortRemoteError = (value: unknown): string => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return text.slice(0, 120);
};

const probeMessage = (status: PostOfficeProbeStatus, host: string, httpStatus?: number, detail?: string): string => {
    if (status === 'reachable') return `连接成功：已确认 ${host} 是 SullyOS 邮局服务`;
    if (status === 'invalid_config') return detail || '邮局地址无效';
    if (status === 'http_error') return `地址 ${host} 返回 HTTP ${httpStatus ?? '错误'}${detail ? `：${detail}` : ''}`;
    if (status === 'invalid_service') return `地址 ${host} 可访问，但不是 SullyOS 邮局服务（/health 协议不匹配）`;
    return `无法连接邮局后端 ${host}：浏览器没有拿到响应，可能是网络、DNS、TLS、安全软件、域名拦截或 CORS。`;
};

/** 在不改变当前配置的前提下探测候选邮局地址。 */
export async function probePostOfficeBase(candidate: string): Promise<PostOfficeProbeResult> {
    let base: string;
    try { base = normalizePostOfficeBase(candidate); }
    catch (error) {
        return { status: 'invalid_config', message: describePostOfficeError(error) };
    }
    const host = postOfficeHost(base);
    let res: Response;
    try {
        res = await fetch(`${base}/health`, { method: 'GET', headers: { Accept: 'application/json' } });
    } catch {
        return { status: 'network_unreachable', base, host, message: probeMessage('network_unreachable', host) };
    }
    const data: any = await res.json().catch(() => null);
    if (!res.ok) {
        const detail = shortRemoteError(data?.error);
        return { status: 'http_error', base, host, httpStatus: res.status, message: probeMessage('http_error', host, res.status, detail) };
    }
    if (data?.ok !== true || data?.service !== 'sullyos-post-office') {
        return { status: 'invalid_service', base, host, httpStatus: res.status, message: probeMessage('invalid_service', host) };
    }
    return { status: 'reachable', base, host, httpStatus: res.status, message: probeMessage('reachable', host) };
}

/** 单封正文字数上限（按字符：1 汉字/标点 = 1 字）。UI 输入框可用它做限制提示。 */
export const MAX_LETTER_CHARS = 400;
/** 按字符截断到上限（兜底；后端也会再截一次） */
const clipContent = (s: string): string => [...(s || '')].slice(0, MAX_LETTER_CHARS).join('');

export const getPostOfficeBase = (): string => {
    try {
        const stored = localStorage.getItem(BASE_KEY);
        return stored ? normalizePostOfficeBase(stored) : DEFAULT_BASE;
    }
    catch { return DEFAULT_BASE; }
};
export const setPostOfficeBase = (url: string) => {
    const trimmed = url.trim();
    const normalized = trimmed ? normalizePostOfficeBase(trimmed) : '';
    try { normalized ? localStorage.setItem(BASE_KEY, normalized) : localStorage.removeItem(BASE_KEY); } catch { /* ignore */ }
};

export const getDeviceId = (): string => {
    try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = (globalThis.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`);
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    } catch {
        return 'dev-anonymous';
    }
};

/**
 * 笔名马赛克：寄信/回信时把真实角色名换成一个稳定的匿名笔名。
 * 同名 → 同笔名（便于多次往来的连续感），但圈子里的人看不出是谁。
 */
const PEN_POOL = [
    '山雀', '渡口', '夜航船', '北纬以北', '苔痕', '停摆的钟', '未寄出', '远洋来信',
    '拾光', '梧桐巷口', '十一月', '旧船票', '薄雾', '信天翁', '空瓶', '逆旅',
    '檐下雨', '无人岛', '回声', '草垛', '末班车', '潮汐表', '蝉蜕', '星图边角',
];
export function maskPen(name: string): string {
    const n = (name || '').trim();
    if (!n) return '匿名旅人';
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return PEN_POOL[h % PEN_POOL.length];
}

export interface RemoteLetter {
    id: string; pen: string; content: string; created_at: number;
    likes?: number; dislikes?: number; views?: number; reply_count?: number;
}
export interface RemoteReply { id: string; letter_id: string; pen: string; content: string; created_at: number; }
/** 我寄出的信的热度统计（赞/踩/浏览量/回信数）。 */
export interface RemoteLetterStat { id: string; likes: number; dislikes: number; views: number; reply_count: number; created_at: number; }
export interface RemoteAdminLetter { id: string; pen: string; content: string; lang?: string; created_at: number; reply_count: number; likes: number; dislikes: number; views: number; }

async function callAtBase<T>(base: string, path: string, opts: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
    const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
    const host = postOfficeHost(base);
    let res: Response;
    try {
        res = await fetch(`${base}${path}${qs}`, {
            method: opts.method || 'GET',
            headers: { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers as Record<string, string> || {}) },
            body: opts.body,
        });
    } catch {
        throw new PostOfficeError(
            `无法连接邮局后端（${host}）。浏览器没有拿到响应，可能是网络、DNS、TLS、安全软件、域名拦截或 CORS。`,
            'network', undefined, host,
        );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || (data && data.ok === false)) {
        const detail = shortRemoteError(data && data.error);
        throw new PostOfficeError(`HTTP ${res.status}${detail ? `：${detail}` : ''}`, 'http', res.status, host);
    }
    return data as T;
}

async function call<T>(path: string, opts: RequestInit & { query?: Record<string, string> } = {}): Promise<T> {
    return callAtBase(getPostOfficeBase(), path, opts);
}

/** 发送状态机使用：只有完整、唯一的回执才允许把本地信标记为已寄出。 */
export function assertCompleteLetterReceipt(ids: unknown, expectedCount: number): string[] {
    if (!Array.isArray(ids) || ids.length !== expectedCount) {
        const actual = Array.isArray(ids) ? ids.length : 0;
        throw new PostOfficeError(`邮局回执不完整（收到 ${actual}/${expectedCount} 个远端 ID）`, 'protocol');
    }
    const normalized = ids.map(id => typeof id === 'string' ? id.trim() : '');
    if (normalized.some(id => !id) || new Set(normalized).size !== normalized.length) {
        throw new PostOfficeError('邮局回执包含空 ID 或重复 ID', 'protocol');
    }
    return normalized;
}

export const PostOffice = {
    async health(): Promise<boolean> {
        const r = await probePostOfficeBase(getPostOfficeBase());
        return r.status === 'reachable';
    },

    /** 健康检查的详细版本，供设置面板在失败时保留原因。 */
    async checkHealth(): Promise<PostOfficeProbeResult> {
        return probePostOfficeBase(getPostOfficeBase());
    },

    /** 上传待寄出的信，返回服务端分配的 id 列表（笔名自动马赛克） */
    async uploadLetters(letters: { pen: string; content: string; lang?: string }[]): Promise<string[]> {
        const masked = letters.map(l => ({ ...l, pen: maskPen(l.pen), content: clipContent(l.content) }));
        const r = await call<{ ids: string[] }>('/letters', { method: 'POST', body: JSON.stringify({ device: getDeviceId(), letters: masked }) });
        return Array.isArray(r?.ids) ? r.ids : [];
    },

    /** 随机抽别人的、还能回的信 */
    async fetchInbox(limit = 5): Promise<RemoteLetter[]> {
        const r = await call<{ letters: RemoteLetter[] }>('/inbox', { query: { device: getDeviceId(), limit: String(limit) } });
        return r.letters || [];
    },

    /** 上传回信（笔名自动马赛克） */
    async uploadReplies(replies: { letterId: string; pen: string; content: string }[]): Promise<number> {
        const masked = replies.map(rp => ({ ...rp, pen: maskPen(rp.pen), content: clipContent(rp.content) }));
        const r = await call<{ accepted: number }>('/replies', { method: 'POST', body: JSON.stringify({ device: getDeviceId(), replies: masked }) });
        return r.accepted || 0;
    },

    /** 取回挂在"我寄出的信"上的回复 */
    async fetchReplies(): Promise<RemoteReply[]> {
        const r = await call<{ replies: RemoteReply[] }>('/replies', { query: { device: getDeviceId() } });
        return r.replies || [];
    },

    /** 取回"我寄出的信"的赞/踩/浏览量等热度（与 fetchReplies 同一接口，按需取用） */
    async fetchMyStats(): Promise<RemoteLetterStat[]> {
        const r = await call<{ letters: RemoteLetterStat[] }>('/replies', { query: { device: getDeviceId() } });
        return r.letters || [];
    },

    /** 点赞(1) / 点踩=举报(-1) / 撤销(0)。返回最新计数；信若已被删则 deleted=true */
    async vote(letterId: string, vote: 1 | -1 | 0): Promise<{ likes: number; dislikes: number; deleted?: boolean }> {
        const r = await call<{ likes?: number; dislikes?: number; deleted?: boolean }>('/vote', {
            method: 'POST', body: JSON.stringify({ device: getDeviceId(), letterId, vote }),
        });
        return { likes: r.likes ?? 0, dislikes: r.dislikes ?? 0, deleted: r.deleted };
    },

    /** 原作者留档后释放（后端删除信+回复） */
    async release(letterIds: string[]): Promise<void> {
        if (letterIds.length === 0) return;
        await call('/release', { method: 'POST', body: JSON.stringify({ device: getDeviceId(), letterIds }) });
    },

    /** [管理] 列出后端全部信件（按踩数、时间倒序）。token 走 Bearer 头，不进 URL。 */
    async adminList(token: string, limit = 200): Promise<RemoteAdminLetter[]> {
        const r = await call<{ letters: RemoteAdminLetter[] }>('/admin/list', {
            query: { limit: String(limit) }, headers: { Authorization: `Bearer ${token}` },
        });
        return r.letters || [];
    },

    /** [管理] 删除指定信件（每批≤100）。 */
    async adminDelete(token: string, letterIds: string[]): Promise<number> {
        if (letterIds.length === 0) return 0;
        const r = await call<{ deleted: number }>('/admin/delete', {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ letterIds: letterIds.slice(0, 100) }),
        });
        return r.deleted || 0;
    },
};

// ── 备份用：把邮局的本机配置随「设置 → 导出/导入备份」一起带走 ──────────
// 带的是【身份 deviceId】（决定"我寄出的信"的归属）和【后端地址】；
// admin token 是后端管理凭证，故意不写进可被分享的备份里，避免泄露。
export function exportPostOfficeLocal(): Record<string, string> | undefined {
    try {
        const out: Record<string, string> = {};
        const dev = localStorage.getItem(DEVICE_KEY); if (dev) out[DEVICE_KEY] = dev;
        const base = localStorage.getItem(BASE_KEY); if (base) out[BASE_KEY] = base;
        return Object.keys(out).length ? out : undefined;
    } catch { return undefined; }
}
export function importPostOfficeLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        if (typeof data[DEVICE_KEY] === 'string' && data[DEVICE_KEY]) localStorage.setItem(DEVICE_KEY, data[DEVICE_KEY]);
        if (typeof data[BASE_KEY] === 'string') {
            if (data[BASE_KEY]) localStorage.setItem(BASE_KEY, data[BASE_KEY]); else localStorage.removeItem(BASE_KEY);
        }
    } catch { /* ignore */ }
}

// ── 管理员 token：本地留存，免得每次重输（仅存在本机 localStorage）──────
const ADMIN_TOKEN_KEY = 'vr_po_admin_token';
export const getAdminToken = (): string => { try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; } catch { return ''; } };
export const setAdminToken = (t: string) => { try { t.trim() ? localStorage.setItem(ADMIN_TOKEN_KEY, t.trim()) : localStorage.removeItem(ADMIN_TOKEN_KEY); } catch { /* ignore */ } };

// ── 身份导出 / 导入：换设备或清数据后找回「我的信」与责任 ──────────────
const ID_PREFIX = 'sullypo';
const idChecksum = (s: string): string => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h.toString(36).slice(0, 4).padStart(4, '0');
};
/** 导出当前身份码（带校验位），可抄到别处导入。 */
export function exportIdentity(): string {
    const id = getDeviceId();
    return `${ID_PREFIX}.${id}.${idChecksum(id)}`;
}
/** 导入身份码：校验通过则替换本地 deviceId，返回是否成功。 */
export function importIdentity(code: string): boolean {
    const parts = (code || '').trim().split('.');
    if (parts.length !== 3 || parts[0] !== ID_PREFIX) return false;
    const [, id, sum] = parts;
    if (!id || idChecksum(id) !== sum) return false;
    try { localStorage.setItem(DEVICE_KEY, id); return true; } catch { return false; }
}
