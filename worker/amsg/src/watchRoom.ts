/**
 * 影院 · 放映室中转。
 *
 * 电脑上的「观影端」网页（public/watch.html）负责截画面、报播放进度；手机上的影院 App
 * 负责让角色看、调模型。两边都连到这里的同一个 Durable Object 实例，互相转发消息。
 * **这里只是一根管子**：不看、不存画面，不碰模型，也不认识消息里具体是什么。以后
 * 加新的消息种类（暂停同步、遥控……）都不用再改 Worker。
 *
 * 复用 InstantTickDO 这个类，实例名 `watch:<配对码>`。刻意不新建 DO 类：新类要写
 * migration，而 selfUpdate.ts / utils/cfProvision.ts 只会给 InstantTickDO 这一个类
 * 补 migration（乐观锁 old_tag 那套），扩展它风险很大。复用已有的类就完全不碰 migration。
 *
 * 配对流程：
 *   1. 手机 POST /watch-room/create（带 X-Client-Token）→ 拿到 6 位配对码 + 房间密钥，
 *      配对窗口开 10 分钟
 *   2. 电脑输入配对码 POST /watch-room/pair → 拿到同一把房间密钥，窗口随即关闭（一次性）
 *   3. 两边都用 GET /watch-room/ws?room=码&secret=密钥&role=phone|screen 连 WebSocket
 *   4. 油猴脚本不连 WebSocket，用 POST /watch-room/report 报播放状态，广播给两边
 * 两边都把码和密钥记下来，以后打开就直接连，不用再配对。
 */
import type { DurableObjectState } from 'cloudflare:workers';

export const WATCH_ROOM_INSTANCE_PREFIX = 'watch:';
/** 去掉了 0/O、1/I/L 这类看着像的字符，电脑上照着手机敲不容易敲错。 */
export const WATCH_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const WATCH_CODE_LENGTH = 6;
export const WATCH_PAIR_WINDOW_MS = 10 * 60 * 1000;
/** 一条消息的上限。画面帧压到 640px JPEG 大约 60~120KB，留足余量；再大多半是发错了。 */
export const WATCH_MAX_MESSAGE_CHARS = 1_500_000;
export type WatchRole = 'phone' | 'screen';

const ROOM_KEY = 'watchRoom';
const PLAYER_KEY = 'watchPlayer';

interface WatchRoomRecord {
  secret: string;
  createdAt: number;
  pairOpenUntil: number;
  pairedAt?: number;
}

export const generateWatchCode = (random: (n: number) => Uint8Array = defaultRandom): string => {
  const bytes = random(WATCH_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < WATCH_CODE_LENGTH; i += 1) out += WATCH_CODE_ALPHABET[bytes[i] % WATCH_CODE_ALPHABET.length];
  return out;
};

export const generateWatchSecret = (random: (n: number) => Uint8Array = defaultRandom): string =>
  Array.from(random(24), b => b.toString(16).padStart(2, '0')).join('');

/** 用户手敲的码：去空格、去横杠、转大写，再核对字符集。对不上返回 null。 */
export const normalizeWatchCode = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (code.length !== WATCH_CODE_LENGTH) return null;
  for (const ch of code) if (!WATCH_CODE_ALPHABET.includes(ch)) return null;
  return code;
};

export const parseWatchRole = (raw: unknown): WatchRole | null =>
  raw === 'phone' || raw === 'screen' ? raw : null;

function defaultRandom(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

const safeEqual = (a: string, b: string): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

// ─── Worker 入口这一侧：校验参数，转给对应的 DO 实例 ───

export interface WatchRoomNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface WatchRouteDeps {
  request: Request;
  namespace: WatchRoomNamespace | undefined;
  /** 共享密钥校验（跟 /tick-report 同一道门）。建房间要过，配对和连接靠房间密钥。 */
  checkClientToken: (request: Request) => Promise<boolean>;
  json: (status: number, body: unknown) => Response;
}

const fail = (json: WatchRouteDeps['json'], status: number, code: string, message: string) =>
  json(status, { success: false, error: { code, message } });

const internalUrl = (path: string, search = '') => `https://watch-room.internal${path}${search}`;

export const handleWatchRoomRoute = async (deps: WatchRouteDeps): Promise<Response> => {
  const { request, namespace, json } = deps;
  const url = new URL(request.url);
  const action = url.pathname.replace(/\/+$/, '').split('/').pop() || '';
  const method = request.method.toUpperCase();
  if (!namespace || typeof namespace.idFromName !== 'function') {
    return fail(json, 503, 'WATCH_ROOM_UNAVAILABLE', 'Worker 上还没有接好 INSTANT_TICK（Durable Object），放映室开不了。去设置里再点一次「更新 Worker」。');
  }
  const stubFor = (code: string) => namespace.get(namespace.idFromName(`${WATCH_ROOM_INSTANCE_PREFIX}${code}`));

  if (action === 'create') {
    if (method !== 'POST') return fail(json, 405, 'METHOD_NOT_ALLOWED', '/watch-room/create 只接受 POST');
    if (!(await deps.checkClientToken(request))) return fail(json, 401, 'INVALID_CLIENT_TOKEN', '共享密钥无效或缺失');
    // 码撞上已有房间的概率极低（31^6），撞了就换一个再试。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateWatchCode();
      const secret = generateWatchSecret();
      const res = await stubFor(code).fetch(new Request(internalUrl('/init'), {
        method: 'POST', body: JSON.stringify({ secret }),
      }));
      if (res.status === 200) {
        return json(200, { success: true, data: { code, secret, pairOpenUntil: Date.now() + WATCH_PAIR_WINDOW_MS } });
      }
      if (res.status !== 409) return fail(json, 500, 'WATCH_ROOM_CREATE_FAILED', `建放映室失败（HTTP ${res.status}）`);
    }
    return fail(json, 500, 'WATCH_ROOM_CREATE_FAILED', '连续五次配对码都撞了，稍后再试');
  }

  if (action === 'pair') {
    if (method !== 'POST') return fail(json, 405, 'METHOD_NOT_ALLOWED', '/watch-room/pair 只接受 POST');
    let body: any = null;
    try { body = await request.json(); } catch { /* 下面按缺参处理 */ }
    const code = normalizeWatchCode(body?.code);
    if (!code) return fail(json, 400, 'BAD_CODE', '配对码是 6 位字母和数字');
    const res = await stubFor(code).fetch(new Request(internalUrl('/pair'), { method: 'POST' }));
    const data: any = await res.json().catch(() => null);
    if (res.status === 200 && data?.secret) return json(200, { success: true, data: { code, secret: data.secret } });
    if (res.status === 404) return fail(json, 404, 'ROOM_NOT_FOUND', '没有这个配对码。看看手机上的码有没有敲错');
    return fail(json, 410, 'PAIR_CLOSED', '这个配对码已经用过或者过期了（10 分钟）。在手机上重新点一次「配对电脑」');
  }

  if (action === 'ws' || action === 'report') {
    const params = action === 'ws' ? url.searchParams : null;
    let code: string | null;
    let secret: unknown;
    let forward: Request;
    if (action === 'ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return fail(json, 426, 'UPGRADE_REQUIRED', '这个地址要用 WebSocket 连');
      }
      code = normalizeWatchCode(params!.get('room'));
      secret = params!.get('secret');
      const role = parseWatchRole(params!.get('role'));
      if (!code || typeof secret !== 'string' || !role) return fail(json, 400, 'BAD_PARAMS', 'room / secret / role 缺一不可');
      forward = new Request(internalUrl('/ws', `?secret=${encodeURIComponent(secret)}&role=${role}`), request);
    } else {
      if (method !== 'POST') return fail(json, 405, 'METHOD_NOT_ALLOWED', '/watch-room/report 只接受 POST');
      const text = await request.text();
      if (text.length > WATCH_MAX_MESSAGE_CHARS) return fail(json, 413, 'TOO_LARGE', '消息太大');
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* 下面按缺参处理 */ }
      code = normalizeWatchCode(body?.room);
      secret = body?.secret;
      if (!code || typeof secret !== 'string' || !body?.payload || typeof body.payload !== 'object') {
        return fail(json, 400, 'BAD_PARAMS', 'room / secret / payload 缺一不可');
      }
      forward = new Request(internalUrl('/report'), { method: 'POST', body: JSON.stringify({ secret, payload: body.payload }) });
    }
    const res = await stubFor(code).fetch(forward);
    if (res.status === 101) return res;
    if (res.status === 200) return json(200, { success: true });
    if (res.status === 403) return fail(json, 403, 'BAD_SECRET', '房间密钥对不上。重新配对一次');
    if (res.status === 404) return fail(json, 404, 'ROOM_NOT_FOUND', '放映室不存在了。重新配对一次');
    return fail(json, res.status, 'WATCH_ROOM_ERROR', `放映室出错（HTTP ${res.status}）`);
  }

  return fail(json, 404, 'NOT_FOUND', '没有这个放映室接口');
};

// ─── DO 这一侧：一间放映室 = 一个实例 ───

/** 运行时自带的 WebSocketPair，这里只声明用到的形状。 */
declare const WebSocketPair: { new(): { 0: WebSocket; 1: WebSocket } };

interface HibernatableState extends DurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  getTags(ws: WebSocket): string[];
}

const sendSafe = (ws: WebSocket, text: string) => {
  try { ws.send(text); } catch { /* 对面刚好断开 */ }
};

/** 两边各有几个连接。关闭回调里那条连接可能还在列表里，用 except 排掉。 */
const presence = (ctx: HibernatableState, except?: WebSocket) => JSON.stringify({
  type: 'presence',
  phone: ctx.getWebSockets('phone').filter(ws => ws !== except).length,
  screen: ctx.getWebSockets('screen').filter(ws => ws !== except).length,
  at: Date.now(),
});

const broadcast = (ctx: HibernatableState, text: string, except?: WebSocket) => {
  for (const ws of ctx.getWebSockets()) if (ws !== except) sendSafe(ws, text);
};

export const handleWatchRoomDoFetch = async (state: DurableObjectState, request: Request): Promise<Response> => {
  const ctx = state as HibernatableState;
  const url = new URL(request.url);
  const room = await ctx.storage.get<WatchRoomRecord>(ROOM_KEY);

  if (url.pathname === '/init') {
    if (room) return new Response('exists', { status: 409 });
    const { secret } = await request.json() as { secret: string };
    const now = Date.now();
    await ctx.storage.put(ROOM_KEY, { secret, createdAt: now, pairOpenUntil: now + WATCH_PAIR_WINDOW_MS } satisfies WatchRoomRecord);
    return new Response('ok');
  }

  if (!room) return new Response('not found', { status: 404 });

  if (url.pathname === '/pair') {
    if (room.pairedAt || Date.now() > room.pairOpenUntil) return new Response('closed', { status: 410 });
    await ctx.storage.put(ROOM_KEY, { ...room, pairedAt: Date.now(), pairOpenUntil: 0 });
    return Response.json({ secret: room.secret });
  }

  if (url.pathname === '/report') {
    const { secret, payload } = await request.json() as { secret: string; payload: Record<string, unknown> };
    if (!safeEqual(secret, room.secret)) return new Response('bad secret', { status: 403 });
    const message = { ...payload, type: 'player', at: Date.now() };
    await ctx.storage.put(PLAYER_KEY, message);
    broadcast(ctx, JSON.stringify(message));
    return new Response('ok');
  }

  if (url.pathname === '/ws') {
    const secret = url.searchParams.get('secret') || '';
    const role = parseWatchRole(url.searchParams.get('role'));
    if (!role) return new Response('bad role', { status: 400 });
    if (!safeEqual(secret, room.secret)) return new Response('bad secret', { status: 403 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    ctx.acceptWebSocket(server, [role]);
    const lastPlayer = await ctx.storage.get(PLAYER_KEY);
    if (lastPlayer) sendSafe(server, JSON.stringify(lastPlayer));
    broadcast(ctx, presence(ctx));
    return new Response(null, { status: 101, webSocket: client } as ResponseInit);
  }

  return new Response('not found', { status: 404 });
};

/**
 * 收到一条消息：ping 就地回 pong，其余原样转给**另一种角色**的所有连接
 * （手机发的给电脑，电脑发的给手机）。只加一个 from 字段，不改内容。
 */
export const handleWatchRoomDoMessage = (state: DurableObjectState, ws: WebSocket, message: string | ArrayBuffer): void => {
  const ctx = state as HibernatableState;
  if (typeof message !== 'string' || message.length > WATCH_MAX_MESSAGE_CHARS) return;
  let parsed: any;
  try { parsed = JSON.parse(message); } catch { return; }
  if (!parsed || typeof parsed !== 'object') return;
  if (parsed.type === 'ping') { sendSafe(ws, JSON.stringify({ type: 'pong', at: Date.now() })); return; }
  const from = parseWatchRole(ctx.getTags(ws)[0]);
  if (!from) return;
  const to: WatchRole = from === 'phone' ? 'screen' : 'phone';
  const text = JSON.stringify({ ...parsed, from });
  for (const peer of ctx.getWebSockets(to)) sendSafe(peer, text);
};

export const handleWatchRoomDoClose = (state: DurableObjectState, ws: WebSocket): void => {
  const ctx = state as HibernatableState;
  try { ws.close(1000, 'bye'); } catch { /* 已经关了 */ }
  const text = presence(ctx, ws);
  for (const peer of ctx.getWebSockets()) if (peer !== ws) sendSafe(peer, text);
};
