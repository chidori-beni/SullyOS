import { describe, expect, it } from 'vitest';
import {
  WATCH_CODE_ALPHABET, generateWatchCode, handleWatchRoomDoFetch, handleWatchRoomDoMessage, handleWatchRoomRoute,
  normalizeWatchCode, type WatchRoomNamespace,
} from './watchRoom';

/** 一个只在内存里的 DO 世界：每个实例名一份 storage，WebSocket 用假的。 */
const makeWorld = () => {
  const instances = new Map<string, any>();
  const stateFor = (name: string) => {
    if (!instances.has(name)) {
      const data = new Map<string, unknown>();
      const sockets: { ws: any; tags: string[] }[] = [];
      instances.set(name, {
        storage: {
          get: async (k: string) => data.get(k),
          put: async (k: string, v: unknown) => { data.set(k, v); },
          delete: async (k: string) => data.delete(k),
          getAlarm: async () => null,
          setAlarm: async () => {},
        },
        acceptWebSocket: (ws: any, tags: string[]) => sockets.push({ ws, tags }),
        getWebSockets: (tag?: string) => sockets.filter(s => !tag || s.tags.includes(tag)).map(s => s.ws),
        getTags: (ws: any) => sockets.find(s => s.ws === ws)?.tags || [],
        _data: data,
        _sockets: sockets,
      });
    }
    return instances.get(name);
  };
  const namespace: WatchRoomNamespace = {
    idFromName: (name: string) => name,
    get: (id: unknown) => ({ fetch: (req: Request) => handleWatchRoomDoFetch(stateFor(String(id)), req) }),
  };
  return { namespace, stateFor, instances };
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const call = (world: ReturnType<typeof makeWorld>, path: string, init: RequestInit = {}, tokenOk = true) =>
  handleWatchRoomRoute({
    request: new Request(`https://w.example${path}`, init),
    namespace: world.namespace,
    checkClientToken: async () => tokenOk,
    json,
  });

describe('配对码', () => {
  it('只用好认的字符，长度 6', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = generateWatchCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(WATCH_CODE_ALPHABET).toContain(ch);
    }
  });

  it('手敲的码去空格、横杠，转大写', () => {
    expect(normalizeWatchCode(' abc-23x ')).toBe('ABC23X');
    expect(normalizeWatchCode('ABC 23X')).toBe('ABC23X');
  });

  it('容易看错的字符和长度不对都不认', () => {
    expect(normalizeWatchCode('ABC230')).toBeNull(); // 0 不在字符集
    expect(normalizeWatchCode('ABCDE')).toBeNull();
    expect(normalizeWatchCode(123456)).toBeNull();
  });
});

describe('放映室路由', () => {
  it('建房间要过共享密钥', async () => {
    const world = makeWorld();
    const res = await call(world, '/watch-room/create', { method: 'POST' }, false);
    expect(res.status).toBe(401);
  });

  it('建房间 → 电脑配对拿到同一把密钥 → 码只能用一次', async () => {
    const world = makeWorld();
    const created: any = await (await call(world, '/watch-room/create', { method: 'POST' })).json();
    expect(created.success).toBe(true);
    const { code, secret } = created.data;

    const paired: any = await (await call(world, '/watch-room/pair', { method: 'POST', body: JSON.stringify({ code: code.toLowerCase() }) })).json();
    expect(paired.data).toEqual({ code, secret });

    const again = await call(world, '/watch-room/pair', { method: 'POST', body: JSON.stringify({ code }) });
    expect(again.status).toBe(410);
  });

  it('配对窗口过了就不能配', async () => {
    const world = makeWorld();
    const created: any = await (await call(world, '/watch-room/create', { method: 'POST' })).json();
    const state = world.stateFor(`watch:${created.data.code}`);
    const room: any = state._data.get('watchRoom');
    state._data.set('watchRoom', { ...room, pairOpenUntil: Date.now() - 1 });
    const res = await call(world, '/watch-room/pair', { method: 'POST', body: JSON.stringify({ code: created.data.code }) });
    expect(res.status).toBe(410);
  });

  it('不存在的码回 404，而不是凭空建一间', async () => {
    const world = makeWorld();
    const res = await call(world, '/watch-room/pair', { method: 'POST', body: JSON.stringify({ code: 'ABCDEF' }) });
    expect(res.status).toBe(404);
    expect(world.stateFor('watch:ABCDEF')._data.size).toBe(0);
  });

  it('油猴报进度：密钥对才收，并记下最后一次状态', async () => {
    const world = makeWorld();
    const created: any = await (await call(world, '/watch-room/create', { method: 'POST' })).json();
    const { code, secret } = created.data;
    const bad = await call(world, '/watch-room/report', { method: 'POST', body: JSON.stringify({ room: code, secret: 'x'.repeat(48), payload: { time: 1 } }) });
    expect(bad.status).toBe(403);
    const ok = await call(world, '/watch-room/report', { method: 'POST', body: JSON.stringify({ room: code, secret, payload: { time: 42, paused: true } }) });
    expect(ok.status).toBe(200);
    expect(world.stateFor(`watch:${code}`)._data.get('watchPlayer')).toMatchObject({ type: 'player', time: 42, paused: true });
  });

  it('WebSocket 地址不是升级请求时直接拒掉', async () => {
    const world = makeWorld();
    const res = await call(world, '/watch-room/ws?room=ABCDEF&secret=x&role=phone');
    expect(res.status).toBe(426);
  });

  it('没接好 Durable Object 时说清楚要去更新 Worker', async () => {
    const res = await handleWatchRoomRoute({
      request: new Request('https://w.example/watch-room/create', { method: 'POST' }),
      namespace: undefined, checkClientToken: async () => true, json,
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as any).error.message).toContain('更新 Worker');
  });
});

describe('放映室转发', () => {
  it('手机发的只转给电脑，电脑发的只转给手机；ping 就地回 pong', () => {
    const world = makeWorld();
    const state = world.stateFor('watch:ROOM22');
    const got: Record<string, string[]> = { phone: [], screen: [] };
    const phone = { send: (t: string) => got.phone.push(t) };
    const screen = { send: (t: string) => got.screen.push(t) };
    state.acceptWebSocket(phone, ['phone']);
    state.acceptWebSocket(screen, ['screen']);

    handleWatchRoomDoMessage(state, phone as any, JSON.stringify({ type: 'capture-request', requestId: 'r1' }));
    expect(got.screen.map(t => JSON.parse(t))).toEqual([{ type: 'capture-request', requestId: 'r1', from: 'phone' }]);
    expect(got.phone).toEqual([]);

    handleWatchRoomDoMessage(state, screen as any, JSON.stringify({ type: 'frame', dataUrl: 'data:image/jpeg;base64,xx' }));
    expect(JSON.parse(got.phone[0])).toMatchObject({ type: 'frame', from: 'screen' });

    handleWatchRoomDoMessage(state, phone as any, JSON.stringify({ type: 'ping' }));
    expect(JSON.parse(got.phone[1]).type).toBe('pong');
  });

  it('不是 JSON 的消息直接丢掉', () => {
    const world = makeWorld();
    const state = world.stateFor('watch:ROOM33');
    const screen = { send: () => { throw new Error('不该收到'); } };
    const phone = { send: () => {} };
    state.acceptWebSocket(phone, ['phone']);
    state.acceptWebSocket(screen, ['screen']);
    expect(() => handleWatchRoomDoMessage(state, phone as any, 'not json')).not.toThrow();
  });
});
