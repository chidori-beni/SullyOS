import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 油猴小插件（public/watch/sully-cinema.user.js）在假的视频网页里跑一遍：
// 拿配对信息、找到 video、暂停 / 播放 / 拖进度时往 /watch-room/report 报。

const SCRIPT = readFileSync(path.resolve(__dirname, '../../public/watch/sully-cinema.user.js'), 'utf8');

/** 一个够用的假网页：只有小插件用到的那几样。 */
class FakeVideo {
    duration: number; currentTime = 0; paused = true; ended = false;
    private listeners = new Map<string, Set<(e: { type: string }) => void>>();
    rect = { width: 1280, height: 720 };
    constructor(duration: number) { this.duration = duration; }
    addEventListener(t: string, fn: any) { if (!this.listeners.has(t)) this.listeners.set(t, new Set()); this.listeners.get(t)!.add(fn); }
    removeEventListener(t: string, fn: any) { this.listeners.get(t)?.delete(fn); }
    dispatch(t: string) { this.listeners.get(t)?.forEach(fn => fn({ type: t })); }
    getBoundingClientRect() { return this.rect; }
}

let videos: FakeVideo[] = [];
let attrs: Record<string, string> = {};
let pageStorage: Record<string, string> = {};
let title = '';

const setup = (url: string, stored: Record<string, unknown> = {}) => {
    const store = new Map<string, unknown>(Object.entries(stored));
    const requests: any[] = [];
    const fakeDocument = {
        get title() { return title; },
        querySelectorAll: () => videos,
        documentElement: {
            setAttribute: (k: string, v: string) => { attrs[k] = v; },
            getAttribute: (k: string) => attrs[k] ?? null,
        },
    };
    const fakeWindow = { localStorage: { getItem: (k: string) => pageStorage[k] ?? null } };
    const sandbox = {
        GM_getValue: (k: string, d: unknown) => (store.has(k) ? store.get(k) : d),
        GM_setValue: (k: string, v: unknown) => { store.set(k, v); },
        GM_xmlhttpRequest: (req: any) => { requests.push({ ...req, body: JSON.parse(req.data) }); },
        unsafeWindow: fakeWindow,
        window: fakeWindow,
        document: fakeDocument,
        location: new URL(url),
    };
    const run = new Function(...Object.keys(sandbox), SCRIPT);
    return { store, requests, start: () => run(...Object.values(sandbox)) };
};

const addVideo = (duration: number) => {
    const v = new FakeVideo(duration);
    videos.push(v);
    return {
        v,
        play: () => { v.paused = false; v.dispatch('play'); },
        pause: () => { v.paused = true; v.dispatch('pause'); },
        seek: (x: number) => { v.currentTime = x; v.dispatch('seeked'); },
    };
};

const PAIR = JSON.stringify({ workerUrl: 'https://w.example/', code: 'ABC234', secret: 's3cret' });

describe('暂停同步小插件', () => {
    beforeEach(() => { vi.useFakeTimers(); videos = []; attrs = {}; pageStorage = {}; title = ''; });
    afterEach(() => { vi.useRealTimers(); });

    it('在观影端页面上把配对信息抄走，并留下「已装好」记号', () => {
        pageStorage['sully-watch-pair'] = PAIR;
        const env = setup('https://chidori-beni.github.io/SullyOS/watch.html');
        env.start();
        expect(env.store.get('sully-watch-pair')).toBe(PAIR);
        expect(attrs['data-sully-userscript']).toBeTruthy();
        expect(attrs['data-sully-userscript-paired']).toBe('1');
    });

    it('观影端解除配对后，小插件也忘掉', () => {
        const env = setup('https://chidori-beni.github.io/SullyOS/watch.html', { 'sully-watch-pair': PAIR });
        env.start();
        expect(env.store.get('sully-watch-pair')).toBeNull();
    });

    it('B站上：找到视频就报一次，暂停马上报，带着进度、标题和平台', () => {
        title = '钟表馆事件 第2集_番剧_bilibili_哔哩哔哩';
        const video = addVideo(1440);
        const env = setup('https://www.bilibili.com/bangumi/play/ep123', { 'sully-watch-pair': PAIR });
        env.start();
        vi.advanceTimersByTime(2000);
        expect(env.requests).toHaveLength(1);
        expect(env.requests[0].url).toBe('https://w.example/watch-room/report');
        expect(env.requests[0].body).toMatchObject({ room: 'ABC234', secret: 's3cret' });
        expect(env.requests[0].body.payload).toMatchObject({ site: 'B站', title: '钟表馆事件 第2集_番剧', duration: 1440, paused: true, event: 'found' });

        video.play();
        vi.advanceTimersByTime(2000);
        video.seek(600);
        video.pause();
        vi.advanceTimersByTime(2000);
        const last = env.requests[env.requests.length - 1].body.payload;
        expect(last).toMatchObject({ paused: true, time: 600 });
    });

    it('播放中每 15 秒报一次心跳', () => {
        const video = addVideo(1440);
        const env = setup('https://v.qq.com/x/cover/abc.html', { 'sully-watch-pair': PAIR });
        env.start();
        video.play();
        vi.advanceTimersByTime(2000);
        const before = env.requests.length;
        vi.advanceTimersByTime(31_000);
        expect(env.requests.length - before).toBeGreaterThanOrEqual(2);
        expect(env.requests[env.requests.length - 1].body.payload).toMatchObject({ site: '腾讯视频', event: 'tick', paused: false });
    });

    it('拖进度条连着触发好几次，只报一次', () => {
        const video = addVideo(1440);
        const env = setup('https://www.iqiyi.com/v_x.html', { 'sully-watch-pair': PAIR });
        env.start();
        vi.advanceTimersByTime(2000);
        const before = env.requests.length;
        video.seek(10); video.seek(20); video.seek(30);
        vi.advanceTimersByTime(2000);
        expect(env.requests.length - before).toBe(1);
        expect(env.requests[env.requests.length - 1].body.payload.time).toBe(30);
    });

    it('广告小窗和正片同时在：挑时长长的正片', () => {
        const ad = addVideo(15);
        ad.v.rect = { width: 400, height: 225 };
        addVideo(2700);
        const env = setup('https://v.youku.com/v_show/id_x.html', { 'sully-watch-pair': PAIR });
        env.start();
        vi.advanceTimersByTime(2000);
        expect(env.requests[0].body.payload.duration).toBe(2700);
    });

    it('还没配对就什么都不发', () => {
        addVideo(1440);
        const env = setup('https://www.bilibili.com/video/BV1xx');
        env.start();
        vi.advanceTimersByTime(20_000);
        expect(env.requests).toHaveLength(0);
    });
});
