import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_CSS_AI_PROMPT, UI_HOOK_CATALOG, uiHooksOfWave, COCOA_DOTS_UI_CSS } from './globalCss';

/**
 * 守卫：名录里登记的每个 .sully-ui-* 类，必须真的挂在某个组件上。
 * 名录同时是用户那份 AI 提示词的内容 —— 列了却不存在的类，
 * 等于用户粘回来一段完全不生效的 CSS，还看不出原因。
 */

// 只读挂了钩子的那几个文件 —— 之前递归读 components+apps 全部 .tsx，
// 拼成的字符串太大把 vitest 的 worker 撑崩了。名录扩到新文件时，这里加一行。
const HOOK_FILES = [
  'components/os/Modal.tsx',
  'components/PhoneShell.tsx',
  'components/chat/ChatDecorSheet.tsx',
  'components/appearance/ChatAppearanceEditor.tsx',
  'components/chat/ThinkingChainSettingsModal.tsx',
  'components/chat/xinsheng/XinshengCardModal.tsx',
  'components/chat/xinsheng/XinshengSettingsModal.tsx',
];
const SOURCE = HOOK_FILES
  .map(rel => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf-8'))
  .join(String.fromCharCode(10));

describe('全局 UI 钩子名录', () => {
  it('第一波不是空的', () => {
    expect(uiHooksOfWave(1).length).toBeGreaterThan(10);
  });

  it.each(UI_HOOK_CATALOG.map(e => e.hook))('%s 真的挂在某个组件上了', (hook) => {
    expect(SOURCE).toContain(hook);
  });

  it('名录没有重复', () => {
    const hooks = UI_HOOK_CATALOG.map(e => e.hook);
    expect(new Set(hooks).size).toBe(hooks.length);
  });
});

describe('AI 提示词', () => {
  it('带上了全部类名', () => {
    for (const entry of UI_HOOK_CATALOG) expect(GLOBAL_CSS_AI_PROMPT).toContain(`.${entry.hook}`);
  });

  it('写明了禁止毛玻璃和无限动画（这两条是发烫的主因）', () => {
    expect(GLOBAL_CSS_AI_PROMPT).toContain('backdrop-filter');
    expect(GLOBAL_CSS_AI_PROMPT).toContain('无限循环');
  });

  it('警告了这段 CSS 是整机生效的', () => {
    expect(GLOBAL_CSS_AI_PROMPT).toContain('整机');
  });
});

describe('内置「可可点点」预设', () => {
  it('只用 .sully-ui-* 选择器，不会污染别的界面', () => {
    const selectors = COCOA_DOTS_UI_CSS
      .split('\n')
      .filter(line => line.trim().endsWith('{') || line.trim().endsWith(','))
      .filter(line => !line.trim().startsWith('/*'));
    expect(selectors.length).toBeGreaterThan(5);
    for (const line of selectors) expect(line.trim().startsWith('.sully-ui-')).toBe(true);
  });

  it('自己不用毛玻璃，还主动把组件自带的关掉', () => {
    expect(COCOA_DOTS_UI_CSS).toContain('backdrop-filter:none');
    expect(COCOA_DOTS_UI_CSS).not.toMatch(/backdrop-filter:\s*blur/);
  });
});
