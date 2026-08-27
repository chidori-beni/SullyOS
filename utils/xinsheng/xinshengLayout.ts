// 心声「布局模板」DSL 的解析器。
//
// ⚠️ 这份文件是**兼容层**，不是我们自己设计的语法。它和糯叽机 4.64 的
// `XinshengLayoutRenderer` 逐条对齐（指令名、参数位数、默认值、截断上限、
// 大小写与连字符归一化规则）。论坛上流通的心声美化是「布局 + CSS」成对分发的，
// 布局这边差一个默认值，别人的 CSS 就选不中元素 —— 所以这里的每一个
// `|| 'charImage'`、每一个 `Math.min(x, 6)` 都是契约，不要「顺手优化」。
//
// 语法总览（详见 docs/xinsheng.md）：
//   @指令 参数1 "带空格的参数" .动画.delay200
//   缩进两格以上的行 = 归属上一个容器指令的子项
//   # 开头 = 注释
//
// 渲染在 components/chat/xinsheng/XinshengLayoutRenderer.tsx，DOM 类名契约同样一比一。

/** 动画修饰符（`.fadeInUp.delay200` → ['fadeInUp','delay200']），渲染成 `xt-anim-*` 类名。 */
export type XinshengAnims = string[];

/** 容器指令的子项：不同容器解析出的形状不同，见 parseChild。 */
export interface XinshengChild {
    field?: string;
    subtype?: string;
    label?: string;
    side?: string;
    literal?: string;
    key?: string;
    segs?: XinshengCell[];
    cells?: XinshengCell[];
}

/** timeline / table 的单元格：要么是字面量，要么是字段引用。 */
export interface XinshengCell {
    literal?: string;
    field?: string;
}

/** @if 的单个条件（`@if a > 1 and b contains x` 会拆成多个）。 */
export interface XinshengCond {
    field: string;
    op: string;
    value: string;
    /** 仅 `between` 用：`@if mood between 40 70` 的上界。 */
    value2?: string;
}

export interface XinshengNode {
    type: string;
    anims: XinshengAnims;
    children?: XinshengNode[] | XinshengChild[];
    // —— 各指令自己的字段（用可选属性摊平，避免几十个 interface 的联合）——
    field?: string;
    fieldA?: string;
    fieldB?: string;
    label?: string;
    labelA?: string;
    labelB?: string;
    imageField?: string;
    nameField?: string;
    image1?: string;
    name1?: string;
    image2?: string;
    name2?: string;
    suffix?: string;
    title?: string;
    text?: string;
    columns?: number;
    height?: number;
    index?: number;
    toggleIndex?: number;
    max?: number;
    effect?: string;
    char?: string;
    count?: number;
    mode?: string;
    op?: string;
    value?: string;
    value2?: string;
    conds?: XinshengCond[];
    joiner?: 'and' | 'or';
    elseChildren?: XinshengNode[] | null;
    inElse?: boolean;
}

/** 会被 parseLayout 接受的指令名（已做 lowercase + 去连字符归一化）。 */
export const XINSHENG_DIRECTIVES = [
    'header', 'duo', 'duoheader', 'badge', 'section', 'text', 'quote', 'grid', 'bar', 'ring',
    'list', 'tags', 'bubbles', 'marquee', 'particles', 'divider', 'spacer', 'image', 'footer',
    'toggle', 'row', 'columns', 'card', 'collapse', 'gauge', 'sparkline', 'spark', 'rating',
    'stars', 'timeline', 'table', 'kv', 'keyvalue', 'each', 'foreach', 'endeach', 'bg',
    'background', 'wave', 'compare', 'heatmap', 'if', 'else', 'endif', 'endrow', 'endcard',
    'endcollapse', 'end',
] as const;

/** 会把子行「吃」进去的容器（缩进行归属它们）。 */
const INLINE_CONTAINERS = ['section', 'grid', 'list', 'bubbles', 'tags', 'timeline', 'table', 'kv'];
/** 需要显式 `@end*` 收尾的块级容器。 */
const BLOCK_CONTAINERS = ['row', 'card', 'collapse', 'conditional', 'each'];

/**
 * 按空格切参数，但双引号内的空格保留。
 *
 * 糯叽机的原始实现有个副作用值得保留：遇到开引号时会先把已累积的裸词 push 出去，
 * 所以 `a"b c"` 会切成 ['a', 'b c'] 而不是 ['ab c']。美化作者写
 * `@grid 3` 的子行 `mood:stat"心情"`（漏了空格）时靠的就是这个宽容。
 */
export const splitArgs = (input: string): string[] => {
    const out: string[] = [];
    let buf = '';
    let inQuote = false;
    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        if (ch === '"') {
            if (inQuote) {
                // 闭合引号：即使内容是空串也 push，`@badge x ""` 的空后缀要保留位次
                out.push(buf);
                buf = '';
                inQuote = false;
            } else {
                if (buf.trim()) out.push(buf.trim());
                buf = '';
                inQuote = true;
            }
        } else if ((ch === ' ' || ch === '\t') && !inQuote) {
            if (buf.trim()) out.push(buf.trim());
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
};

/** 去掉整体包裹的成对引号（单双都认），内部引号不动。 */
export const unquote = (raw: string): string => {
    const t = raw.trim();
    const wrapped = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
    return wrapped ? t.slice(1, -1) : t;
};

/** timeline / table 的单元格：带引号 = 固定文字，否则 = 字段名。 */
const parseCell = (raw: string): XinshengCell => {
    const t = (raw || '').trim();
    if (!t) return { literal: '' };
    const wrapped = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
    return wrapped ? { literal: t.slice(1, -1) } : { field: t };
};

/**
 * 把尾部的 `.动画.delay200` 摘出来。
 *
 * 只认「空白 + 点 + 字母开头」的连串，所以 `@text a.b`（字段名里带点）不会被误伤，
 * 而 `@text a .b` 会。这与糯叽机一致。
 */
const takeAnims = (args: string): { cleanArgs: string; anims: XinshengAnims } => {
    if (!args) return { cleanArgs: '', anims: [] };
    const m = args.match(/(\s+\.[a-zA-Z]\w*(?:\.[a-zA-Z]\w*)*)$/);
    if (!m) return { cleanArgs: args, anims: [] };
    return {
        cleanArgs: args.slice(0, -m[1].length).trim(),
        anims: m[1].trim().split('.').filter(Boolean),
    };
};

/** `@if a > 1 and b contains x` → 条件数组 + 连接词。同一行里 or 优先判定（有 or 就整行按 or）。 */
const parseConditions = (raw: string): { conds: XinshengCond[]; joiner: 'and' | 'or' } => {
    const t = (raw || '').trim();
    if (!t) return { conds: [], joiner: 'and' };
    const joiner: 'and' | 'or' = /\s(?:or|\|\|)\s/i.test(t) ? 'or' : 'and';
    const conds = t
        .split(/\s+(?:and|or|&&|\|\|)\s+/i)
        .map((part): XinshengCond => {
            const toks = splitArgs(part.trim());
            const field = toks[0] || '';
            const op = toks[1] || '';
            if (op.toLowerCase() === 'between') {
                return { field, op: 'between', value: toks[2] || '', value2: toks[3] || '' };
            }
            // 值可能带空格（`@if mood = 有点难过`），剩下的全部拼回去再脱一次引号
            return { field, op, value: toks.slice(2).join(' ').replace(/^"|"$/g, '') };
        })
        .filter(c => !!c.field);
    return { conds, joiner };
};

/**
 * 解析一条 `@指令` 行。认不出返回 null（整行被静默丢弃，与糯叽机一致 ——
 * 报错留给 validateLayout 在编辑器里做，渲染时不该因为一行写错就整卡空白）。
 */
export const parseDirective = (line: string): XinshengNode | null => {
    const m = line.match(/^@([\w-]+)\s*(.*)?$/);
    if (!m) return null;
    const name = m[1].toLowerCase().replace(/-/g, '');
    const rawArgs = (m[2] || '').trim();
    const { cleanArgs: args, anims } = takeAnims(rawArgs);

    switch (name) {
        case 'header': {
            const a = splitArgs(args);
            return { type: 'header', imageField: a[0] || 'charImage', nameField: a[1] || 'charName', anims };
        }
        case 'badge': {
            const a = splitArgs(args);
            return { type: 'badge', field: a[0] || '', suffix: a[1] || '', anims };
        }
        case 'section':
            return { type: 'section', title: unquote(args), children: [], anims };
        case 'text':
            return { type: 'text', field: args.trim(), anims };
        case 'grid': {
            const n = parseInt(args, 10) || 3;
            return { type: 'grid', columns: Math.min(n, 6), children: [], anims };
        }
        case 'bar': {
            const a = splitArgs(args);
            return { type: 'bar', field: a[0] || '', label: a[1] || '', anims };
        }
        case 'list':
            return { type: 'list', children: [], anims };
        case 'bubbles':
            return { type: 'bubbles', children: [], anims };
        case 'divider':
            return { type: 'divider', anims };
        case 'spacer':
            return { type: 'spacer', height: parseInt(args, 10) || 16, anims };
        case 'image':
            return { type: 'image', field: args.trim() || 'charImage', anims };
        case 'footer':
            return { type: 'footer', text: unquote(args), anims };
        case 'toggle': {
            const n = parseInt(args, 10) || 1;
            return { type: 'toggle', index: Math.min(Math.max(n, 1), 8), anims };
        }
        case 'duo':
        case 'duoheader': {
            const a = splitArgs(args);
            return {
                type: 'duo',
                image1: a[0] || 'charImage',
                name1: a[1] || 'charName',
                image2: a[2] || 'userImage',
                name2: a[3] || 'userName',
                anims,
            };
        }
        case 'quote':
            return { type: 'quote', field: args.trim(), anims };
        case 'tags':
            return { type: 'tags', children: [], anims };
        case 'ring': {
            const a = splitArgs(args);
            return { type: 'ring', field: a[0] || '', label: a[1] || '', anims };
        }
        case 'marquee':
            return { type: 'marquee', field: args.trim(), anims };
        case 'particles': {
            // 参数无序：纯数字 = 数量，纯字母 = 效果名，其它 = 自订字元（取前 2 个码点）
            const a = splitArgs(args);
            let effect = 'snow';
            let count = 25;
            let char = '';
            for (const rawTok of a) {
                const tok = String(rawTok).trim();
                if (!tok) continue;
                if (/^[0-9]+$/.test(tok)) {
                    count = parseInt(tok, 10);
                } else if (!/^[a-z]+$/i.test(tok) || char) {
                    char = Array.from(tok).slice(0, 2).join('');
                } else {
                    effect = tok.toLowerCase();
                }
            }
            // 只给了字元没给效果名 → 自动切到 emoji 效果
            if (char && effect === 'snow') effect = 'emoji';
            return { type: 'particles', effect, char, count: Math.min(Math.max(count, 1), 50), anims };
        }
        case 'bg':
        case 'background': {
            const a = splitArgs(args);
            return { type: 'bg', field: a[0] || '', mode: (a[1] || '').toLowerCase(), anims };
        }
        case 'gauge': {
            const a = splitArgs(args);
            return { type: 'gauge', field: a[0] || '', label: a[1] || '', anims };
        }
        case 'sparkline':
        case 'spark': {
            const a = splitArgs(args);
            return { type: 'sparkline', field: a[0] || '', label: a[1] || '', anims };
        }
        case 'rating':
        case 'stars': {
            const a = splitArgs(args);
            const max = parseInt(a[2], 10) || 5;
            return { type: 'rating', field: a[0] || '', label: a[1] || '', max: Math.min(Math.max(max, 1), 10), anims };
        }
        case 'timeline':
            return { type: 'timeline', children: [], anims };
        case 'table':
            return { type: 'table', children: [], anims };
        case 'kv':
        case 'keyvalue':
            return { type: 'kv', children: [], anims };
        case 'wave': {
            const a = splitArgs(args);
            return { type: 'wave', field: a[0] || '', label: a[1] || '', anims };
        }
        case 'compare': {
            const a = splitArgs(args);
            return {
                type: 'compare',
                fieldA: a[0] || '',
                fieldB: a[1] || '',
                labelA: a[2] || '',
                labelB: a[3] || '',
                anims,
            };
        }
        case 'heatmap': {
            const a = splitArgs(args);
            const cols = parseInt(a[2], 10) || 7;
            return { type: 'heatmap', field: a[0] || '', label: a[1] || '', columns: Math.min(Math.max(cols, 1), 14), anims };
        }
        case 'each':
        case 'foreach':
            return { type: 'each', field: args.trim(), children: [], anims };
        case 'endeach':
        case 'endif':
        case 'endrow':
        case 'endcard':
        case 'endcollapse':
        case 'end':
            // 所有 @end* 等价：只弹栈，不校验配对。写错了顶多提前收口，不会整卡崩。
            return { type: 'endblock', anims: [] };
        case 'row':
        case 'columns': {
            const n = parseInt(args, 10) || 2;
            return { type: 'row', columns: Math.min(n, 6), children: [], anims };
        }
        case 'card':
            return { type: 'card', title: unquote(args), children: [], anims };
        case 'collapse': {
            const a = splitArgs(args);
            const title = a[0] || '';
            const idx = parseInt(a[1], 10) || 1;
            return { type: 'collapse', title, toggleIndex: Math.min(Math.max(idx, 1), 8), children: [], anims };
        }
        case 'if': {
            const { conds, joiner } = parseConditions(args);
            const first = conds[0] || { field: '', op: '', value: '' };
            return {
                type: 'conditional',
                field: first.field,
                op: first.op,
                value: first.value,
                conds,
                joiner,
                children: [],
                elseChildren: null,
                inElse: false,
                // @if 本身不吃动画修饰符（它不渲染成元素）
                anims: [],
            };
        }
        case 'else':
            return { type: 'else', anims: [] };
        default:
            return null;
    }
};

/** 解析容器的缩进子行。同一行文本在不同容器下含义不同，所以要带 parentType。 */
export const parseChild = (line: string, parentType: string): XinshengChild => {
    switch (parentType) {
        case 'grid': {
            // `字段名:类型 "标签"`
            const m = line.match(/^(\w+)(?::(\w+))?\s*(?:"([^"]*)")?$/);
            return m
                ? { field: m[1], subtype: m[2] || 'stat', label: m[3] || '' }
                : { field: line, subtype: 'stat', label: '' };
        }
        case 'list':
            return { field: line.trim() };
        case 'bubbles': {
            const parts = line.split(':');
            return { field: parts[0].trim(), side: (parts[1] || 'left').trim() };
        }
        case 'tags': {
            const t = line.trim();
            const wrapped = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
            return wrapped ? { literal: t.slice(1, -1) } : { field: t };
        }
        case 'timeline':
            return { segs: line.split('|').map(s => parseCell(s.trim())) };
        case 'table':
            return { cells: line.split('|').map(s => parseCell(s.trim())) };
        case 'kv': {
            // 三种写法：`"键" 字段`、`键 : 字段`、`键 字段`
            const t = line.trim();
            let key = '';
            let field = '';
            const colon = t.indexOf(':');
            if (t.startsWith('"') || t.startsWith("'")) {
                const a = splitArgs(t);
                key = a[0] || '';
                field = a[1] || '';
            } else if (colon > 0) {
                key = t.slice(0, colon).trim();
                field = t.slice(colon + 1).trim();
            } else {
                const a = splitArgs(t);
                key = a[0] || '';
                field = a[1] || a[0] || '';
            }
            return { key: unquote(key), field };
        }
        case 'section':
        default:
            return { field: line };
    }
};

/**
 * 把布局文本解析成节点树。
 *
 * 容错策略照抄糯叽机：认不出的 @指令整行丢弃，非 @ 开头的顶格行当作 `@text`，
 * `@end*` 多了就当空操作。编辑器里的报错走 validateLayout，渲染路径永不抛。
 */
export const parseLayout = (source: string): XinshengNode[] => {
    if (!source || typeof source !== 'string') return [];
    const lines = source.split('\n');
    const root: XinshengNode[] = [];
    const stack: XinshengNode[] = [];
    // 当前正在「吃」缩进子行的行内容器（section/grid/list/...）
    let inlineHost: XinshengNode | null = null;

    const push = (node: XinshengNode) => {
        if (stack.length > 0) {
            const top = stack[stack.length - 1];
            if (top.type === 'conditional' && top.inElse) {
                if (!top.elseChildren) top.elseChildren = [];
                (top.elseChildren as XinshengNode[]).push(node);
            } else {
                (top.children as XinshengNode[]).push(node);
            }
        } else {
            root.push(node);
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trimEnd();
        if (!line || line.trim().startsWith('#')) continue;

        // 缩进 ≥2 空格/制表符 且上方有行内容器 → 归属它
        if (/^[ \t]{2,}/.test(raw) && inlineHost) {
            (inlineHost.children as XinshengChild[]).push(parseChild(line.trim(), inlineHost.type));
            continue;
        }
        inlineHost = null;

        const trimmed = line.trim();
        if (!trimmed.startsWith('@')) {
            // 顶格裸文本 = 隐式 @text，让「@section 后面直接写字段名」这种老写法照常工作
            push({ type: 'text', field: trimmed, anims: [] });
            continue;
        }

        const node = parseDirective(trimmed);
        if (!node) continue;

        if (node.type === 'endblock') {
            if (stack.length > 0) stack.pop();
            continue;
        }
        if (node.type === 'else') {
            const top = stack[stack.length - 1];
            if (top && top.type === 'conditional') {
                top.inElse = true;
                top.elseChildren = [];
            }
            continue;
        }

        push(node);
        if (BLOCK_CONTAINERS.includes(node.type)) stack.push(node);
        if (INLINE_CONTAINERS.includes(node.type)) inlineHost = node;
    }

    return root;
};

/**
 * 编辑器用的语法检查：只查「@ 开头的顶格行是不是已知指令」。
 * 返回中文错误串数组（空数组 = 没问题）。
 */
export const validateLayout = (source: string): string[] => {
    if (!source?.trim()) return [];
    const errors: string[] = [];
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (!t || t.startsWith('#') || /^[ \t]{2,}/.test(lines[i]) || !t.startsWith('@')) continue;
        const m = t.match(/^@([\w-]+)/);
        if (!m) {
            errors.push(`第 ${i + 1} 行：无效的指令格式`);
            continue;
        }
        const name = m[1].toLowerCase().replace(/-/g, '');
        if (!(XINSHENG_DIRECTIVES as readonly string[]).includes(name)) {
            errors.push(`第 ${i + 1} 行：未知指令 @${m[1]}（可用：${XINSHENG_DIRECTIVES.join(', ')}）`);
        }
    }
    return errors;
};
