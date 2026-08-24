import { describe, expect, it } from 'vitest';
import {
  NUOJI_TEXT_LIMIT,
  hasManualVoiceMarkup,
  insertNuojiBreaks,
  prepareNuojiSpeechText,
} from './nuojiSpeechText';

const breaks = (s: string) => [...s.matchAll(/<#([\d.]+)#>/g)].map(m => m[1]);

describe('hasManualVoiceMarkup', () => {
  it('认得 <#秒#> 和西文括号语气词', () => {
    expect(hasManualVoiceMarkup('我没事。<#0.3#>就是有点累。')).toBe(true);
    expect(hasManualVoiceMarkup('(sighs) 算了。')).toBe(true);
    expect(hasManualVoiceMarkup('(clear-throat) 听我说。')).toBe(true);
  });

  it('纯中文正文不算有标记', () => {
    expect(hasManualVoiceMarkup('行吧，我知道了。你先睡。')).toBe(false);
  });

  it('中文括号舞台指示不算「人工语音标记」——它是要被删掉的东西，不是标记', () => {
    expect(hasManualVoiceMarkup('（轻笑）你还真会折腾我。')).toBe(false);
  });
});

describe('insertNuojiBreaks —— 糯叽机的稀疏规则', () => {
  it('逗号不插停顿（SullyOS 原来每个逗号都插 0.10，这是「像在演」的主因之一）', () => {
    expect(insertNuojiBreaks('行吧，我知道了')).toBe('行吧，我知道了');
  });

  it('顿号分号冒号一律不插', () => {
    expect(insertNuojiBreaks('这个、那个；还有：都行')).toBe('这个、那个；还有：都行');
  });

  it('句末最后一个标点不插，不留尾巴', () => {
    expect(insertNuojiBreaks('你先睡。')).toBe('你先睡。');
    expect(insertNuojiBreaks('真的假的？')).toBe('真的假的？');
  });

  it('句中的句号问号才插 0.3', () => {
    expect(insertNuojiBreaks('我知道了。你先睡。')).toBe('我知道了。<#0.3#>你先睡。');
  });

  it('省略号插 0.5', () => {
    expect(insertNuojiBreaks('我……还是有点不爽')).toBe('我……<#0.5#>还是有点不爽');
  });

  it('破折号插 0.3', () => {
    expect(insertNuojiBreaks('算了——你随意')).toBe('算了——<#0.3#>你随意');
  });

  it('只有「逗号 + 转折连词」这一种逗号会插 0.2', () => {
    expect(insertNuojiBreaks('我帮你，但是别再有下次')).toBe('我帮你，<#0.2#>但是别再有下次');
    expect(insertNuojiBreaks('我帮你，你自己看着办')).toBe('我帮你，你自己看着办');
  });

  it('已经有 <# 紧跟的位置不重复插', () => {
    expect(insertNuojiBreaks('我没事。<#0.5#>就是有点累。')).toBe('我没事。<#0.5#>就是有点累。');
  });
});

describe('prepareNuojiSpeechText —— 完整流水线', () => {
  it('已有人工标记时原样送，一个停顿都不加（这条是「别在模型写好的标记上再叠一层」）', () => {
    const input = '(sighs) 行吧。听你的。真的。';
    expect(prepareNuojiSpeechText(input)).toBe(input);
  });

  it('已有标记时也不会删中文舞台指示（整体不加工）', () => {
    const input = '<#0.3#>（轻笑）你还真行。';
    expect(prepareNuojiSpeechText(input)).toBe(input);
  });

  it('没有标记时删掉中文舞台指示再插稀疏停顿', () => {
    expect(prepareNuojiSpeechText('（轻笑）你还真会折腾我。算了。')).toBe('你还真会折腾我。<#0.3#>算了。');
  });

  it('preserveActionMarkers 把舞台指示换成 0.3 停顿而不是删掉', () => {
    expect(prepareNuojiSpeechText('（轻笑）你还真行。', { preserveActionMarkers: true }))
      .toBe('<#0.3#>你还真行。');
  });

  it('括号不成对时不动手，免得把半句话吃掉', () => {
    const input = '你（怎么这样。算了。';
    expect(prepareNuojiSpeechText(input)).toContain('你（怎么这样。');
  });

  it('星号不成对时同样不动手', () => {
    expect(prepareNuojiSpeechText('这个*有点怪。')).toContain('这个*有点怪。');
  });

  it('成对星号的动作描写会被删掉', () => {
    expect(prepareNuojiSpeechText('*翻了个身* 别吵。')).toBe('别吵。');
  });

  it('passVoiceTags 强制原样送', () => {
    const input = '（轻笑）你还真行。算了。';
    expect(prepareNuojiSpeechText(input, { passVoiceTags: true })).toBe(input);
  });

  it('删完变成空字符串时回退原文，不会送个空文本去合成', () => {
    expect(prepareNuojiSpeechText('（完全是舞台指示）')).toBe('（完全是舞台指示）');
  });

  it('连续空白压成一个空格', () => {
    expect(prepareNuojiSpeechText('行吧    我知道了')).toBe('行吧 我知道了');
  });

  it('截断到一万字', () => {
    expect(prepareNuojiSpeechText('啊'.repeat(NUOJI_TEXT_LIMIT + 500)).length).toBe(NUOJI_TEXT_LIMIT);
  });

  it('整句对比：同一句话，糯叽机只给一个停顿', () => {
    // SullyOS 原来的 insertSpeechBreaks 会给出 3 个（逗号 0.10 + 两个句号 0.22）。
    const out = prepareNuojiSpeechText('行吧，我知道了。你先睡。');
    expect(breaks(out)).toEqual(['0.3']);
  });
});
