import { DB } from './db';

export const MESSAGING_THEME_STATE_ASSET_ID = 'messaging_theme_state_v1';
export const MESSAGING_LIST_PREFS_ASSET_ID = 'messaging_list_prefs_v1';
export const MESSAGING_PROFILE_ASSET_ID = 'messaging_profile_v1';

export interface MessagingThemePreset {
    id: string;
    name: string;
    css: string;
    createdAt: number;
    updatedAt: number;
}

export interface MessagingThemeState {
    version: 1;
    css: string;
    activePresetId: string | null;
    presets: MessagingThemePreset[];
}

export interface MessagingListPrefs {
    version: 1;
    pinnedCharacterIds: string[];
    groupingEnabled: boolean;
    groupButtonHidden: boolean;
    collapsedGroupIds: string[];
}

export interface MessagingProfile {
    version: 1;
    name: string;
    avatar: string;
    cover: string;
    handle: string;
    signature: string;
    birthday: string;
    gender: string;
    virtualLocation: string;
    realLocation: string;
    hobbies: string[];
    about: string;
}

export const makeDefaultMessagingProfile = (source?: Partial<MessagingProfile> & { bio?: string }): MessagingProfile => ({
    version: 1,
    name: String(source?.name || '我'),
    avatar: String(source?.avatar || ''),
    cover: String(source?.cover || ''),
    handle: String(source?.handle || ''),
    signature: String(source?.signature || ''),
    birthday: String(source?.birthday || ''),
    gender: String(source?.gender || ''),
    virtualLocation: String(source?.virtualLocation || ''),
    realLocation: String(source?.realLocation || ''),
    hobbies: Array.isArray(source?.hobbies) ? source!.hobbies!.map(String).filter(Boolean).slice(0, 24) : [],
    about: String(source?.about || source?.bio || ''),
});

export const EMPTY_MESSAGING_THEME_STATE: MessagingThemeState = {
    version: 1,
    css: '',
    activePresetId: null,
    presets: [],
};

export const DEFAULT_MESSAGING_LIST_PREFS: MessagingListPrefs = {
    version: 1,
    pinnedCharacterIds: [],
    groupingEnabled: true,
    groupButtonHidden: false,
    collapsedGroupIds: [],
};

export const BUILT_IN_MESSAGING_THEMES: Array<Pick<MessagingThemePreset, 'id' | 'name' | 'css'>> = [
    {
        id: 'builtin-cream',
        name: '奶油咖啡馆',
        css: `:root {
  --nj-msg-bg: #fffaf3;
  --nj-msg-text: #4b372d;
  --nj-msg-text-muted: #9a7f70;
  --nj-msg-card-bg: rgba(255,255,255,.72);
  --nj-msg-card-bg-pinned: #f9ead8;
  --nj-msg-card-radius: 16px;
  --nj-msg-card-border: 1px solid rgba(126,88,62,.10);
  --nj-msg-avatar-radius: 14px;
  --nj-msg-tabbar-bg: rgba(255,250,243,.9);
  --nj-msg-tabbar-active: #9b6b4a;
}
.nj-chat-item { margin: 7px 14px; box-shadow: 0 6px 20px rgba(93,65,45,.06); }
.nj-chat-tab-search { border: 1px solid rgba(126,88,62,.10); }`,
    },
    {
        id: 'builtin-night',
        name: '深夜玻璃',
        css: `:root {
  --nj-msg-bg: linear-gradient(160deg,#171827,#25233d);
  --nj-msg-text: #f8f7ff;
  --nj-msg-text-muted: rgba(235,232,255,.62);
  --nj-msg-text-time: rgba(235,232,255,.45);
  --nj-msg-card-bg: rgba(255,255,255,.06);
  --nj-msg-card-bg-pinned: rgba(134,118,255,.13);
  --nj-msg-card-radius: 18px;
  --nj-msg-card-border: 1px solid rgba(255,255,255,.08);
  --nj-msg-tabbar-bg: rgba(24,24,40,.76);
  --nj-msg-tabbar-active: #c4b8ff;
  --nj-msg-tabbar-inactive: rgba(255,255,255,.42);
}
.nj-chat-item { margin: 8px 14px; backdrop-filter: blur(14px); }
.nj-chat-tab-search { border: 1px solid rgba(255,255,255,.08); }`,
    },
    {
        id: 'builtin-minimal',
        name: '极简白',
        css: `:root {
  --nj-msg-bg: #fff;
  --nj-msg-text: #161616;
  --nj-msg-text-muted: #929292;
  --nj-msg-card-bg: transparent;
  --nj-msg-card-bg-pinned: #f7f7f7;
  --nj-msg-card-radius: 0;
  --nj-msg-card-border: 1px solid #f0f0f0;
  --nj-msg-avatar-radius: 50%;
  --nj-msg-tabbar-bg: rgba(255,255,255,.96);
  --nj-msg-tabbar-active: #111;
}
.nj-chat-tab-notes, .nj-chat-tab-decor-top { display: none; }`,
    },
];

const ROOT_SELECTORS = [
    '#messaging-chat-tab',
    '#messaging-moments-tab',
    '#messaging-profile-tab',
    '#messaging-favorites-tab',
    '#messaging-bottom-bar',
];

const OUTER_CONTEXT_RE = /^\s*(\[data-(?:time-of-day|color-scheme|active-tab|prev-tab|tab-anim|view-mode|time-slot|hour)(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]]*))?\])\s*/;
const ROOT_CONTEXT_RE = /^\s*(\[data-(?:scrolled|unread-total|searching|post-count|empty)(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]]*))?\])\s*/;

/**
 * 糯叽机 4.71 messagingCssScope 的同版实现。
 * 这里刻意保留它对逗号、伪元素、媒体查询和语境属性的处理顺序；CSS 兼容的关键不只是类名。
 */
const scopeCssLikeNuojiji471 = (input: string): string => {
    if (!input) return '';
    const atRules: Array<{ raw: string; mediaLike: boolean; braceStart: number }> = [];
    let plain = '';
    let cursor = 0;
    const atRuleRe = /@(?:-webkit-)?(?:keyframes|media|supports)\b/;
    while (cursor < input.length) {
        const rest = input.slice(cursor);
        const match = rest.match(atRuleRe);
        if (!match) { plain += rest; break; }
        plain += rest.slice(0, match.index);
        const start = cursor + (match.index || 0);
        const mediaLike = /^@(?:-webkit-)?(?:media|supports)\b/.test(input.slice(start));
        const brace = input.indexOf('{', start);
        if (brace < 0) { plain += input.slice(start); break; }
        let depth = 0;
        let end = brace;
        do {
            if (input[end] === '{') depth += 1;
            else if (input[end] === '}') depth -= 1;
            end += 1;
        } while (depth > 0 && end < input.length);
        atRules.push({ raw: input.slice(start, end), mediaLike, braceStart: brace - start });
        plain += `\n.__nuo_at_${atRules.length - 1}__{}\n`;
        cursor = end;
    }

    plain = plain.replace(/\/\*[\s\S]*?\*\//g, '');
    plain = plain.replace(/(^|\})\s*([^@{}][^{]*)\{/g, (whole, boundary: string, selectorText: string) => {
        if (/\.__nuo_at_\d+__/.test(selectorText)) return whole;
        const scoped = selectorText.split(',').map(item => item.trim()).filter(Boolean).flatMap(raw => {
            const outer: string[] = [];
            let selector = raw.trim();
            let match: RegExpMatchArray | null;
            while ((match = selector.match(OUTER_CONTEXT_RE))) {
                outer.push(match[1]);
                selector = selector.slice(match[0].length).trim();
            }
            const prefix = outer.length ? `${outer.join('')} ` : '';
            const rootContext: string[] = [];
            while ((match = selector.match(ROOT_CONTEXT_RE))) {
                rootContext.push(match[1]);
                selector = selector.slice(match[0].length).trim();
            }
            const context = rootContext.join('');
            if (selector === ':root' || ((outer.length || rootContext.length) && selector === '')) {
                return ROOT_SELECTORS.map(root => `${prefix}${root}${context}`);
            }
            if (ROOT_SELECTORS.some(root => selector.includes(root))) return [`${prefix}${selector}`];
            let pseudoElement = '';
            const withoutPseudo = selector.replace(/(?:::[\w-]+(?:\([^)]*\))?|:(?:before|after|first-line|first-letter))$/, value => {
                pseudoElement = value;
                return '';
            });
            if (!withoutPseudo) {
                return ROOT_SELECTORS.flatMap(root => [`${prefix}${root}${context}${pseudoElement}`, `${prefix}${root}${context} *${pseudoElement}`]);
            }
            let splitAt = -1;
            let square = 0;
            let round = 0;
            for (let index = 0; index < withoutPseudo.length; index += 1) {
                const char = withoutPseudo[index];
                if (char === '[') square += 1;
                else if (char === ']') square -= 1;
                else if (char === '(') round += 1;
                else if (char === ')') round -= 1;
                else if (square === 0 && round === 0 && /[\s>+~]/.test(char)) { splitAt = index; break; }
            }
            const first = splitAt > 0 ? withoutPseudo.slice(0, splitAt) : withoutPseudo;
            const tail = splitAt > 0 ? withoutPseudo.slice(splitAt) : '';
            return ROOT_SELECTORS.flatMap(root => [
                `${prefix}:is(${root}${context}${first})${tail}${pseudoElement}`,
                `${prefix}${root}${context} ${withoutPseudo}${pseudoElement}`,
            ]);
        }).join(', ');
        return scoped ? `${boundary} ${scoped} {` : whole;
    });

    return plain.replace(/\.__nuo_at_(\d+)__\{\}/g, (_whole, indexText: string) => {
        const rule = atRules[Number(indexText)];
        if (!rule) return '';
        if (!rule.mediaLike) return rule.raw;
        return `${rule.raw.slice(0, rule.braceStart + 1)}\n${scopeCssLikeNuojiji471(rule.raw.slice(rule.braceStart + 1, -1))}\n}`;
    });
};

export const validateMessagingCss = (css: string): { valid: true } | { valid: false; error: string } => {
    if (css.length > 300_000) return { valid: false, error: 'CSS 过大，请控制在 300 KB 以内。' };
    const forbidden: Array<[RegExp, string]> = [
        [/@import\b/i, '不支持 @import 远程样式表，请直接粘贴 CSS 内容。'],
        [/javascript\s*:/i, 'CSS 中不能包含 javascript: 协议。'],
        [/expression\s*\(/i, 'CSS 中不能包含 expression()。'],
        [/-moz-binding\s*:/i, 'CSS 中不能包含 -moz-binding。'],
        [/<\s*\/\s*style/i, 'CSS 中不能包含 </style>。'],
    ];
    for (const [pattern, error] of forbidden) if (pattern.test(css)) return { valid: false, error };
    return { valid: true };
};

export const scopeMessagingCss = (css: string): string => {
    const validation = validateMessagingCss(css);
    if (!validation.valid) throw new Error(validation.error);
    return scopeCssLikeNuojiji471(css);
};

const normalizePreset = (value: unknown): MessagingThemePreset | null => {
    if (!value || typeof value !== 'object') return null;
    const preset = value as Partial<MessagingThemePreset>;
    if (typeof preset.id !== 'string' || !preset.id || typeof preset.name !== 'string' || typeof preset.css !== 'string') return null;
    return {
        id: preset.id,
        name: preset.name.trim() || '未命名预设',
        css: preset.css.slice(0, 300_000),
        createdAt: Number(preset.createdAt) || Date.now(),
        updatedAt: Number(preset.updatedAt) || Number(preset.createdAt) || Date.now(),
    };
};

export const loadMessagingThemeState = async (): Promise<MessagingThemeState> => {
    const raw = await DB.getAssetRaw(MESSAGING_THEME_STATE_ASSET_ID).catch(() => null) as Partial<MessagingThemeState> | null;
    if (!raw || raw.version !== 1) return { ...EMPTY_MESSAGING_THEME_STATE };
    const presets = Array.isArray(raw.presets) ? raw.presets.map(normalizePreset).filter((item): item is MessagingThemePreset => !!item) : [];
    const activePresetId = typeof raw.activePresetId === 'string' && presets.some(item => item.id === raw.activePresetId)
        ? raw.activePresetId
        : null;
    return {
        version: 1,
        css: typeof raw.css === 'string' ? raw.css.slice(0, 300_000) : '',
        activePresetId,
        presets,
    };
};

export const saveMessagingThemeState = async (state: MessagingThemeState): Promise<void> => {
    await DB.saveAssetRaw(MESSAGING_THEME_STATE_ASSET_ID, state);
};

export const loadMessagingListPrefs = async (): Promise<MessagingListPrefs> => {
    const raw = await DB.getAssetRaw(MESSAGING_LIST_PREFS_ASSET_ID).catch(() => null) as Partial<MessagingListPrefs> | null;
    if (!raw || raw.version !== 1) return { ...DEFAULT_MESSAGING_LIST_PREFS };
    return {
        version: 1,
        pinnedCharacterIds: Array.isArray(raw.pinnedCharacterIds) ? raw.pinnedCharacterIds.map(String) : [],
        groupingEnabled: raw.groupingEnabled !== false,
        groupButtonHidden: raw.groupButtonHidden === true,
        collapsedGroupIds: Array.isArray(raw.collapsedGroupIds) ? raw.collapsedGroupIds.map(String) : [],
    };
};

export const saveMessagingListPrefs = async (prefs: MessagingListPrefs): Promise<void> => {
    await DB.saveAssetRaw(MESSAGING_LIST_PREFS_ASSET_ID, prefs);
};

export const loadMessagingProfile = async (fallback: Partial<MessagingProfile> & { bio?: string }): Promise<MessagingProfile> => {
    const raw = await DB.getAssetRaw(MESSAGING_PROFILE_ASSET_ID).catch(() => null) as Partial<MessagingProfile> | null;
    return makeDefaultMessagingProfile(raw?.version === 1 ? { ...fallback, ...raw } : fallback);
};

export const saveMessagingProfile = async (profile: MessagingProfile): Promise<void> => {
    await DB.saveAssetRaw(MESSAGING_PROFILE_ASSET_ID, makeDefaultMessagingProfile(profile));
};

export const makeMessagingPresetId = (): string => `msg_theme_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const messagingTimeSlot = (hour: number): string => {
    if (hour < 5) return 'lateNight';
    if (hour < 9) return 'dawn';
    if (hour < 12) return 'morning';
    if (hour < 14) return 'noon';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
};

export const messagingUnreadBucket = (count: number): '0' | '1' | 'few' | 'many' => {
    if (count <= 0) return '0';
    if (count === 1) return '1';
    if (count < 10) return 'few';
    return 'many';
};

export const messagingLengthBucket = (text: string): 'short' | 'medium' | 'long' => {
    if (text.length <= 12) return 'short';
    if (text.length <= 40) return 'medium';
    return 'long';
};

