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
/** 假网页上 B站 字幕元素：选择器 → 元素（只要 textContent） */
let subtitleEls: Record<string, { textContent: string }[]> = {};
/** 假网页上的「所有元素」（'*'），用来放 shadow root 的宿主 / 侦探要翻的元素 */
let allEls: any[] = [];

/** tab：模拟同一个浏览器里的另一个标签页——油猴存储共用（store），网页里的 video 各是各的（videos） */
const setup = (url: string, stored: Record<string, unknown> = {}, tab?: { store: Map<string, unknown>; videos: FakeVideo[] }) => {
    const store = tab?.store ?? new Map<string, unknown>(Object.entries(stored));
    const requests: any[] = [];
    const fakeDocument = {
        get title() { return title; },
        querySelectorAll: (sel: string) => (sel === 'video' ? (tab?.videos ?? videos) : sel === '*' ? allEls : (subtitleEls[sel] || [])),
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
    beforeEach(() => { vi.useFakeTimers(); videos = []; attrs = {}; pageStorage = {}; title = ''; subtitleEls = {}; allEls = []; });
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

    it('同时开着两个视频：只有在放的那个报，暂停着的那个不许盖掉进度（09-30 实测）', () => {
        const shared = new Map<string, unknown>([['sully-watch-pair', PAIR]]);
        const tabA = { store: shared, videos: [new FakeVideo(1440)] };
        const tabB = { store: shared, videos: [new FakeVideo(2000)] };
        const a = setup('https://www.bilibili.com/video/BVa', {}, tabA);
        const b = setup('https://www.bilibili.com/video/BVb', {}, tabB);
        a.start();
        b.start();
        vi.advanceTimersByTime(2000);

        // B 先放了一下又暂停，然后 A 开始放
        const vb = tabB.videos[0];
        vb.paused = false; vb.dispatch('play');
        vi.advanceTimersByTime(2000);
        vb.paused = true; vb.currentTime = 50; vb.dispatch('pause');
        vi.advanceTimersByTime(2000);
        const va = tabA.videos[0];
        va.paused = false; va.currentTime = 300; va.dispatch('play');
        vi.advanceTimersByTime(2000);

        const bBefore = b.requests.length;
        // 之后十分钟：A 一直在放，B 一直暂停着
        for (let i = 0; i < 120; i += 1) { va.currentTime += 5; vi.advanceTimersByTime(5000); }
        expect(b.requests.length).toBe(bBefore); // B 一声不吭
        const lastA = a.requests[a.requests.length - 1].body.payload;
        expect(lastA).toMatchObject({ paused: false, event: 'tick' });
        expect(lastA.time).toBeGreaterThan(300);
    });

    it('在当班的标签页暂停后，去另一个标签页按播放，就换那个当班', () => {
        const shared = new Map<string, unknown>([['sully-watch-pair', PAIR]]);
        const tabA = { store: shared, videos: [new FakeVideo(1440)] };
        const tabB = { store: shared, videos: [new FakeVideo(2000)] };
        const a = setup('https://www.bilibili.com/video/BVa', {}, tabA);
        const b = setup('https://www.bilibili.com/video/BVb', {}, tabB);
        a.start(); b.start();
        const va = tabA.videos[0];
        const vb = tabB.videos[0];
        va.paused = false; va.dispatch('play');
        vi.advanceTimersByTime(2000);
        va.paused = true; va.dispatch('pause');
        vi.advanceTimersByTime(2000);
        const aBefore = a.requests.length;
        vb.paused = false; vb.currentTime = 90; vb.dispatch('play');
        vi.advanceTimersByTime(2000);
        expect(b.requests[b.requests.length - 1].body.payload).toMatchObject({ event: 'play', time: 90 });
        vi.advanceTimersByTime(5 * 60_000);
        expect(a.requests.length).toBe(aBefore); // A 暂停着、已经不当班，不再报心跳
    });

    it('B站 开着字幕：新出现的句子攒起来，随下一次进度一起带走；同一句不重复记', () => {
        const video = addVideo(1440);
        const env = setup('https://www.bilibili.com/video/BVsub', { 'sully-watch-pair': PAIR });
        env.start();
        video.play();
        vi.advanceTimersByTime(2000);
        const before = env.requests.length;
        const panel = { textContent: '' };
        subtitleEls['.bpx-player-subtitle-panel-text'] = [panel];
        panel.textContent = '你到底是谁'; video.v.currentTime = 100; vi.advanceTimersByTime(1000);
        vi.advanceTimersByTime(1000); // 同一句还在屏幕上，不重复记
        panel.textContent = '  我是  钟表馆的主人 '; video.v.currentTime = 103; vi.advanceTimersByTime(1000);
        vi.advanceTimersByTime(15_000);
        const reports = env.requests.slice(before).map(r => r.body.payload);
        const withSubs = reports.find(p => p.subtitles);
        expect(withSubs.subtitles).toEqual([{ time: 100, text: '你到底是谁' }, { time: 103, text: '我是 钟表馆的主人' }]);
        expect(withSubs.subtitle).toBe('我是 钟表馆的主人');
        // 带走以后就清空，下一次心跳不再重复带
        vi.advanceTimersByTime(15_000);
        expect(env.requests[env.requests.length - 1].body.payload.subtitles).toBeUndefined();
    });

    it('AI 字幕旁边的「AI」角标不算台词；双语字幕只读主字幕', () => {
        const video = addVideo(1440);
        subtitleEls['.bili-subtitle-x-subtitle-panel-text'] = [{
            textContent: 'AI你好呀',
            childNodes: [
                { nodeType: 1, className: 'bili-subtitle-x-ai-badge', textContent: 'AI', childNodes: [] },
                { nodeType: 3, textContent: '你好呀' },
            ],
        } as any];
        const env = setup('https://www.bilibili.com/video/BVai', { 'sully-watch-pair': PAIR });
        env.start();
        video.play();
        vi.advanceTimersByTime(20_000);
        const withSub = env.requests.map(r => r.body.payload).find(p => p.subtitle);
        expect(withSub.subtitle).toBe('你好呀');

        subtitleEls['.bpx-player-subtitle-panel-major-group .bpx-player-subtitle-panel-text'] = [{ textContent: '我回来了' }];
        subtitleEls['.bpx-player-subtitle-panel-text'] = [{ textContent: '我回来了' }, { textContent: "I'm back" }];
        vi.advanceTimersByTime(20_000);
        expect(env.requests[env.requests.length - 1].body.payload.subtitle).toBe('我回来了');
    });

    it('字幕封在 shadow root（密封盒子）里也能读到（09-30 实测日剧 AI 字幕读不到）', () => {
        const video = addVideo(1440);
        const inside: Record<string, any[]> = { '.bili-subtitle-x-subtitle-panel-text': [{ textContent: 'お前は誰だ' }] };
        allEls = [{ tagName: 'BILI-SUBTITLE-X', className: '', shadowRoot: { querySelectorAll: (sel: string) => (sel === '*' ? [] : inside[sel] || []) } }];
        const env = setup('https://www.bilibili.com/video/BVshadow', { 'sully-watch-pair': PAIR });
        env.start();
        video.play();
        vi.advanceTimersByTime(20_000);
        expect(env.requests.map(r => r.body.payload).find(p => p.subtitle)?.subtitle).toBe('お前は誰だ');
    });

    it('在放却一直读不到字幕：20 秒后当一次侦探，把带 subtitle 的元素列出来报上去', () => {
        const video = addVideo(1440);
        allEls = [
            { tagName: 'DIV', className: 'bpx-player-subtitle-wrap', textContent: '' },
            { tagName: 'SPAN', className: 'some-new-subtitle-line', textContent: '字幕在这里' },
            { tagName: 'DIV', className: 'unrelated', textContent: 'x' },
        ];
        const env = setup('https://www.bilibili.com/video/BVprobe', { 'sully-watch-pair': PAIR });
        env.start();
        video.play();
        vi.advanceTimersByTime(40_000);
        const probe = env.requests.map(r => r.body.payload).find(p => p.subtitleProbe)?.subtitleProbe;
        expect(probe).toContain('div.bpx-player-subtitle-wrap');
        expect(probe).toContain('span.some-new-subtitle-line「字幕在这里」');
        expect(probe).not.toContain('unrelated');
        // 报过一次就不再带，直到下一轮侦探（一分钟最多一次）
        vi.advanceTimersByTime(20_000);
        expect(env.requests[env.requests.length - 1].body.payload.subtitleProbe).toBeUndefined();
    });

    it('别的平台不读字幕', () => {
        const video = addVideo(1440);
        subtitleEls['.bpx-player-subtitle-panel-text'] = [{ textContent: '不该读到' }];
        const env = setup('https://v.qq.com/x/cover/abc.html', { 'sully-watch-pair': PAIR });
        env.start();
        video.play();
        vi.advanceTimersByTime(20_000);
        expect(env.requests.some(r => r.body.payload.subtitle || r.body.payload.subtitles)).toBe(false);
    });
});
