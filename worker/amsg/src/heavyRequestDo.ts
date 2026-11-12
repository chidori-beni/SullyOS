/**
 * 把「大包」请求从 Worker 本体转进 Durable Object 里处理。
 *
 * 为什么（2026-11-12 用户日志实锤）：Cloudflare 免费计划给 Worker 的每个 HTTP 请求只有
 * **10ms CPU**。`PUT /client-state` 带着整份 fire_pack（用户那份约 500KB）：解外层加密、
 * 解析 JSON、按用户密钥重新加密、切片落库，全是实打实的 CPU 活，稳定超限 →
 * 平台直接掐掉，回一张不带 CORS 头的错误页（1102），前端只看到一句 "Load failed"，
 * 云端 fire_pack 永远停在上一份。Observability 里每条都是
 * 「Worker exceeded CPU time limit.」。`/instant-chat` 第一步做的是同一套活（带着同一份
 * statePayload 转发进上游的 /client-state），包一大同样会被掐。
 *
 * Durable Object 的请求不吃这 10ms（定时任务当初就是为同一个原因搬进 InstantTickDO 的，
 * 见 index.ts 的 scheduled）。所以 Worker 本体这两条路由只做一件事：把原请求**原样**
 * （body 是流，Worker 不读它，几乎不花 CPU）交给 DO，DO 里再走一遍同一个入口。
 *
 * 防套娃：转发时加 FORWARDED_HEADER，入口见到它就不再转、就地处理。客户端自己带这个头
 * 只会让请求留在 Worker 本体里跑（等于没修之前），绕不过任何鉴权——上游照常验身份。
 *
 * 复用 INSTANT_TICK 这个类而不是新开一个，是为了不碰 DO migration（同 watchRoom.ts）。
 * 实例名带 `heavy:` 前缀，跟即时任务（uuid）、放映室（`watch:`）、cron singleton 都不撞。
 */

export const HEAVY_FORWARDED_HEADER = 'X-Sully-Heavy-Forwarded';

interface HeavyStub {
  fetch?: (request: Request) => Promise<Response>;
}

export interface HeavyNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): HeavyStub | unknown;
}

/** 这条请求该不该挪进 DO：只挑会带整份 fire_pack 的两条写入路由。 */
export const isHeavyRoute = (pathname: string, method: string): boolean =>
  (method === 'PUT' && pathname.endsWith('/client-state'))
  || (method === 'POST' && pathname.endsWith('/instant-chat'));

export const isForwardedHeavyRequest = (request: Request): boolean =>
  request.headers.get(HEAVY_FORWARDED_HEADER) === '1';

/**
 * 能转就返回 DO 实例的 fetch，不能转（老部署没绑 DO、测试替身没有 fetch）返回 null，
 * 调用方就地处理——跟没修之前一模一样，不会更坏。
 */
const resolveHeavyStub = (namespace: unknown, request: Request): ((req: Request) => Promise<Response>) | null => {
  const ns = namespace as HeavyNamespace | null | undefined;
  if (!ns || typeof ns.idFromName !== 'function' || typeof ns.get !== 'function') return null;
  // 按用户分实例：同一个人的写入排在一处，不同用户（共用一台 Worker 的情形）互不排队。
  const userId = request.headers.get('X-User-Id')?.trim() || 'anon';
  const stub = ns.get(ns.idFromName(`heavy:${userId}`)) as HeavyStub | null | undefined;
  return stub && typeof stub.fetch === 'function' ? stub.fetch.bind(stub) : null;
};

/**
 * 转进 DO。返回 null = 这台部署转不了，调用方就地处理。
 * 转发本身失败（DO 起不来之类）时回一条带 CORS 的 503，让前端拿到原因而不是 "Load failed"。
 */
export const forwardHeavyRequest = async (
  request: Request,
  namespace: unknown,
  json: (status: number, body: unknown) => Response,
): Promise<Response | null> => {
  const doFetch = resolveHeavyStub(namespace, request);
  if (!doFetch) return null;
  const headers = new Headers(request.headers);
  headers.set(HEAVY_FORWARDED_HEADER, '1');
  try {
    return await doFetch(new Request(request, { headers }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[amsg:heavy] 转进 Durable Object 失败', message);
    return json(503, {
      success: false,
      error: { code: 'HEAVY_FORWARD_FAILED', message: `大包请求转交后台处理失败：${message}` },
    });
  }
};
