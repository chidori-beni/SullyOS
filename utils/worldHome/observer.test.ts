import { describe, it, expect } from 'vitest';
import {
    OBSERVER_LENGTHS,
    DEFAULT_OBSERVER_LENGTH,
    buildObserverPrompt,
    parseObserverLines,
    appendObserverLines,
    dropObserverLines,
    dmThreadBetween,
    formatThreadForObserver,
} from './observer';
import { dmThreadId, THREAD_CAP } from './threads';
import type { WorldProfile } from '../../types';

const A = { id: 'c_a', name: '青野', persona: '沉默寡言的面包师' };
const B = { id: 'c_b', name: '林漪', persona: '话很多的书店老板' };

function mkWorld(patch: Partial<WorldProfile> = {}): WorldProfile {
    return {
        id: 'w1',
        name: '雾岛',
        worldview: '海边的小镇，常年下雨',
        memberIds: [A.id, B.id],
        npcs: [],
        relationships: [],
        storyClock: 7,
        ...patch,
    } as unknown as WorldProfile;
}

describe('5.1 双人私聊观测器', () => {
    describe('档位', () => {
        it('三档都有名字、条数和一句人话说明', () => {
            for (const k of ['short', 'medium', 'long'] as const) {
                const p = OBSERVER_LENGTHS[k];
                expect(p.name).toBeTruthy();
                expect(p.hint).toBeTruthy();
                expect(p.lines).toBeGreaterThan(0);
            }
        });

        it('条数是递增的', () => {
            expect(OBSERVER_LENGTHS.short.lines).toBeLessThan(OBSERVER_LENGTHS.medium.lines);
            expect(OBSERVER_LENGTHS.medium.lines).toBeLessThan(OBSERVER_LENGTHS.long.lines);
        });

        it('缺省落在中间档 —— 短的常「刚开口就没了」，长的烧 token', () => {
            expect(DEFAULT_OBSERVER_LENGTH).toBe('medium');
        });
    });

    describe('提示词', () => {
        const base = { world: mkWorld(), a: A, b: B, storyTime: '第4天 傍晚', length: 'medium' as const };

        it('两个人的名字、人设都在', () => {
            const p = buildObserverPrompt(base);
            expect(p).toContain('青野');
            expect(p).toContain('林漪');
            expect(p).toContain('沉默寡言的面包师');
            expect(p).toContain('话很多的书店老板');
        });

        it('条数跟着档位走', () => {
            expect(buildObserverPrompt({ ...base, length: 'short' })).toContain(`${OBSERVER_LENGTHS.short.lines} 条左右`);
            expect(buildObserverPrompt({ ...base, length: 'long' })).toContain(`${OBSERVER_LENGTHS.long.lines} 条左右`);
        });

        it('⭐ 关系是**读进来**的：双方各自的口径都要给，且可以不对等', () => {
            const w = mkWorld({
                relationships: [
                    { fromId: A.id, toId: B.id, label: '烦人的邻居', value: 30 },
                    { fromId: B.id, toId: A.id, label: '想认识的人', value: 72 },
                ],
            } as Partial<WorldProfile>);
            const p = buildObserverPrompt({ ...base, world: w });
            expect(p).toContain('烦人的邻居');
            expect(p).toContain('好感 30/100');
            expect(p).toContain('想认识的人');
            expect(p).toContain('好感 72/100');
        });

        it('没定过关系时不编 —— 明写「还没定过关系」', () => {
            expect(buildObserverPrompt(base)).toContain('还没定过关系');
        });

        it('⛔⭐ 铁律二：提示词里不能出现 relationships 输出字段 —— 不给字段比给了再丢弃可靠', () => {
            const p = buildObserverPrompt(base);
            expect(p).not.toContain('relationships');
            expect(p).not.toContain('delta');
            expect(p).not.toContain('relabel');
        });

        it('⛔⭐ 铁律三：机主不在场 —— 一个字都不能提到用户/机主/系统/玩家', () => {
            const p = buildObserverPrompt({ ...base, topic: '昨天那场雨' });
            for (const w of ['用户', '机主', '系统', '玩家', '作者', '你希望', '请表现']) {
                expect(p).not.toContain(w);
            }
        });

        it('⭐ 话题引子按「对话从哪儿起头」包装，不写成谁下的指令', () => {
            const p = buildObserverPrompt({ ...base, topic: '昨天那场雨' });
            expect(p).toContain('这次他们说起的是：昨天那场雨');
        });

        it('没给引子就整段不出现', () => {
            expect(buildObserverPrompt(base)).not.toContain('这段对话的起头');
        });

        it('⭐「再聊几句」要明说是接着往下，不然模型会重新打招呼', () => {
            expect(buildObserverPrompt({ ...base, continued: true })).toContain('接着上面那些话往下说');
            expect(buildObserverPrompt(base)).toContain('新开的一段话');
        });

        it('上文有就带上，没有就整段不出现', () => {
            expect(buildObserverPrompt({ ...base, recent: '青野：嗯。' })).toContain('青野：嗯。');
            expect(buildObserverPrompt(base)).not.toContain('之前说过的话');
        });

        it('⛔ 明确禁掉旁白/动作描写 —— 这是手机打字，不是小说', () => {
            expect(buildObserverPrompt(base)).toContain('不要写旁白、动作描写');
        });

        it('⛔ 明确禁掉第三个人 —— 私聊里冒出第三人，观测器的前提就没了', () => {
            expect(buildObserverPrompt(base)).toContain('只有他们两个人');
        });
    });

    describe('解析', () => {
        it('正常 JSON 解析成带 id 的行', () => {
            const raw = '```json\n{"lines":[{"from":"青野","text":"面包卖完了"},{"from":"林漪","text":"啊？！"}]}\n```';
            expect(parseObserverLines(raw, A, B)).toEqual([
                { fromId: A.id, fromName: '青野', text: '面包卖完了' },
                { fromId: B.id, fromName: '林漪', text: '啊？！' },
            ]);
        });

        it('⭐⛔ 名字对不上的整条丢掉 —— 硬塞给其中一个会把不属于 ta 的话记到 ta 头上', () => {
            const raw = '{"lines":[{"from":"旁白","text":"雨停了"},{"from":"路人甲","text":"你好"},{"from":"青野","text":"嗯"}]}';
            const out = parseObserverLines(raw, A, B);
            expect(out).toHaveLength(1);
            expect(out[0].fromName).toBe('青野');
        });

        it('空文本、非字符串、缺字段都跳过', () => {
            const raw = '{"lines":[{"from":"青野","text":"   "},{"from":"青野"},{"text":"孤儿"},{"from":123,"text":"x"},{"from":"林漪","text":" 在 "}]}';
            expect(parseObserverLines(raw, A, B)).toEqual([{ fromId: B.id, fromName: '林漪', text: '在' }]);
        });

        it('⛔ 解析不出来返回空数组而不是抛错 —— 调用方据此提示「再试一次」', () => {
            expect(parseObserverLines('模型今天不想输出 JSON', A, B)).toEqual([]);
            expect(parseObserverLines('{"lines":"不是数组"}', A, B)).toEqual([]);
            expect(parseObserverLines('', A, B)).toEqual([]);
        });
    });

    describe('落线程', () => {
        const lines = [
            { fromId: A.id, fromName: '青野', text: '面包卖完了' },
            { fromId: B.id, fromName: '林漪', text: '啊？！' },
        ];

        it('落进他俩的 dm 线程，线程 id 和既有规则一致', () => {
            const w = mkWorld();
            appendObserverLines(w, A, B, lines, 7, '第4天 傍晚');
            const t = w.threads!.find(x => x.id === dmThreadId(A.id, B.id))!;
            expect(t.kind).toBe('dm');
            expect(t.messages.map(m => m.text)).toEqual(['面包卖完了', '啊？！']);
            expect(t.messages.every(m => m.round === 7 && m.storyTime === '第4天 傍晚')).toBe(true);
        });

        it('线程已存在就续写，不新建第二条', () => {
            const w = mkWorld();
            appendObserverLines(w, A, B, lines, 7, 't');
            appendObserverLines(w, A, B, [{ fromId: A.id, fromName: '青野', text: '明天早点来' }], 7, 't');
            expect(w.threads!.filter(x => x.kind === 'dm')).toHaveLength(1);
            expect(w.threads!.find(x => x.kind === 'dm')!.messages).toHaveLength(3);
        });

        it('沿用线程的去重口径：同一个人刚说过的原话不重复落库', () => {
            const w = mkWorld();
            appendObserverLines(w, A, B, lines, 7, 't');
            const ids = appendObserverLines(w, A, B, lines, 7, 't');
            expect(ids).toEqual([]);
        });

        it('⛔⭐ 铁律一：不推进世界 —— storyClock / pendings / relationships 一个都不动', () => {
            const w = mkWorld({
                relationships: [{ fromId: A.id, toId: B.id, label: '邻居', value: 30 }],
                pendings: [],
            } as Partial<WorldProfile>);
            const clockBefore = w.storyClock;
            const relBefore = JSON.stringify(w.relationships);
            const pendBefore = JSON.stringify(w.pendings);
            appendObserverLines(w, A, B, lines, w.storyClock, 't');
            expect(w.storyClock).toBe(clockBefore);
            expect(JSON.stringify(w.relationships)).toBe(relBefore);
            expect(JSON.stringify(w.pendings)).toBe(pendBefore);
        });

        it('⭐ 超过上限时裁掉最旧的，保住最新的', () => {
            const w = mkWorld();
            const many = Array.from({ length: THREAD_CAP + 10 }, (_, i) => ({ fromId: A.id, fromName: '青野', text: `第${i}句` }));
            appendObserverLines(w, A, B, many, 7, 't');
            const t = w.threads!.find(x => x.kind === 'dm')!;
            expect(t.messages).toHaveLength(THREAD_CAP);
            expect(t.messages[t.messages.length - 1].text).toBe(`第${THREAD_CAP + 9}句`);
        });

        it('空数组直接返回，不会凭空建出一条空线程', () => {
            const w = mkWorld();
            expect(appendObserverLines(w, A, B, [], 7, 't')).toEqual([]);
            expect(w.threads).toBeUndefined();
        });
    });

    describe('「这段不要了」', () => {
        it('⭐ 只撤掉刚生成的那批，用户/演绎原有的消息一条不动', () => {
            const w = mkWorld();
            const t = dmThreadBetween(w, A.id, B.id);
            t.messages.push({ id: 'old1', fromId: A.id, fromName: '青野', text: '很久以前的话', round: 1, storyTime: 't', timestamp: 1 });
            const ids = appendObserverLines(w, A, B, [
                { fromId: A.id, fromName: '青野', text: '新的一句' },
                { fromId: B.id, fromName: '林漪', text: '另一句' },
            ], 7, 't');
            expect(ids).toHaveLength(2);
            dropObserverLines(w, A, B, ids);
            expect(t.messages.map(m => m.id)).toEqual(['old1']);
        });

        it('空 id 列表 / 线程不存在都不出错', () => {
            const w = mkWorld();
            expect(() => dropObserverLines(w, A, B, [])).not.toThrow();
            expect(() => dropObserverLines(w, A, B, ['不存在'])).not.toThrow();
        });
    });

    describe('上文格式', () => {
        it('⭐⛔ 旁观者口径：两边都写名字，绝不出现「你」—— 写成「你」模型会分不清在扮演谁', () => {
            const w = mkWorld();
            appendObserverLines(w, A, B, [
                { fromId: A.id, fromName: '青野', text: '嗯' },
                { fromId: B.id, fromName: '林漪', text: '在？' },
            ], 7, 't');
            const s = formatThreadForObserver(w.threads!.find(x => x.kind === 'dm'));
            expect(s).toBe('青野：嗯\n林漪：在？');
            expect(s).not.toContain('你：');
        });

        it('只取尾部若干条', () => {
            const w = mkWorld();
            appendObserverLines(w, A, B, Array.from({ length: 30 }, (_, i) => ({ fromId: A.id, fromName: '青野', text: `第${i}句` })), 7, 't');
            const s = formatThreadForObserver(w.threads!.find(x => x.kind === 'dm'), 5);
            expect(s.split('\n')).toHaveLength(5);
            expect(s).toContain('第29句');
            expect(s).not.toContain('第24句');
        });

        it('没消息 / 没线程都返回空串（调用方据此省掉整段上文）', () => {
            expect(formatThreadForObserver(null)).toBe('');
            expect(formatThreadForObserver(undefined)).toBe('');
            expect(formatThreadForObserver({ id: 'x', kind: 'dm', memberIds: [], messages: [] })).toBe('');
        });
    });
});
