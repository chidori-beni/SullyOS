import { describe, expect, it } from 'vitest';
import {
    buildCinemaInstruction, cleanCinemaReply, describeStatus, formatVideoTime, isFrameFresh, newCinemaSession,
    normalizeWorkerInput, sessionLinesToApiMessages, watchSocketUrl, workerHostForDisplay,
} from './cinema';

describe('影院 · 小工具', () => {
    it('进度格式', () => {
        expect(formatVideoTime(75)).toBe('1:15');
        expect(formatVideoTime(3723.9)).toBe('1:02:03');
        expect(formatVideoTime(undefined)).toBe('');
        expect(formatVideoTime(NaN)).toBe('');
    });

    it('Worker 地址：子域、主机名、完整地址都认', () => {
        expect(normalizeWorkerInput('cyoutatarou')).toBe('https://sullyos-amsg.cyoutatarou.workers.dev');
        expect(normalizeWorkerInput('sullyos-amsg.cyoutatarou.workers.dev/')).toBe('https://sullyos-amsg.cyoutatarou.workers.dev');
        expect(normalizeWorkerInput(' https://x.example ')).toBe('https://x.example');
        expect(normalizeWorkerInput('')).toBe('');
        expect(workerHostForDisplay('https://sullyos-amsg.cyoutatarou.workers.dev/')).toBe('sullyos-amsg.cyoutatarou.workers.dev');
    });

    it('WebSocket 地址换成 wss 并带齐参数', () => {
        expect(watchSocketUrl('https://w.example/', { code: 'ABC234', secret: 's e' }, 'phone'))
            .toBe('wss://w.example/watch-room/ws?room=ABC234&secret=s%20e&role=phone');
    });

    it('画面超过 45 秒就不算「现在的」', () => {
        const now = 1_000_000;
        expect(isFrameFresh({ dataUrl: 'data:image/jpeg;base64,x', at: now - 10_000, reason: 'scene' }, now)).toBe(true);
        expect(isFrameFresh({ dataUrl: 'data:image/jpeg;base64,x', at: now - 60_000, reason: 'scene' }, now)).toBe(false);
        expect(isFrameFresh(null, now)).toBe(false);
    });

    it('片名留空时给个名字', () => {
        expect(newCinemaSession({ charId: 'c', title: '  ', spoiler: 'first' }).title).toBe('没起名字的片子');
    });
});

describe('影院 · 回复清洗', () => {
    it('去掉思考块和聊天标签，按行拆成气泡', () => {
        const raw = '<think>想想</think>这段好绝\n\n[[SEND_EMOJI:笑]]你看她的眼神\n';
        expect(cleanCinemaReply(raw)).toEqual(['这段好绝', '你看她的眼神']);
    });

    it('空回复返回空数组', () => {
        expect(cleanCinemaReply('<think>x</think>  ')).toEqual([]);
    });
});

describe('影院 · 这一场的对话', () => {
    it('带上进度，连续同一方合并成一条', () => {
        const msgs = sessionLinesToApiMessages([
            { role: 'user', text: '来了来了', at: 1, videoTime: 65 },
            { role: 'user', text: '好紧张', at: 2 },
            { role: 'char', text: '别怕', at: 3 },
            { role: 'char', text: '我在', at: 4 },
        ]);
        expect(msgs).toEqual([
            { role: 'user', content: '（放到 1:05）来了来了\n好紧张' },
            { role: 'assistant', content: '别怕\n我在' },
        ]);
    });
});

describe('影院 · 提示词', () => {
    const base = { userName: '千夜', charName: '萧逸', status: { mode: 'local' as const, time: 600, duration: 1440, at: 0 } };

    it('第一次看：不假装知道后面', () => {
        const text = buildCinemaInstruction({ ...base, session: { title: '芙莉莲', episode: '第3集', spoiler: 'first' }, hasFrame: true });
        expect(text).toContain('《芙莉莲》 第3集');
        expect(text).toContain('第一次看');
        expect(text).toContain('现在放到 10:00 / 24:00');
        expect(text).toContain('此刻屏幕上的画面');
    });

    it('看过：可以讲伏笔，但不剧透当前进度之后', () => {
        const text = buildCinemaInstruction({ ...base, session: { title: '芙莉莲', spoiler: 'seen' }, hasFrame: false });
        expect(text).toContain('绝对不能剧透');
        expect(text).toContain('没有拿到画面');
    });

    it('状态条的人话', () => {
        expect(describeStatus({ mode: 'local', time: 61, duration: 120, paused: true, at: 0 })).toBe('暂停 1:01 / 2:00');
        expect(describeStatus({ mode: 'share', sharing: true, at: 0 })).toBe('电脑正在共享画面');
        expect(describeStatus(null)).toBe('');
    });
});
