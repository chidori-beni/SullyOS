import { describe, it, expect } from 'vitest';
import { stripEmotionTags, cleanTextForTts, parseVoiceOutput, insertSpeechBreaks, cleanVoiceMarkupForDisplay, normalizeEmotionForApi, buildVoiceSettings } from './minimaxTts';

describe('stripEmotionTags', () => {
  it('removes [emotion] / 【emotion】 tags anywhere, leaves prose', () => {
    expect(stripEmotionTags('[angry] 你怎么还不睡')).toBe(' 你怎么还不睡');
    expect(stripEmotionTags('喂？【calm】快去睡觉')).toBe('喂？快去睡觉');
    expect(stripEmotionTags('开头[happy]中间[sad]结尾')).toBe('开头中间结尾');
  });
  it('does not touch non-emotion brackets', () => {
    expect(stripEmotionTags('[备注] 还在')).toBe('[备注] 还在');
  });
});

describe('cleanTextForTts', () => {
  it('strips emotion tags and Chinese stage cues, keeps whitelisted sound tags', () => {
    const out = cleanTextForTts('[angry] 说话呀笨蛋(sighs)（叹气）');
    expect(out).not.toMatch(/\[angry\]/);
    expect(out).not.toContain('（叹气）');
    expect(out).toContain('(sighs)');
  });
  it('uses <语音> content (with attribute) when present', () => {
    expect(cleanTextForTts('显示文字<语音 emotion="happy">spoken (chuckle)</语音>')).toBe('spoken (chuckle)');
  });
});

describe('parseVoiceOutput', () => {
  it('extracts display, speech and a valid emotion attribute', () => {
    const r = parseVoiceOutput('外面的话<语音 emotion="sad">里面的话</语音>');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.display).toBe('外面的话');
    expect(r.speech).toBe('里面的话');
    expect(r.emotion).toBe('sad');
  });
  it('drops an invalid emotion value', () => {
    expect(parseVoiceOutput('<语音 emotion="excited">嗨</语音>').emotion).toBeUndefined();
  });
  it('handles plain messages with no tag', () => {
    const r = parseVoiceOutput('就是一句话');
    expect(r.hasVoiceTag).toBe(false);
    expect(r.display).toBe('就是一句话');
  });

  // ─── 掉格式自愈 (normalizeVoiceTags 集成) ───
  it('salvages an unclosed <语音> tag (model forgot the close)', () => {
    const r = parseVoiceOutput('外面的话\n<语音 emotion="calm">うん、そのままでいい。');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.display).toBe('外面的话');
    expect(r.speech).toBe('うん、そのままでいい。');
    expect(r.emotion).toBe('calm');
  });
  it('tolerates missing space before emotion attribute', () => {
    const r = parseVoiceOutput('<语音emotion="happy">hi there</语音>');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.speech).toBe('hi there');
    expect(r.emotion).toBe('happy');
  });
  it('tolerates full-width quotes in the emotion attribute', () => {
    const r = parseVoiceOutput('<语音 emotion=“sad”>ごめんね</语音>');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.emotion).toBe('sad');
    expect(r.speech).toBe('ごめんね');
  });
  it('tolerates spaced / cross-variant closing tags', () => {
    expect(parseVoiceOutput('<语音>你好</ 语音 >').speech).toBe('你好');
    expect(parseVoiceOutput('<语音>你好</語音>').speech).toBe('你好');
  });
  it('tolerates full-width angle brackets', () => {
    const r = parseVoiceOutput('＜语音 emotion="calm"＞落ち着いて＜/语音＞');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.speech).toBe('落ち着いて');
    expect(r.emotion).toBe('calm');
  });
  it('strips an orphan closing tag instead of leaking it', () => {
    const r = parseVoiceOutput('前半句话</语音>后半句话');
    expect(r.hasVoiceTag).toBe(false);
    expect(r.display).toBe('前半句话后半句话');
  });

  // ─── <字幕> 显式翻译标签 ───
  it('extracts <字幕> as subtitle; display excludes both tags', () => {
    const r = parseVoiceOutput('随口聊一句\n<语音 emotion="calm">Take a rest, okay?</语音>\n<字幕>好好休息，好吗？</字幕>');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.subtitle).toBe('好好休息，好吗？');
    expect(r.speech).toBe('Take a rest, okay?');
    expect(r.display).toBe('随口聊一句');
    expect(r.emotion).toBe('calm');
  });
  it('subtitle absent → undefined (老格式兼容)', () => {
    expect(parseVoiceOutput('<语音>hi</语音>').subtitle).toBeUndefined();
  });
  it('unclosed voice followed by subtitle → subtitle not swallowed into speech', () => {
    const r = parseVoiceOutput('<语音>Take a rest.\n<字幕>好好休息。</字幕>');
    expect(r.speech).toBe('Take a rest.');
    expect(r.subtitle).toBe('好好休息。');
  });
  it('cleanTextForTts never reads subtitle aloud', () => {
    expect(cleanTextForTts('<语音>spoken</语音><字幕>字幕文字</字幕>')).toBe('spoken');
    expect(cleanTextForTts('没有语音标签<字幕>字幕文字</字幕>')).toBe('没有语音标签');
  });
});

describe('cleanVoiceMarkupForDisplay', () => {
  it('strips <#x#> pause markers and whitelisted action tags for display', () => {
    const out = cleanVoiceMarkupForDisplay('(sighs) 唉，<#0.4#> 真是的。<#0.5#> (chuckle) 算了。');
    expect(out).not.toContain('<#');
    expect(out).not.toContain('(sighs)');
    expect(out).not.toContain('(chuckle)');
    expect(out).toContain('唉');
    expect(out).toContain('算了');
  });
  it('leaves non-whitelisted parentheses untouched', () => {
    expect(cleanVoiceMarkupForDisplay('备注(2026) 还在')).toBe('备注(2026) 还在');
  });
  it('handles empty / undefined input', () => {
    expect(cleanVoiceMarkupForDisplay('')).toBe('');
    expect(cleanVoiceMarkupForDisplay(undefined)).toBe('');
  });
});

describe('insertSpeechBreaks', () => {
  it('caps pause length at 0.6s and inserts pause markers', () => {
    const out = insertSpeechBreaks('真的吗……好吧。');
    expect(out).toMatch(/<#0\.\d+#>/);
    const maxPause = Math.max(...[...out.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1])));
    expect(maxPause).toBeLessThanOrEqual(0.6);
  });
});

describe('normalizeEmotionForApi — 送 MiniMax 前的情绪归一化', () => {
  it('MiniMax 枚举内的原样通过', () => {
    for (const e of ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'neutral']) {
      expect(normalizeEmotionForApi(e)).toBe(e);
    }
  });

  it('calm / fluent 归到 neutral（MiniMax 不认这两个词）', () => {
    expect(normalizeEmotionForApi('calm')).toBe('neutral');
    expect(normalizeEmotionForApi('fluent')).toBe('neutral');
  });

  it('大小写和空格容错', () => {
    expect(normalizeEmotionForApi('  Neutral ')).toBe('neutral');
    expect(normalizeEmotionForApi('CALM')).toBe('neutral');
  });

  it('空值 / 未知值 → undefined（不带 emotion 字段）', () => {
    expect(normalizeEmotionForApi('')).toBeUndefined();
    expect(normalizeEmotionForApi(undefined)).toBeUndefined();
    expect(normalizeEmotionForApi(null)).toBeUndefined();
    expect(normalizeEmotionForApi('excited')).toBeUndefined();
    expect(normalizeEmotionForApi('痞')).toBeUndefined();
  });

  it('neutral 现在能被 <语音 emotion="neutral"> 解析出来并送出去', () => {
    const parsed = parseVoiceOutput('<语音 emotion="neutral">行吧。</语音>');
    expect(parsed.emotion).toBe('neutral');
    expect(buildVoiceSettings({ voiceId: 'v' } as any, parsed.emotion).emotion).toBe('neutral');
  });

  it('buildVoiceSettings 永远不会把 calm/fluent 原样送出去', () => {
    expect(buildVoiceSettings({ voiceId: 'v', emotion: 'calm' } as any).emotion).toBe('neutral');
    expect(buildVoiceSettings({ voiceId: 'v' } as any, 'fluent').emotion).toBe('neutral');
  });

  it('没有情绪时不带 emotion 字段', () => {
    expect(buildVoiceSettings({ voiceId: 'v' } as any)).not.toHaveProperty('emotion');
  });
});

describe('停顿封顶 —— 日常对话里超过 0.5s 就不像换气而像卡住', () => {
  it('模型手写的超长停顿被削平到 0.5', () => {
    expect(insertSpeechBreaks('等等<#1.0#>我想想')).toContain('<#0.50#>');
    expect(insertSpeechBreaks('等等<#1.0#>我想想')).not.toContain('<#1.0#>');
  });

  it('0.5 以内的原样保留（只削超标的，不动正常值）', () => {
    expect(insertSpeechBreaks('我没事<#0.30#>就是有点累')).toContain('<#0.30#>');
  });

  it('自动插的停顿本来就在范围内', () => {
    const out = insertSpeechBreaks('行吧。那你继续。');
    const times = [...out.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1]));
    expect(times.length).toBeGreaterThan(0);
    expect(Math.max(...times)).toBeLessThanOrEqual(0.5);
  });

  it('整段文本里不会有任何一个标记超过 0.5', () => {
    const out = insertSpeechBreaks('等等<#2.0#>啊……我忘了<#0.9#>算了！真的假的？');
    const times = [...out.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1]));
    expect(Math.max(...times)).toBeLessThanOrEqual(0.5);
  });
});

describe('语气声白名单 —— 补齐 MiniMax 官方列表', () => {
  it('新补的 burps / sneezes 会被当成合法标签保留', () => {
    expect(cleanTextForTts('(burps) 不好意思')).toContain('(burps)');
    expect(cleanTextForTts('(sneezes) 冷死了')).toContain('(sneezes)');
  });

  it('拼错的仍然被删掉（gasp 不是官方写法，官方是 gasps）', () => {
    expect(cleanTextForTts('(gasp) 你说真的')).not.toContain('gasp');
    expect(cleanTextForTts('(gasps) 你说真的')).toContain('(gasps)');
  });

  it('(breath) 一直是合法的', () => {
    expect(cleanTextForTts('(breath) 那我说了')).toContain('(breath)');
  });
});
