import { describe, expect, it } from 'vitest';
import type { ChatCardCssPreset } from '../types';
import {
  BUILTIN_CARD_CSS_PRESETS,
  CHAT_CARD_CSS_AI_PROMPT,
  CHAT_CARD_CSS_PRESET_LIMIT,
  DARK_CARD_KINDS,
  LIGHT_CARDS_PRESET_CSS,
  removeChatCardCssPreset,
  renameChatCardCssPreset,
  upsertChatCardCssPreset,
} from './chatCardCss';

const preset = (id: string, name: string, css = '.sully-chat-card{}'): ChatCardCssPreset =>
  ({ id, name, css, updatedAt: 1 });

describe('upsertChatCardCssPreset', () => {
  it('存一套新预设', () => {
    const result = upsertChatCardCssPreset([], '浅色', '.sully-chat-card{color:red!important;}');
    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].name).toBe('浅色');
    expect(result.preset.id).toBeTruthy();
  });

  it('同名视为覆盖，不会堆出两条「浅色」', () => {
    const existing = [preset('a', '浅色', '.old{}')];
    const result = upsertChatCardCssPreset(existing, '浅色', '.new{}');
    if ('error' in result) throw new Error(result.error);
    expect(result.presets).toHaveLength(1);
    expect(result.presets[0].id).toBe('a');
    expect(result.presets[0].css).toBe('.new{}');
  });

  it('名字前后空格会被去掉', () => {
    const result = upsertChatCardCssPreset([], '  奶油  ', '.a{}');
    if ('error' in result) throw new Error(result.error);
    expect(result.presets[0].name).toBe('奶油');
  });

  it('空名字、空 CSS、超出上限都拦下来', () => {
    expect(upsertChatCardCssPreset([], '   ', '.a{}')).toHaveProperty('error');
    expect(upsertChatCardCssPreset([], '有名字', '   ')).toHaveProperty('error');
    const full = Array.from({ length: CHAT_CARD_CSS_PRESET_LIMIT }, (_, i) => preset(`p${i}`, `预设${i}`));
    expect(upsertChatCardCssPreset(full, '再来一套', '.a{}')).toHaveProperty('error');
    // 满了之后覆盖同名的仍然允许——不然改不动已有的那几套
    expect(upsertChatCardCssPreset(full, '预设0', '.a{}')).not.toHaveProperty('error');
  });
});

describe('renameChatCardCssPreset', () => {
  it('改名成功', () => {
    const result = renameChatCardCssPreset([preset('a', '旧名')], 'a', '新名');
    if ('error' in result) throw new Error(result.error);
    expect(result.presets[0].name).toBe('新名');
    expect(result.presets[0].updatedAt).toBeGreaterThan(1);
  });

  it('空名字 / 找不到 / 撞名都拦下来', () => {
    expect(renameChatCardCssPreset([preset('a', '甲')], 'a', ' ')).toHaveProperty('error');
    expect(renameChatCardCssPreset([preset('a', '甲')], 'nope', '乙')).toHaveProperty('error');
    expect(renameChatCardCssPreset([preset('a', '甲'), preset('b', '乙')], 'a', '乙')).toHaveProperty('error');
  });

  it('改成自己原来的名字不算撞名', () => {
    expect(renameChatCardCssPreset([preset('a', '甲')], 'a', '甲')).not.toHaveProperty('error');
  });
});

describe('removeChatCardCssPreset', () => {
  it('按 id 删掉，其余不动', () => {
    expect(removeChatCardCssPreset([preset('a', '甲'), preset('b', '乙')], 'a').map(p => p.id)).toEqual(['b']);
    expect(removeChatCardCssPreset(undefined, 'a')).toEqual([]);
  });
});

describe('内置「浅色卡片」预设', () => {
  it('覆盖到了每一张深色卡', () => {
    expect(DARK_CARD_KINDS.length).toBeGreaterThan(0);
    for (const kind of DARK_CARD_KINDS) {
      expect(LIGHT_CARDS_PRESET_CSS).toContain(`.sully-chat-card[data-card="${kind}"]`);
    }
  });

  it('每条规则都带 !important —— 卡片颜色写在内联 style 上，不加就完全无效', () => {
    const declarations = LIGHT_CARDS_PRESET_CSS
      .split('\n')
      .filter(line => /:\s*[^;]+;/.test(line) && !line.trim().startsWith('/*'));
    expect(declarations.length).toBeGreaterThan(0);
    for (const line of declarations) {
      expect(line).toContain('!important');
    }
  });

  it('只用 .sully-chat-card 开头的选择器，不会污染别的界面', () => {
    const selectors = LIGHT_CARDS_PRESET_CSS
      .split('\n')
      .filter(line => line.trim().endsWith(',') || line.trim().endsWith('{'))
      .filter(line => !line.trim().startsWith('/*'));
    expect(selectors.length).toBeGreaterThan(0);
    for (const line of selectors) {
      expect(line.trim().startsWith('.sully-chat-card')).toBe(true);
    }
  });

  it('内置预设列表里就是它', () => {
    expect(BUILTIN_CARD_CSS_PRESETS.map(p => p.name)).toContain('浅色卡片');
    expect(BUILTIN_CARD_CSS_PRESETS.every(p => p.css.trim())).toBe(true);
  });
});

describe('AI 提示词', () => {
  it('带上了卡片名录和「必须加 !important」这条规矩', () => {
    expect(CHAT_CARD_CSS_AI_PROMPT).toContain('vr_card');
    expect(CHAT_CARD_CSS_AI_PROMPT).toContain('data-card-sub');
    expect(CHAT_CARD_CSS_AI_PROMPT).toContain('!important');
    expect(CHAT_CARD_CSS_AI_PROMPT).toContain('.sully-chat-card');
  });
});
