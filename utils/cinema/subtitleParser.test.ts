import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 观影端的外挂字幕解析（public/watch/subtitle-parser.js）：在假的 window 上跑一遍。
const SRC = readFileSync(path.resolve(__dirname, '../../public/watch/subtitle-parser.js'), 'utf8');
const fakeWindow: any = {};
new Function('window', SRC)(fakeWindow);
const { parse, parseClock } = fakeWindow.SullySubtitleParser as {
    parse: (text: string, filename?: string) => [number, number, string][];
    parseClock: (raw: string) => number;
};

describe('外挂字幕解析', () => {
    it('时间格式：srt 逗号、vtt 点、ass 百分之一秒、没有小时', () => {
        expect(parseClock('00:01:02,345')).toBe(62345);
        expect(parseClock('00:01:02.345')).toBe(62345);
        expect(parseClock('0:01:02.34')).toBe(62340);
        expect(parseClock('01:02.500')).toBe(62500);
        expect(Number.isNaN(parseClock('abc'))).toBe(true);
    });

    it('srt：序号、多行、<i> 标签，带 BOM', () => {
        const srt = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>你到底</i>\r\n是谁\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,000\r\n我是钟表馆的主人\r\n';
        expect(parse(srt, 'a.srt')).toEqual([[1000, 3500, '你到底 是谁'], [4000, 5000, '我是钟表馆的主人']]);
    });

    it('vtt：头部、cue 设置、没有序号', () => {
        const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\nHello\n\n00:03.000 --> 00:04.000\n<c.yellow>World</c>\n';
        expect(parse(vtt, 'a.vtt')).toEqual([[1000, 2000, 'Hello'], [3000, 4000, 'World']]);
    });

    it('ass：按 Format 找列、正文里有逗号、特效标签和 \\N 换行', () => {
        const ass = [
            '[Script Info]', 'Title: x', '',
            '[V4+ Styles]', 'Format: Name, Fontname', 'Style: Default,Arial', '',
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            'Dialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,{\\an8}等等，你说什么\\N真的吗',
            'Comment: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,这行是注释',
        ].join('\n');
        expect(parse(ass, 'a.ass')).toEqual([[1000, 2500, '等等，你说什么 真的吗']]);
    });

    it('双语字幕：同一时间段的两行合成一句', () => {
        const ass = [
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            'Dialogue: 0,0:00:01.00,0:00:02.00,CN,,0,0,0,,你是谁',
            'Dialogue: 0,0:00:01.00,0:00:02.00,JP,,0,0,0,,お前は誰だ',
        ].join('\n');
        expect(parse(ass, 'bilingual.ass')).toEqual([[1000, 2000, '你是谁 / お前は誰だ']]);
    });

    it('认不出的东西返回空', () => {
        expect(parse('随便一段文字', 'a.txt')).toEqual([]);
    });
});
