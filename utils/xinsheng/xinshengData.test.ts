import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractXinsheng, normalizeXinsheng, parseXinshengLine } from './xinshengData';

const LINE = '{"t":"xinsheng","innerVoice":"想再多待一会儿","statusText":"悄悄瞟向你手里的零食","temperature":"36.8°C","emotionLevel":82,"moodDelta":"+4"}';

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe('normalizeXinsheng', () => {
    it('补默认值：温度 36.5°C、情绪 70', () => {
        expect(normalizeXinsheng({ t: 'xinsheng' })).toMatchObject({ temperature: '36.5°C', emotionLevel: 70, moodDelta: null });
    });

    it('emotionLevel 夹在 0~100', () => {
        expect(normalizeXinsheng({ emotionLevel: 999 }).emotionLevel).toBe(100);
        expect(normalizeXinsheng({ emotionLevel: -5 }).emotionLevel).toBe(0);
    });

    it('moodDelta 统一成带符号字符串', () => {
        expect(normalizeXinsheng({ moodDelta: 8 }).moodDelta).toBe('+8');
        expect(normalizeXinsheng({ moodDelta: '-5' }).moodDelta).toBe('-5');
        expect(normalizeXinsheng({ moodDelta: 0 }).moodDelta).toBe('+0');
    });

    it('自定义字段原样带过（论坛美化动辄 27 个字段，一个都不能丢）', () => {
        const e = normalizeXinsheng({ t: 'xinsheng', forum_post_1: '家人们', talk1: 'A\nB', moodTrend: [1, 2, 3] });
        expect(e.forum_post_1).toBe('家人们');
        expect(e.talk1).toBe('A\nB');
        expect(e.moodTrend).toEqual([1, 2, 3]);
    });
});

describe('parseXinshengLine', () => {
    it('合法单行直接解析', () => {
        expect(parseXinshengLine(LINE)).toMatchObject({ innerVoice: '想再多待一会儿', emotionLevel: 82, moodDelta: '+4' });
    });

    it('不是心声行返回 null', () => {
        expect(parseXinshengLine('{"t":"thinking","c":"…"}')).toBeNull();
        expect(parseXinshengLine('晚安。')).toBeNull();
    });

    it('字符串值里有裸换行时能修复', () => {
        const broken = '{"t":"xinsheng","innerVoice":"上一行\n下一行","emotionLevel":60}';
        expect(parseXinshengLine(broken)).toMatchObject({ innerVoice: '上一行\n下一行', emotionLevel: 60 });
    });

    it('JSON 坏掉时正则兜底，并且不丢自定义字段', () => {
        // talk1 后面漏了逗号 —— 原版兜底只会捞内置字段，自定义字段全丢
        const broken = '{"t":"xinsheng","innerVoice":"想你","talk1":"甲\\n在吗" "memo1":"买牛奶","heartRate":78}';
        const e = parseXinshengLine(broken);
        expect(e).not.toBeNull();
        expect(e!.innerVoice).toBe('想你');
        expect(e!.talk1).toBe('甲\n在吗');
        expect(e!.memo1).toBe('买牛奶');
        expect(e!.heartRate).toBe(78);
    });

    it('彻底没救时返回 null，不返回半个空壳', () => {
        expect(parseXinshengLine('{"t":"xinsheng" 完全坏掉')).toBeNull();
    });
});

describe('extractXinsheng', () => {
    it('摘掉心声行，正文原样保留', () => {
        const r = extractXinsheng(`真的吗？\n那我等你。\n${LINE}`);
        expect(r.cleaned).toBe('真的吗？\n那我等你。');
        expect(r.entry).toMatchObject({ innerVoice: '想再多待一会儿' });
    });

    it('黏在最后一句屁股后面也能摘（最常见的走样）', () => {
        const r = extractXinsheng(`那我等你。${LINE}`);
        expect(r.cleaned).toBe('那我等你。');
        expect(r.entry).not.toBeNull();
    });

    it('和别的 JSON 挤在同一行也能拆开', () => {
        const r = extractXinsheng(`{"t":"thinking","c":"嗯"}${LINE}`);
        expect(r.cleaned).toBe('{"t":"thinking","c":"嗯"}');
        expect(r.entry).not.toBeNull();
    });

    it('模型多吐几行时取最后一行（那是「最新的自己」）', () => {
        const first = LINE.replace('想再多待一会儿', '第一条');
        const r = extractXinsheng(`${first}\n${LINE}`);
        expect(r.entry!.innerVoice).toBe('想再多待一会儿');
    });

    it('解析失败的心声行也不放回正文（宁可少一张卡，不要一坨 JSON 变成气泡）', () => {
        const r = extractXinsheng('晚安。\n{"t":"xinsheng" 完全坏掉');
        expect(r.cleaned).toBe('晚安。');
        expect(r.entry).toBeNull();
    });

    it('正文里没有心声时原样返回，不做任何改写', () => {
        const raw = '晚安。\n\n明天见';
        expect(extractXinsheng(raw)).toEqual({ cleaned: raw, entry: null });
    });
});
