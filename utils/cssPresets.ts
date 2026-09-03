/**
 * 「一段 CSS + 一堆预设」这套交互的通用逻辑。
 *
 * 卡片 CSS（utils/chatCardCss.ts）先长出来的这套规矩，全局 CSS 又要一份一模一样的，
 * 于是抽到这里：同名视为覆盖、重命名查重、有条数上限。
 *
 * ⚠️ 调用方每个动作只能提交**一次** updateTheme。
 * OSContext 的 updateTheme 是 `{ ...theme, ...updates }` 从闭包里那份 theme 合的，
 * 不是函数式更新——同一个事件里连调两次，第二次会拿旧 theme 抹掉第一次。
 */

export interface CssPreset {
  id: string;
  name: string;
  css: string;
  updatedAt: number;
}

export const CSS_PRESET_LIMIT = 24;

export function makeCssPresetId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 保存 / 覆盖。同名视为覆盖，避免列表里堆出一排同名预设。 */
export function upsertCssPreset(
  presets: CssPreset[] | undefined,
  name: string,
  css: string,
  idPrefix: string,
): { presets: CssPreset[]; preset: CssPreset } | { error: string } {
  const trimmedName = (name || '').trim();
  if (!trimmedName) return { error: '先给这套样式起个名字。' };
  if (!(css || '').trim()) return { error: '当前没有 CSS，先写点内容再保存预设。' };
  const list = presets || [];
  const existing = list.find(item => item.name === trimmedName);
  if (!existing && list.length >= CSS_PRESET_LIMIT) {
    return { error: `预设最多保存 ${CSS_PRESET_LIMIT} 套，先删掉几套再存。` };
  }
  const preset: CssPreset = {
    id: existing?.id || makeCssPresetId(idPrefix),
    name: trimmedName,
    css,
    updatedAt: Date.now(),
  };
  return {
    presets: existing ? list.map(item => (item.id === existing.id ? preset : item)) : [...list, preset],
    preset,
  };
}

/** 重命名。空名字或撞上别的预设名都拦下来，交给调用方 toast。 */
export function renameCssPreset(
  presets: CssPreset[] | undefined,
  id: string,
  name: string,
): { presets: CssPreset[] } | { error: string } {
  const trimmed = (name || '').trim();
  if (!trimmed) return { error: '预设名字不能是空的。' };
  const list = presets || [];
  const target = list.find(item => item.id === id);
  if (!target) return { error: '这套预设已经不在了。' };
  if (list.some(item => item.id !== id && item.name === trimmed)) {
    return { error: `已经有一套叫「${trimmed}」了，换个名字。` };
  }
  return {
    presets: list.map(item => (item.id === id ? { ...item, name: trimmed, updatedAt: Date.now() } : item)),
  };
}

export function removeCssPreset(presets: CssPreset[] | undefined, id: string): CssPreset[] {
  return (presets || []).filter(item => item.id !== id);
}
