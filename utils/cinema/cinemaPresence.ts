/**
 * 「正在和某个角色一起看」的标记。
 *
 * 跟见面的 datePresence、通话的 callSessionLifecycle 一个用途：观影期间别的地方要知道
 * 「这会儿他们在一起看片」——本地主动消息（OSContext 的 runProactive）看到它就静默跳过，
 * 免得角色一边陪你看电影，一边在私聊里说自己在外面散步。
 *
 * 存 localStorage 而不是内存：用户看到一半切去私聊、影院 App 被卸载，标记也得还在。
 * 忘了点「散场」也不会一直挂着：最后一次说话过了 CINEMA_PRESENCE_IDLE_MS 就当作已经散了。
 */

export const CINEMA_PRESENCE_PREFIX = 'sully-cinema-active:';
/** 这么久没人说话就当作散场了（暂停去吃饭、忘了点散场都算）。 */
export const CINEMA_PRESENCE_IDLE_MS = 45 * 60 * 1000;

export interface CinemaPresence {
    sessionId: string;
    title: string;
    episode?: string;
    startedAt: number;
    lastActiveAt: number;
}

const keyOf = (charId: string) => `${CINEMA_PRESENCE_PREFIX}${charId}`;

const read = (charId: string): CinemaPresence | null => {
    try {
        const raw = localStorage.getItem(keyOf(charId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed.sessionId === 'string' ? parsed as CinemaPresence : null;
    } catch {
        return null;
    }
};

const write = (charId: string, value: CinemaPresence) => {
    try { localStorage.setItem(keyOf(charId), JSON.stringify(value)); } catch { /* 存不了就算了，只是少一道拦截 */ }
};

/** 这个角色此刻是不是正在陪你看（过期的当作没有，并顺手清掉）。 */
export const getActiveCinemaPresence = (charId: string, now = Date.now()): CinemaPresence | null => {
    if (!charId) return null;
    const presence = read(charId);
    if (!presence) return null;
    if (now - presence.lastActiveAt > CINEMA_PRESENCE_IDLE_MS) {
        try { localStorage.removeItem(keyOf(charId)); } catch { /* ignore */ }
        return null;
    }
    return presence;
};

/** 进放映室 / 说了一句话：开始或续上标记。换了一场就重新计开场时间。 */
export const touchCinemaPresence = (charId: string, session: { id: string; title: string; episode?: string }, now = Date.now()): void => {
    const prev = read(charId);
    const same = prev && prev.sessionId === session.id && now - prev.lastActiveAt <= CINEMA_PRESENCE_IDLE_MS;
    write(charId, {
        sessionId: session.id,
        title: session.title,
        episode: session.episode,
        startedAt: same ? prev!.startedAt : now,
        lastActiveAt: now,
    });
};

/** 散场。只清同一场的标记，免得误清掉另一场。 */
export const endCinemaPresence = (charId: string, sessionId?: string): void => {
    const prev = read(charId);
    if (!prev) return;
    if (sessionId && prev.sessionId !== sessionId) return;
    try { localStorage.removeItem(keyOf(charId)); } catch { /* ignore */ }
};
