import { DB } from './db';

export const MESSAGING_THEME_STATE_ASSET_ID = 'messaging_theme_state_v1';
export const MESSAGING_LIST_PREFS_ASSET_ID = 'messaging_list_prefs_v1';

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

const CONTEXT_PREFIX = /^\s*((?:\[data-(?:time-of-day|color-scheme|active-tab|prev-tab|tab-anim|view-mode|time-slot|hour|scrolled|unread-total|searching|post-count|empty)(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[^\]]*))?\]\s*)+)/i;

const splitSelectors = (selectorText: string): string[] => {
    const selectors: string[] = [];
    let current = '';
    let square = 0;
    let round = 0;
    let quote = '';
    for (let index = 0; index < selectorText.length; index += 1) {
        const char = selectorText[index];
        if (quote) {
            current += char;
            if (char === quote && selectorText[index - 1] !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === '[') square += 1;
        else if (char === ']') square = Math.max(0, square - 1);
        else if (char === '(') round += 1;
        else if (char === ')') round = Math.max(0, round - 1);
        if (char === ',' && square === 0 && round === 0) {
            if (current.trim()) selectors.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) selectors.push(current.trim());
    return selectors;
};

const firstCombinatorIndex = (selector: string): number => {
    let square = 0;
    let round = 0;
    let quote = '';
    for (let index = 0; index < selector.length; index += 1) {
        const char = selector[index];
        if (quote) {
            if (char === quote && selector[index - 1] !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === '[') square += 1;
        else if (char === ']') square = Math.max(0, square - 1);
        else if (char === '(') round += 1;
        else if (char === ')') round = Math.max(0, round - 1);
        else if (square === 0 && round === 0 && /[\s>+~]/.test(char)) return index;
    }
    return -1;
};

const scopeOneSelector = (rawSelector: string): string[] => {
    let selector = rawSelector.trim();
    if (!selector) return [];
    if (ROOT_SELECTORS.some(root => selector.includes(root)) || selector.includes('.nj-tab-bottom-bar')) {
        return [selector];
    }

    const contextMatch = selector.match(CONTEXT_PREFIX);
    const context = contextMatch?.[1]?.trim() || '';
    if (contextMatch) selector = selector.slice(contextMatch[0].length).trim();
    if (/^(?:html|body)(?:\b|\s|>)/i.test(selector)) {
        selector = selector.replace(/^(?:html|body)\s*/i, '').trim();
    }
    if (!selector || selector === ':root') {
        return ROOT_SELECTORS.map(root => `${context ? `${context} ` : ''}${root}`);
    }

    const combinator = firstCombinatorIndex(selector);
    const first = combinator >= 0 ? selector.slice(0, combinator).trim() : selector;
    const rest = combinator >= 0 ? selector.slice(combinator) : '';
    const results: string[] = [];
    for (const root of ROOT_SELECTORS) {
        const prefix = context ? `${context} ` : '';
        if (/^[.#[:]/.test(first)) results.push(`${prefix}:is(${root}${first})${rest}`);
        results.push(`${prefix}${root} ${selector}`);
    }
    return results;
};

const findMatchingBrace = (css: string, openIndex: number): number => {
    let depth = 0;
    let quote = '';
    let inComment = false;
    for (let index = openIndex; index < css.length; index += 1) {
        const char = css[index];
        const next = css[index + 1];
        if (inComment) {
            if (char === '*' && next === '/') { inComment = false; index += 1; }
            continue;
        }
        if (!quote && char === '/' && next === '*') { inComment = true; index += 1; continue; }
        if (quote) {
            if (char === quote && css[index - 1] !== '\\') quote = '';
            continue;
        }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === '{') depth += 1;
        if (char === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
};

const scopeCssBlock = (css: string): string => {
    let output = '';
    let cursor = 0;
    while (cursor < css.length) {
        const open = css.indexOf('{', cursor);
        if (open < 0) { output += css.slice(cursor); break; }
        const close = findMatchingBrace(css, open);
        if (close < 0) { output += css.slice(cursor); break; }
        const header = css.slice(cursor, open);
        const body = css.slice(open + 1, close);
        const leadingMatch = header.match(/^[\s\S]*?(?=\S)/);
        const leading = leadingMatch?.[0] || '';
        const trimmedHeader = header.slice(leading.length).trim();

        if (trimmedHeader.startsWith('@')) {
            const recurse = /^@(?:media|supports|container|layer)\b/i.test(trimmedHeader);
            output += `${leading}${trimmedHeader}{${recurse ? scopeCssBlock(body) : body}}`;
        } else {
            const scoped = splitSelectors(trimmedHeader).flatMap(scopeOneSelector).join(',\n');
            output += `${leading}${scoped}{${body}}`;
        }
        cursor = close + 1;
    }
    return output;
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

const addWebkitBackdropFilter = (css: string): string => css.replace(
    /(^|[;{]\s*)(backdrop-filter\s*:\s*[^;{}]+)(;?)/gim,
    (match, prefix, declaration, suffix) => {
        if (/-webkit-backdrop-filter\s*:/i.test(match)) return match;
        const value = String(declaration).replace(/^backdrop-filter\s*:\s*/i, '');
        return `${prefix}-webkit-backdrop-filter: ${value}; ${declaration}${suffix}`;
    },
);

export const scopeMessagingCss = (css: string): string => {
    const validation = validateMessagingCss(css);
    if (!validation.valid) throw new Error(validation.error);
    return scopeCssBlock(addWebkitBackdropFilter(css));
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

