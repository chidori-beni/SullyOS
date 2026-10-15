/**
 * 电话 App 的强调色：从角色聊天主题的「我的气泡底色」里取。
 *
 * 通话界面到处是 `${accent}66` 这种「6 位 hex + 两位透明度」拼接，
 * 所以这里必须交出一个干净的 #rrggbb：
 *   · 聊天美化主题常把气泡底色设成 transparent / rgba(...,0.1) / #ffffff00 / 渐变，
 *     原样拿来用会让图标、选中态文字、角色名、描边全部变透明（2026-10-15 用户反馈
 *     「设置里图标和字显示不全」「萧逸名字和边框不见了」就是这个）；
 *   · 太暗（如纯黑）的颜色也会让发光/描边「消失」，一并回落到亮紫。
 */

export const CALL_ACCENT_FALLBACK = '#a78bfa';

const toHex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

const parseColor = (raw: string): { r: number; g: number; b: number; a: number } | null => {
  const s = raw.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb) {
    const ch = (v: string) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: ch(rgb[1]), g: ch(rgb[2]), b: ch(rgb[3]), a: alpha };
  }
  return null;
};

/** 把任意主题色洗成可拼透明度后缀的 #rrggbb；认不出、太透明、太暗都回落到亮紫。 */
export const normalizeCallAccentColor = (raw: string | undefined | null): string => {
  const text = (raw || '').trim();
  if (!text) return CALL_ACCENT_FALLBACK;
  // 渐变之类：取里面第一个能认出来的颜色
  const candidates = parseColor(text)
    ? [text]
    : text.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) || [];
  for (const candidate of candidates) {
    const c = parseColor(candidate);
    if (!c || c.a < 0.35) continue;
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (lum < 90) return CALL_ACCENT_FALLBACK;
    return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
  }
  return CALL_ACCENT_FALLBACK;
};
