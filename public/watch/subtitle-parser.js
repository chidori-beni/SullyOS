/*
 * 影院观影端的外挂字幕解析：.srt / .vtt / .ass / .ssa → [[开始毫秒, 结束毫秒, 文字], ...]（按开始时间排好）。
 * 纯函数，不碰页面；watch.html 用 <script src> 引进来，挂在 window.SullySubtitleParser 上。
 * 测试在 utils/cinema/subtitleParser.test.ts（读这个文件跑一遍）。
 */
(function (root) {
  'use strict';

  const MAX_TEXT = 200;

  /** 00:01:02,345 / 00:01:02.345 / 01:02.345 / 0:01:02.34（ASS 是百分之一秒） */
  const parseClock = (raw) => {
    const m = String(raw || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (!m) return NaN;
    const h = Number(m[1] || 0);
    const min = Number(m[2]);
    const sec = Number(m[3]);
    const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
    return ((h * 60 + min) * 60 + sec) * 1000 + frac;
  };

  const cleanText = (text) => String(text || '')
    .replace(/\{[^}]*\}/g, '')          // ASS 特效 {\pos(…)} {\an8}
    .replace(/\\[Nn]/g, ' ')            // ASS 换行
    .replace(/<[^>]+>/g, '')            // srt / vtt 的 <i> <b> <c.xxx>
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);

  /** srt 和 vtt：一块一块，每块里找「开始 --> 结束」那一行，下面几行是字 */
  const parseTimed = (text) => {
    const cues = [];
    const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.split('\n');
      const idx = lines.findIndex(l => l.includes('-->'));
      if (idx < 0) continue;
      const [a, b] = lines[idx].split('-->');
      const start = parseClock(a);
      const end = parseClock(String(b || '').trim().split(/\s+/)[0]);
      const body = cleanText(lines.slice(idx + 1).join(' '));
      if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push([start, Math.max(end, start), body]);
    }
    return cues;
  };

  /** ass / ssa：[Events] 里的 Dialogue 行，按 Format 找 Start / End / Text 在第几列 */
  const parseAss = (text) => {
    const cues = [];
    let format = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
    let inEvents = false;
    for (const rawLine of text.replace(/\r/g, '').split('\n')) {
      const line = rawLine.trim();
      if (/^\[.*\]$/.test(line)) { inEvents = /^\[events\]$/i.test(line); continue; }
      if (!inEvents) continue;
      if (/^format\s*:/i.test(line)) {
        format = line.replace(/^format\s*:/i, '').split(',').map(s => s.trim());
        continue;
      }
      if (!/^dialogue\s*:/i.test(line)) continue;
      const rest = line.replace(/^dialogue\s*:/i, '');
      const parts = [];
      let cursor = 0;
      for (let i = 0; i < format.length - 1; i += 1) {
        const comma = rest.indexOf(',', cursor);
        if (comma < 0) break;
        parts.push(rest.slice(cursor, comma));
        cursor = comma + 1;
      }
      parts.push(rest.slice(cursor)); // 最后一列 Text 里可以有逗号
      const col = (name) => parts[format.findIndex(f => f.toLowerCase() === name)];
      const start = parseClock(col('start'));
      const end = parseClock(col('end'));
      const body = cleanText(col('text'));
      if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push([start, Math.max(end, start), body]);
    }
    return cues;
  };

  /**
   * 解析字幕文件。同一时间段的几行（双语字幕常见）合成一句。
   * 返回按开始时间排好的 [[startMs, endMs, text], ...]；认不出返回空数组。
   */
  const parse = (text, filename) => {
    const src = String(text || '').replace(/^﻿/, '');
    const isAss = /\.(ass|ssa)$/i.test(String(filename || '')) || /^\s*\[script info\]/im.test(src);
    const cues = isAss ? parseAss(src) : parseTimed(src);
    cues.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged = [];
    for (const cue of cues) {
      const last = merged[merged.length - 1];
      if (last && last[0] === cue[0] && last[1] === cue[1]) {
        if (!last[2].includes(cue[2])) last[2] = `${last[2]} / ${cue[2]}`.slice(0, MAX_TEXT);
      } else {
        merged.push([cue[0], cue[1], cue[2]]);
      }
    }
    return merged;
  };

  root.SullySubtitleParser = { parse, parseClock };
})(typeof window !== 'undefined' ? window : globalThis);
