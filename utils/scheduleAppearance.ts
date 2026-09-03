import type {
    ScheduleCardAppearance,
    ScheduleCardPresetId,
    ScheduleCardSkinPreset,
} from '../types';

export interface ScheduleCardPreset {
    id: Exclude<ScheduleCardPresetId, 'custom'>;
    name: string;
    description: string;
    background: string;
    base: string;
    text: string;
    accent: string;
}

export interface ScheduleCardPalette {
    preset: ScheduleCardPresetId;
    background: string;
    base: string;
    text: string;
    accent: string;
    accentSoft: string;
    line: string;
    isOriginal: boolean;
}

export const SCHEDULE_CARD_PRESETS: ScheduleCardPreset[] = [
    {
        id: 'original',
        name: '原版星夜',
        description: '跟随角色主题色',
        background: '',
        base: '',
        text: '#ffffff',
        accent: '',
    },
    {
        id: 'cream',
        name: '奶油信笺',
        description: '暖白与焦糖棕',
        background: 'linear-gradient(145deg, #fffaf0, #f0dfc9)',
        base: '#f0dfc9',
        text: '#584337',
        accent: '#b96f4b',
    },
    {
        id: 'plush',
        name: '轻松熊奶油',
        description: '奶白与可可棕',
        background: 'linear-gradient(168deg, #fffdfb, #efe8e0)',
        base: '#f4efe8',
        text: '#6b5647',
        accent: '#a9866a',
    },
    {
        id: 'mono',
        name: '黑白波点',
        description: '白底炭灰与灰点阵',
        background: '#ffffff',
        base: '#ffffff',
        text: '#3c3a38',
        accent: '#57524e',
    },
    {
        id: 'sakura',
        name: '樱桃牛乳',
        description: '浅粉与莓果红',
        background: 'linear-gradient(145deg, #fff3f7, #f5dce8)',
        base: '#f5dce8',
        text: '#623d50',
        accent: '#c85d8b',
    },
    {
        id: 'mint',
        name: '薄荷清晨',
        description: '雾绿与深松石',
        background: 'linear-gradient(145deg, #ecfbf5, #cee9df)',
        base: '#cee9df',
        text: '#284b46',
        accent: '#2c9a83',
    },
    {
        id: 'twilight',
        name: '暮光紫',
        description: '柔紫与月光白',
        background: 'linear-gradient(145deg, #352747, #191321)',
        base: '#191321',
        text: '#f6edff',
        accent: '#d3a7ff',
    },
    {
        id: 'midnight',
        name: '午夜青',
        description: '墨蓝与冷青光',
        background: 'linear-gradient(145deg, #14252d, #071117)',
        base: '#071117',
        text: '#edfafa',
        accent: '#70d9cf',
    },
];

function hexToRgba(hex: string, alpha: number): string {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
    const value = Number.parseInt(match[1], 16);
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function resolveScheduleCardPalette(
    appearance: ScheduleCardAppearance | undefined,
    hue: number = 260,
    fallbackText: string = '#ffffff',
): ScheduleCardPalette {
    const presetId = appearance?.preset || 'original';
    if (presetId === 'original') {
        const accent = `hsl(${hue}, 70%, 65%)`;
        return {
            preset: 'original',
            background: `linear-gradient(145deg, hsl(${hue}, 40%, 12%), hsl(${hue}, 35%, 8%))`,
            base: `hsl(${hue}, 40%, 12%)`,
            text: fallbackText,
            accent,
            accentSoft: `hsla(${hue}, 70%, 55%, 0.28)`,
            line: 'rgba(255,255,255,0.16)',
            isOriginal: true,
        };
    }

    const preset = presetId === 'custom'
        ? null
        : SCHEDULE_CARD_PRESETS.find(item => item.id === presetId) || SCHEDULE_CARD_PRESETS[0];
    const background = preset?.background || appearance?.background || '#21192b';
    const base = preset?.base || appearance?.background || '#21192b';
    const text = preset?.text || appearance?.textColor || '#f8f3ff';
    const accent = preset?.accent || appearance?.accentColor || '#c9a7ff';
    return {
        preset: presetId,
        background,
        base,
        text,
        accent,
        accentSoft: hexToRgba(accent, 0.18),
        line: hexToRgba(text, 0.16),
        isOriginal: false,
    };
}


/**
 * 「轻松熊奶油」桌面主题配套 CSS。
 * 只用静态渐变 / 点阵背景和细边框，刻意不用 backdrop-filter、blur、大面积 filter，
 * 这类效果在手机上会让合成层持续重绘、机身发烫。
 */
export const PLUSH_BEAR_SCHEDULE_CSS = `/* 轻松熊奶油 · 日程卡（无毛玻璃，纯静态渲染） */
.sully-schedule-root{
  --schedule-bg:linear-gradient(168deg,#fffdfb,#efe8e0)!important;
  --schedule-base:#f4efe8!important;
  --schedule-text:#6b5647!important;
  --schedule-accent:#a9866a!important;
  --schedule-accent-soft:rgba(169,134,106,.15)!important;
  --schedule-line:rgba(107,86,71,.13)!important;
  background:radial-gradient(circle at 1px 1px,rgba(150,124,101,.11) 1px,transparent 1.7px) 0 0/11px 11px,linear-gradient(168deg,#fffdfb,#f5f0ea 58%,#efe8e0)!important;
  color:#6b5647!important;
  border:1px solid rgba(107,86,71,.12)!important;
  border-radius:24px!important;
  box-shadow:0 5px 16px rgba(124,99,78,.10),inset 0 1px 0 #fff!important;
  backdrop-filter:none!important;
  -webkit-backdrop-filter:none!important;
}
/* 关掉暗色版遗留的角落光晕、左侧竖条和整块模糊底图（同时省电） */
.sully-schedule-root div[class*="opacity-25"],
.sully-schedule-root div[class*="-top-12"],
.sully-schedule-root div[class*="-top-10"],
.sully-schedule-root div[class*="w-[3px]"]{display:none!important;}
.sully-schedule-widget > img[class*="inset-0"]{opacity:.13!important;filter:saturate(.5)!important;}
/* 头部：奶茶色小标题 + 细虚线 */
.sully-schedule-header{opacity:1!important;}
.sully-schedule-header div[class*="h-px"]{background:transparent!important;opacity:1!important;height:0!important;border-top:1px dashed rgba(107,86,71,.26)!important;}
.sully-schedule-header span{letter-spacing:.2em!important;}
.sully-schedule-time{color:#a08a76!important;opacity:1!important;filter:none!important;}
/* 正在进行的事 */
.sully-schedule-activity{color:#5c4839!important;font-weight:800!important;text-shadow:none!important;filter:none!important;}
.sully-schedule-description{color:#9c8674!important;opacity:1!important;}
/* NOW 徽标 */
.sully-schedule-widget span[class*="rounded-full"]{background:#efe4d8!important;color:#8a6a52!important;border:1px solid rgba(107,86,71,.10)!important;}
/* 右上角角色名：原本淡到看不清，提到和描述同一档 */
.sully-schedule-widget span[class*="max-w-"]{color:#b3a291!important;opacity:1!important;}
/* 角色头像：白描边圆角方块，和桌面图标同一套语言 */
.sully-schedule-widget div[class*="rounded-2xl"]{background:#efe8e0!important;border:2px solid #fff!important;border-radius:26%!important;box-shadow:0 3px 9px rgba(124,99,78,.16)!important;}
/* 右下展开按钮 */
.sully-schedule-widget div[class*="w-8"],.sully-schedule-widget div[class*="w-6"]{background:#fff!important;border:1px solid rgba(107,86,71,.10)!important;color:#a9866a!important;opacity:1!important;box-shadow:0 2px 6px rgba(124,99,78,.10)!important;}
/* 底部时间线：去掉发光，改成奶油小条 */
.sully-schedule-timeline div{border-radius:99px!important;box-shadow:none!important;}
.sully-schedule-timeline span{color:#a3907e!important;font-weight:700!important;}
/* 完整日程卡 */
.sully-schedule-card{box-shadow:0 8px 26px rgba(124,99,78,.13)!important;}
.sully-schedule-cover img{opacity:.55!important;}
.sully-schedule-item{border-color:rgba(107,86,71,.10)!important;}
.sully-schedule-item-current{background:#fbf6f0!important;border-radius:14px!important;box-shadow:inset 0 0 0 1px rgba(169,134,106,.26)!important;}
/* 设置齿轮 */
.sully-schedule-settings{background:#fff!important;color:#a9866a!important;border-color:rgba(107,86,71,.12)!important;}`;


/**
 * 「黑白波点」桌面挂件风：白底灰点 + 炭灰粗描边（描边上再压一层白点）+ 胶囊标签。
 * 粗边框和边框上的白点用 background-clip 的 padding-box / border-box 两层实现，
 * 不额外加节点，也不用 blur / 动画。封面和头像的 grayscale 是一次性静态滤镜。
 */
export const MONO_DOT_SCHEDULE_CSS = `/* 黑白波点 · 日程卡（白底灰点 + 炭灰粗边） */
.sully-schedule-root{
  --schedule-bg:#ffffff!important;
  --schedule-base:#ffffff!important;
  --schedule-text:#3c3a38!important;
  --schedule-accent:#57524e!important;
  --schedule-accent-soft:rgba(60,58,56,.10)!important;
  --schedule-line:rgba(60,58,56,.16)!important;
  background:
    radial-gradient(circle at 1px 1px,rgba(88,84,80,.22) 1.1px,transparent 1.7px) 0 0/12px 12px padding-box,
    linear-gradient(#fff,#fff) padding-box,
    radial-gradient(circle at 3px 3px,rgba(255,255,255,.9) 1.5px,transparent 2.1px) 0 0/9px 9px border-box,
    linear-gradient(#3c3a38,#3c3a38) border-box!important;
  color:#3c3a38!important;
  border:6px solid transparent!important;
  border-radius:30px!important;
  box-shadow:0 6px 18px rgba(40,38,36,.14)!important;
  backdrop-filter:none!important;
  -webkit-backdrop-filter:none!important;
}
/* 暗色版遗留的光晕、竖条、大面积模糊底图一律去掉 */
.sully-schedule-root div[class*="opacity-25"],
.sully-schedule-root div[class*="-top-12"],
.sully-schedule-root div[class*="-top-10"],
.sully-schedule-root div[class*="w-[3px]"]{display:none!important;}
.sully-schedule-widget > img[class*="inset-0"]{opacity:.12!important;filter:grayscale(1)!important;}
/* 头部：两枚胶囊标签 + 虚线 */
.sully-schedule-header{opacity:1!important;}
.sully-schedule-header span{
  background:#fff!important;color:#3c3a38!important;
  border:2px solid #3c3a38!important;border-radius:999px!important;
  padding:2px 10px!important;letter-spacing:.14em!important;opacity:1!important;
}
.sully-schedule-header div[class*="h-px"]{
  background:transparent!important;opacity:1!important;height:0!important;
  border-top:2px dotted rgba(60,58,56,.28)!important;
}
.sully-schedule-time{color:#3c3a38!important;opacity:1!important;filter:none!important;}
/* 正在进行的事 */
.sully-schedule-activity{color:#2f2d2b!important;font-weight:800!important;text-shadow:none!important;filter:none!important;}
.sully-schedule-description{color:#8a8480!important;opacity:1!important;}
/* NOW 徽标：深色实心，对应参考图里选中的那枚标签 */
.sully-schedule-widget span[class*="rounded-full"]{
  background:#3c3a38!important;color:#fff!important;border:2px solid #3c3a38!important;
}
/* 右上角角色名 */
.sully-schedule-widget span[class*="max-w-"]{color:#9a938e!important;opacity:1!important;}
/* 角色头像：圆形 + 浅灰环 */
.sully-schedule-widget div[class*="rounded-2xl"]{
  background:#f1efed!important;border:3px solid #d9d5d1!important;border-radius:50%!important;
  box-shadow:none!important;
}
.sully-schedule-widget div[class*="rounded-2xl"] img{filter:grayscale(1)!important;}
/* 右下展开按钮 */
.sully-schedule-widget div[class*="w-8"],.sully-schedule-widget div[class*="w-6"]{
  background:#fff!important;border:2px solid #3c3a38!important;color:#3c3a38!important;opacity:1!important;
}
/* 底部时间线 */
.sully-schedule-timeline div{border-radius:999px!important;box-shadow:none!important;}
.sully-schedule-timeline span{color:#8a8480!important;font-weight:700!important;}
/* 完整日程卡 */
.sully-schedule-card{box-shadow:0 8px 26px rgba(40,38,36,.16)!important;}
.sully-schedule-cover img{opacity:.8!important;filter:grayscale(1)!important;}
.sully-schedule-item{
  background:#f5f4f2!important;border:1px solid #e4e1de!important;border-radius:14px!important;
}
.sully-schedule-item-current{
  background:#fff!important;border-radius:14px!important;
  box-shadow:inset 0 0 0 2px #3c3a38!important;
}
/* 设置齿轮 */
.sully-schedule-settings{background:#fff!important;color:#3c3a38!important;border:2px solid #3c3a38!important;}`;

/** 皮肤预设最多存这么多条，避免主题记录无限膨胀。 */
export const SCHEDULE_SKIN_PRESET_LIMIT = 24;

export function makeScheduleSkinPresetId(): string {
    return `sched_skin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 从当前外观草稿生成一条预设（配色 + CSS 一起存）。 */
export function buildScheduleSkinPreset(
    name: string,
    appearance: ScheduleCardAppearance | undefined,
    existing?: ScheduleCardSkinPreset,
): ScheduleCardSkinPreset {
    return {
        id: existing?.id || makeScheduleSkinPresetId(),
        name: name.trim(),
        css: appearance?.customCss || '',
        preset: appearance?.preset || 'original',
        background: appearance?.background,
        textColor: appearance?.textColor,
        accentColor: appearance?.accentColor,
        updatedAt: Date.now(),
    };
}

/**
 * 保存 / 覆盖一条预设。同名视为覆盖，避免列表里堆出一排「奶油熊」。
 * 名称为空或超出上限时返回 error，由调用方 toast。
 */
export function upsertScheduleSkinPreset(
    presets: ScheduleCardSkinPreset[] | undefined,
    name: string,
    appearance: ScheduleCardAppearance | undefined,
): { presets: ScheduleCardSkinPreset[]; preset: ScheduleCardSkinPreset } | { error: string } {
    const trimmed = (name || '').trim();
    if (!trimmed) return { error: '先给这套皮肤起个名字。' };
    const list = presets || [];
    const existing = list.find(item => item.name === trimmed);
    if (!existing && list.length >= SCHEDULE_SKIN_PRESET_LIMIT) {
        return { error: `预设最多保存 ${SCHEDULE_SKIN_PRESET_LIMIT} 套，先删掉几套再存。` };
    }
    const preset = buildScheduleSkinPreset(trimmed, appearance, existing);
    return {
        presets: existing ? list.map(item => (item.id === existing.id ? preset : item)) : [...list, preset],
        preset,
    };
}

/** 重命名一条预设。空名字或撞上别的预设名都会被拦下，交给调用方 toast。 */
export function renameScheduleSkinPreset(
    presets: ScheduleCardSkinPreset[] | undefined,
    id: string,
    name: string,
): { presets: ScheduleCardSkinPreset[] } | { error: string } {
    const trimmed = (name || '').trim();
    if (!trimmed) return { error: '预设名字不能是空的。' };
    const list = presets || [];
    const target = list.find(item => item.id === id);
    if (!target) return { error: '这套预设已经不在了。' };
    if (list.some(item => item.id !== id && item.name === trimmed)) {
        return { error: `已经有一套叫「${trimmed}」了，换个名字。` };
    }
    return {
        presets: list.map(item =>
            item.id === id ? { ...item, name: trimmed, updatedAt: Date.now() } : item),
    };
}

export function removeScheduleSkinPreset(
    presets: ScheduleCardSkinPreset[] | undefined,
    id: string,
): ScheduleCardSkinPreset[] {
    return (presets || []).filter(item => item.id !== id);
}

/** 套用预设：配色和 CSS 一起换，预设列表本身保持不动。 */
export function applyScheduleSkinPreset(
    appearance: ScheduleCardAppearance | undefined,
    preset: ScheduleCardSkinPreset,
): ScheduleCardAppearance {
    return {
        ...appearance,
        preset: preset.preset || 'original',
        background: preset.background,
        textColor: preset.textColor,
        accentColor: preset.accentColor,
        customCss: preset.css,
        skinPresetId: preset.id,
        skinPresets: appearance?.skinPresets,
    };
}

export const SCHEDULE_CSS_SCOPE_REGEX = /^\.sully-schedule-[\w-]+\b/;

export const SCHEDULE_CSS_SCOPE_HINT = '`.sully-schedule-*`';
