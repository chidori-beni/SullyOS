import { describe, expect, it } from 'vitest';
import {
    estimateVideoTime, pickSubtitleWindow, sanitizeExternalSubtitles,
    appendSubtitleLines, CINEMA_SUBTITLES_KEEP,
    splitCinemaActions, toCinemaLines, cinemaLineText,
    isPlayerFresh, mergeCinemaStatus, PLAYER_STALE_MS,
    buildCinemaEndCardText, cinemaMessageMetadata,
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

    it('漏出来的心声 JSON 整段删掉（不管黏在句尾还是单独一行）', () => {
        const leaked = ['看得到 画面连上了', '进门撑伞这个跑这么急', '{"t":"xinsheng","music":"Midnight City","bank":"CNY"}'].join('\n');
        expect(cleanCinemaReply(leaked)).toEqual(['看得到 画面连上了', '进门撑伞这个跑这么急']);
        expect(cleanCinemaReply('好看{"t": "xinsheng", "innerVoice": "想' + '\n' + '靠近"}')).toEqual(['好看']);
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

describe('影院 · 存进私聊', () => {
    it('每句话挂上来源、这一场的 id 和片名', () => {
        expect(cinemaMessageMetadata({ id: 's1', title: '钟表馆事件', episode: '第2集' }, 83.6)).toEqual({
            source: 'cinema', cinemaSessionId: 's1', cinemaTitle: '钟表馆事件', cinemaEpisode: '第2集', cinemaVideoTime: 83,
        });
        expect(cinemaMessageMetadata({ id: 's1', title: 'x' })).toEqual({ source: 'cinema', cinemaSessionId: 's1', cinemaTitle: 'x' });
    });

    it('散场卡写清楚看了什么、看到哪、聊了几句', () => {
        const text = buildCinemaEndCardText({
            title: '钟表馆事件', episode: '第2集', lastVideoTime: 1390,
            lines: [{ role: 'user', text: 'a', at: 1 }, { role: 'char', text: 'b', at: 2 }, { role: 'user', text: 'c', at: 3 }],
        }, '萧逸');
        expect(text).toBe('一起看结束 · 萧逸｜《钟表馆事件》 第2集｜看到 23:10｜聊了2句');
    });
});

describe('影院 · 小插件的进度', () => {
    const now = 10_000_000;
    const share = { mode: 'share' as const, sharing: true, at: now };
    const player = { mode: 'site' as const, site: 'B站', title: '钟表馆事件 第2集', time: 600, duration: 1440, paused: true, at: now - 5000 };

    it('小插件在报就用它的进度和暂停', () => {
        expect(mergeCinemaStatus(share, player, now)).toMatchObject({ mode: 'site', site: 'B站', time: 600, paused: true });
    });

    it('播放中 45 秒没报就当它不在了，退回观影端', () => {
        const playing = { ...player, paused: false, at: now - PLAYER_STALE_MS - 1 };
        expect(isPlayerFresh(playing, now)).toBe(false);
        expect(mergeCinemaStatus(share, playing, now)).toBe(share);
    });

    it('暂停中可以留久一点', () => {
        expect(isPlayerFresh({ ...player, at: now - 10 * 60_000 }, now)).toBe(true);
    });

    it('本地片在观影端里放时，观影端自己的进度优先', () => {
        const local = { mode: 'local' as const, time: 30, at: now };
        expect(mergeCinemaStatus(local, player, now)).toBe(local);
    });

    it('状态条和提示词都写上平台、暂停和标题', () => {
        expect(describeStatus({ ...player })).toBe('B站 · ⏸ 暂停 10:00 / 24:00');
        const text = buildCinemaInstruction({ userName: '千夜', charName: '萧逸', session: { title: '钟表馆事件', spoiler: 'first' }, status: player, hasFrame: false });
        expect(text).toContain('（暂停中）');
        expect(text).toContain('播放页标题是「钟表馆事件 第2集」');
    });
});

describe('影院 · 线上 / 线下', () => {
    const base = { userName: '千夜', charName: '萧逸', status: null, hasFrame: false };

    it('开场时记下线上还是线下，线下才挂见面', () => {
        expect(newCinemaSession({ charId: 'c', title: 'x', spoiler: 'first' }).meet).toBe('online');
        expect(newCinemaSession({ charId: 'c', title: 'x', spoiler: 'first', dateEncounterId: 'e1' }).dateEncounterId).toBeUndefined();
        const off = newCinemaSession({ charId: 'c', title: 'x', spoiler: 'first', meet: 'offline', dateEncounterId: 'e1' });
        expect(off).toMatchObject({ meet: 'offline', dateEncounterId: 'e1' });
    });

    it('线上：告诉角色不在一起，不要动作', () => {
        const text = buildCinemaInstruction({ ...base, session: { title: '钟表馆事件', spoiler: 'first', meet: 'online' } });
        expect(text).toContain('**不在一起**');
        expect(text).toContain('不要写动作描写');
    });

    it('旧记录没有 meet 字段，按线上算', () => {
        const text = buildCinemaInstruction({ ...base, session: { title: '钟表馆事件', spoiler: 'first' } });
        expect(text).toContain('**不在一起**');
    });

    it('线下：并肩坐着，可以有很轻的小动作，接着见面的场景', () => {
        const text = buildCinemaInstruction({ ...base, session: { title: '钟表馆事件', spoiler: 'first', meet: 'offline' } });
        expect(text).toContain('**并肩坐在一起**');
        expect(text).toContain('不要换地方');
        expect(text).toContain('（往你那边靠了靠）');
        expect(text).not.toContain('不要写动作描写');
    });

    it('线下的话存进私聊时带上见面，散场卡写「面对面」', () => {
        const session = { id: 's1', title: '钟表馆事件', meet: 'offline' as const, dateEncounterId: 'e1' };
        expect(cinemaMessageMetadata(session)).toMatchObject({ cinemaMeet: 'offline', dateEncounterId: 'e1' });
        expect(cinemaMessageMetadata({ id: 's1', title: 'x', meet: 'online' as const, dateEncounterId: 'e1' })).not.toHaveProperty('dateEncounterId');
        expect(buildCinemaEndCardText({ ...session, lines: [] }, '萧逸')).toBe('一起看结束（面对面） · 萧逸｜《钟表馆事件》｜聊了0句');
    });
});

describe('影院 · 小动作变旁白', () => {
    it('开头 / 结尾的括号拆出来，说的话留在气泡里', () => {
        expect(splitCinemaActions('（往你那边靠了靠）这段好吓人')).toEqual([
            { kind: 'action', text: '往你那边靠了靠' }, { kind: 'speech', text: '这段好吓人' },
        ]);
        expect(splitCinemaActions('哈哈哈(笑出声)')).toEqual([
            { kind: 'speech', text: '哈哈哈' }, { kind: 'action', text: '笑出声' },
        ]);
    });

    it('整行都是动作就只有旁白', () => {
        expect(splitCinemaActions('（轻轻握住你的手）')).toEqual([{ kind: 'action', text: '轻轻握住你的手' }]);
    });

    it('句子中间的括号算说的话', () => {
        expect(splitCinemaActions('那个人（穿黑衣服的）好可疑')).toEqual([{ kind: 'speech', text: '那个人（穿黑衣服的）好可疑' }]);
    });

    it('一轮几行拆成几条记录，旁白带标记；存进私聊时补回括号', () => {
        const lines = toCinemaLines('char', ['（靠过来）', '别怕'], 100);
        expect(lines).toEqual([
            { role: 'char', text: '靠过来', at: 100, kind: 'action' },
            { role: 'char', text: '别怕', at: 101 },
        ]);
        expect(lines.map(cinemaLineText)).toEqual(['（靠过来）', '别怕']);
    });

    it('发给模型时，你的动作不挂「放到几分」，说的话照挂', () => {
        const msgs = sessionLinesToApiMessages(toCinemaLines('user', ['（靠在你肩上）好困'], 1, 65));
        expect(msgs).toEqual([{ role: 'user', content: ['（靠在你肩上）', '（放到 1:05）好困'].join('\n') }]);
    });

    it('线下提示词让角色把动作单独写一行', () => {
        const text = buildCinemaInstruction({ userName: '千夜', charName: '萧逸', status: null, hasFrame: false, session: { title: 'x', spoiler: 'first', meet: 'offline' } });
        expect(text).toContain('单独写一行，整行用（）括起来');
    });
});

describe('影院 · 出声时的写法', () => {
    it('英文语气声 (laughs) 不是小动作，留在台词里给配音用', () => {
        expect(splitCinemaActions('(laughs) 这也太离谱了')).toEqual([{ kind: 'speech', text: '(laughs) 这也太离谱了' }]);
        expect(splitCinemaActions('（笑出声）这也太离谱了')[0]).toEqual({ kind: 'action', text: '笑出声' });
    });

    it('开着出声：提示词告诉角色整段会被念出来，并附上语音写法', () => {
        const text = buildCinemaInstruction({
            userName: '千夜', charName: '萧逸', hasFrame: false, status: null,
            session: { title: 'x', spoiler: 'first' }, voiceGuide: '### 语音条怎么写（重要）',
        });
        expect(text).toContain('【影院 · 出声】');
        expect(text).toContain('### 语音条怎么写（重要）');
        expect(text).toContain('不用写 <语音> 标签');
    });

    it('只打字时不带语音写法', () => {
        const text = buildCinemaInstruction({ userName: '千夜', charName: '萧逸', hasFrame: false, status: null, session: { title: 'x', spoiler: 'first' } });
        expect(text).not.toContain('【影院 · 出声】');
    });
});

describe('影院 · B站 字幕', () => {
    it('接上新来的句子，跟最后一句一样的不重复，最多留 20 句', () => {
        let lines = appendSubtitleLines([], [{ time: 1, text: 'a' }, { time: 2, text: 'a' }, { time: 3, text: ' b ' }, { text: '' }, 'junk']);
        expect(lines).toEqual([{ time: 1, text: 'a' }, { time: 3, text: 'b' }]);
        for (let i = 0; i < 30; i += 1) lines = appendSubtitleLines(lines, [{ time: i, text: `句${i}` }]);
        expect(lines).toHaveLength(CINEMA_SUBTITLES_KEEP);
        expect(appendSubtitleLines(lines, undefined)).toBe(lines);
    });

    it('提示词里带上最近的台词，并说明是剧里人物说的', () => {
        const text = buildCinemaInstruction({
            userName: '千夜', charName: '萧逸', hasFrame: false, status: null,
            session: { title: 'x', spoiler: 'first' },
            recentSubtitles: [{ time: 100, text: '你到底是谁' }, { text: '我是钟表馆的主人' }],
        });
        expect(text).toContain('最近的台词');
        expect(text).toContain('不是千夜说的');
        expect(text).toContain('1:40 你到底是谁');
        expect(text).toContain('· 我是钟表馆的主人');
    });
});

describe('影院 · 外挂字幕', () => {
    const subs = sanitizeExternalSubtitles({
        name: '钟表馆事件 第1集.ass', offsetMs: 0,
        cues: [[1000, 3000, '你到底是谁'], [4000, 6000, '我是钟表馆的主人'], [200000, 202000, '很久以后'], ['坏', 1, 2], [7000, 8000, '  ']],
    })!;

    it('电脑发来的字幕核对形状，坏的丢掉；没句子就是不用了', () => {
        expect(subs.cues).toEqual([[1000, 3000, '你到底是谁'], [4000, 6000, '我是钟表馆的主人'], [200000, 202000, '很久以后']]);
        expect(sanitizeExternalSubtitles({ cues: [] })).toBeNull();
        expect(sanitizeExternalSubtitles({})).toBeNull();
    });

    it('估算此刻进度：在放就往后推，暂停就停在那', () => {
        const at = 1_000_000;
        expect(estimateVideoTime({ mode: 'site', time: 100, paused: false, at }, at + 5000)).toBe(105);
        expect(estimateVideoTime({ mode: 'site', time: 100, paused: true, at }, at + 5000)).toBe(100);
        expect(estimateVideoTime({ mode: 'share', sharing: true, at })).toBeUndefined();
    });

    it('按进度挑出这一句和最近几句', () => {
        const picked = pickSubtitleWindow(subs, 5);
        expect(picked.current).toBe('我是钟表馆的主人');
        expect(picked.recent).toEqual([{ time: 1, text: '你到底是谁' }, { time: 4, text: '我是钟表馆的主人' }]);
        expect(pickSubtitleWindow(subs, 3.5).current).toBeUndefined(); // 两句之间没台词
    });

    it('偏移：字幕推后 2 秒，视频放到 7 秒时才是第二句', () => {
        const later = { ...subs, offsetMs: 2000 };
        expect(pickSubtitleWindow(later, 4.5).current).toBe('你到底是谁');
        expect(pickSubtitleWindow(later, 7).current).toBe('我是钟表馆的主人');
        expect(pickSubtitleWindow(later, 7).recent.map(l => l.time)).toEqual([3, 6]);
    });
});
