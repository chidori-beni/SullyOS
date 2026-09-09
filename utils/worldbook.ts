import type {
    MountedWorldbook,
    Worldbook,
    WorldbookDepthRole,
    WorldbookMode,
    WorldbookPosition,
    WorldbookSelectiveLogic,
} from '../types';

export type WorldbookLike = Worldbook | MountedWorldbook;
export type WorldbookScene = Exclude<WorldbookMode, 'all' | 'schedule'>;
export type WorldbookContextPurpose = 'chat' | 'schedule';

export interface WorldbookResolveOptions {
    /** 解析给普通聊天，还是解析给日程生成。缺省为普通聊天。 */
    contextPurpose?: WorldbookContextPurpose;
}

export interface WorldbookScanMessage {
    role?: string;
    content: unknown;
}

export interface ResolvedWorldbookEntry {
    book: WorldbookLike;
    content: string;
    position: WorldbookPosition;
    order: number;
}

export interface WorldbookSystemSections {
    beforeCharacter: ResolvedWorldbookEntry[];
    afterCharacter: ResolvedWorldbookEntry[];
    authorsNoteTop: ResolvedWorldbookEntry[];
    authorsNoteBottom: ResolvedWorldbookEntry[];
    atDepth: ResolvedWorldbookEntry[];
    beforeExamples: ResolvedWorldbookEntry[];
    afterExamples: ResolvedWorldbookEntry[];
}

export const WORLDBOOK_POSITION_LABELS: Record<WorldbookPosition, string> = {
    0: '角色设定前',
    1: '角色设定后',
    2: '作者注释顶部',
    3: '作者注释底部',
    4: '聊天记录指定深度',
    5: '示例消息前',
    6: '示例消息后',
};

export const WORLDBOOK_POSITION_DESCRIPTIONS: Record<WorldbookPosition, string> = {
    0: '适合放全局规则、基础背景；会出现在角色身份与性格设定之前。',
    1: '适合一般世界观、人物与地点设定；这是旧版世界书一直使用的默认位置。',
    2: '适合放写作方向、语气或节奏要求；位于作者注释内容顶部。',
    3: '适合放作者注释后的补充与强调；比顶部内容更靠后。',
    4: '适合临时状态、近期事件或强提醒；按深度和角色插入聊天记录。',
    5: '适合放阅读示例对话前需要先知道的说明。',
    6: '适合放示例对话结束后的补充说明。',
};

export const WORLDBOOK_ROLE_LABELS: Record<WorldbookDepthRole, string> = {
    0: 'System',
    1: 'User',
    2: 'Assistant',
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const asStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value.map(item => String(item).trim()).filter(Boolean);
};

export const splitWorldbookKeywords = (value: string): string[] => (
    value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean)
);

export const toMountedWorldbook = (book: Worldbook): MountedWorldbook => ({
    id: book.id,
    title: book.title,
    content: book.content,
    category: book.category,
    mountEnabled: true,
    mode: book.mode,
    key: book.key ? [...book.key] : undefined,
    keysecondary: book.keysecondary ? [...book.keysecondary] : undefined,
    constant: book.constant,
    selective: book.selective,
    selectiveLogic: book.selectiveLogic,
    order: book.order,
    position: book.position,
    disable: book.disable,
    probability: book.probability,
    useProbability: book.useProbability,
    depth: book.depth,
    role: book.role,
    scanDepth: book.scanDepth,
    caseSensitive: book.caseSensitive,
    matchWholeWords: book.matchWholeWords,
    sourceUid: book.sourceUid,
    displayOrder: book.displayOrder,
    ...(normalizeWorldbookMode(book.mode) === 'schedule' ? { scheduleOnly: true } : {}),
});

/**
 * 把全局世界书的完整记录投影回角色挂载缓存。
 *
 * mountedWorldbooks 是冗余缓存，不能只手动替换 title/content；世界书 App
 * 还可能同时修改触发词、注入位置和启用状态。没有匹配项时保持原数组引用，
 * 方便调用方避免无意义的角色更新。
 */
export const replaceMountedWorldbook = (
    mountedWorldbooks: MountedWorldbook[],
    worldbook: Worldbook,
    options: { modeIsAuthoritative?: boolean } = {},
): MountedWorldbook[] => {
    if (!mountedWorldbooks.some(book => book.id === worldbook.id)) return mountedWorldbooks;
    return mountedWorldbooks.map(book => {
        if (book.id !== worldbook.id) return book;
        const next = toMountedWorldbook(worldbook);
        // 挂载开关属于角色关系，不随全局世界书编辑一起被重置。
        if (book.mountEnabled === false) next.mountEnabled = false;
        // 旧版角色级标记需要继续可读；用户显式保存新版作用域时，mode 才成为权威，
        // 允许从 schedule 切回 all/online/offline 时清理旧镜像。
        if (!options.modeIsAuthoritative && book.scheduleOnly === true) next.scheduleOnly = true;
        return next;
    });
};

export const normalizeWorldbookMode = (value: unknown): WorldbookMode => (
    value === 'online' || value === 'offline' || value === 'schedule' ? value : 'all'
);

export const WORLDBOOK_MODE_LABELS: Record<WorldbookMode, string> = {
    all: '线上 + 线下',
    online: '仅线上聊天',
    offline: '仅线下见面',
    schedule: '仅用于日程',
};

/** 新 mode 是规范来源；旧角色挂载上的 scheduleOnly=true 作为兼容回退。 */
export const getEffectiveWorldbookMode = (book: WorldbookLike): WorldbookMode => (
    (book as MountedWorldbook).scheduleOnly === true
        ? 'schedule'
        : normalizeWorldbookMode(book.mode)
);

/** 角色挂载开关缺省为开启；全局 Worldbook 没有该字段时也视为开启。 */
export const isMountedWorldbookEnabled = (book: WorldbookLike): boolean => (
    (book as MountedWorldbook).mountEnabled !== false
);

export const sortWorldbooksForDisplay = <T extends Worldbook>(books: T[]): T[] => (
    books
        .map((book, index) => ({ book, index }))
        .sort((left, right) => {
            const leftOrder = Number.isFinite(left.book.displayOrder) ? Number(left.book.displayOrder) : Number.MAX_SAFE_INTEGER;
            const rightOrder = Number.isFinite(right.book.displayOrder) ? Number(right.book.displayOrder) : Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder
                || left.book.createdAt - right.book.createdAt
                || left.index - right.index;
        })
        .map(({ book }) => book)
);

/** 兼容旧角色挂载数据，并统一识别新的全局 schedule mode。 */
export const isScheduleOnlyWorldbook = (book: WorldbookLike): boolean => (
    getEffectiveWorldbookMode(book) === 'schedule'
);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const keywordMatches = (
    text: string,
    keyword: string,
    caseSensitive: boolean,
    wholeWords: boolean,
): boolean => {
    if (!keyword) return false;
    if (!wholeWords) {
        return caseSensitive
            ? text.includes(keyword)
            : text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
    }
    const flags = caseSensitive ? 'u' : 'iu';
    const escaped = escapeRegExp(keyword);
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, flags).test(text);
};

const messageText = (message: WorldbookScanMessage): string => {
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map(part => (typeof part === 'string' ? part : (part as any)?.text || ''))
            .filter(Boolean)
            .join('\n');
    }
    return '';
};

const scanTextForBook = (book: WorldbookLike, messages: WorldbookScanMessage[]): string => {
    const depth = Math.max(0, Math.floor(book.scanDepth ?? 4));
    if (depth === 0) return '';
    return messages.slice(-depth).map(messageText).filter(Boolean).join('\n');
};

const secondaryConditionPasses = (
    book: WorldbookLike,
    text: string,
    caseSensitive: boolean,
    wholeWords: boolean,
): boolean => {
    if (!book.selective) return true;
    const secondary = book.keysecondary || [];
    if (secondary.length === 0) return true;
    const matches = secondary.map(key => keywordMatches(text, key, caseSensitive, wholeWords));
    const logic: WorldbookSelectiveLogic = book.selectiveLogic ?? 0;
    if (logic === 1) return !matches.every(Boolean);
    if (logic === 2) return !matches.some(Boolean);
    if (logic === 3) return matches.every(Boolean);
    return matches.some(Boolean);
};

export const isWorldbookEntryActive = (
    book: WorldbookLike,
    messages: WorldbookScanMessage[] = [],
    scene: WorldbookScene = 'online',
    contextPurpose: WorldbookContextPurpose = 'chat',
): boolean => {
    if (!isMountedWorldbookEnabled(book)) return false;
    if (book.disable) return false;
    // 日程专用条目表达的是“绑定后日程必须读取”，不再受普通聊天的
    // 关键词、扫描深度、概率和 online/offline 场景筛选影响；disable 仍是总开关。
    if (isScheduleOnlyWorldbook(book)) return contextPurpose === 'schedule';
    const mode = getEffectiveWorldbookMode(book);
    if (mode !== 'all' && mode !== scene) return false;

    const primary = book.key || [];
    const isConstant = book.constant ?? primary.length === 0;
    const text = scanTextForBook(book, messages);
    const caseSensitive = book.caseSensitive === true;
    const wholeWords = book.matchWholeWords === true;

    if (!isConstant) {
        if (primary.length === 0) return false;
        if (!primary.some(key => keywordMatches(text, key, caseSensitive, wholeWords))) return false;
        if (!secondaryConditionPasses(book, text, caseSensitive, wholeWords)) return false;
    }

    if (book.useProbability) {
        const probability = clamp(book.probability, 0, 100, 100);
        if (probability <= 0) return false;
        if (probability < 100 && Math.random() * 100 >= probability) return false;
    }

    return true;
};

export const expandWorldbookMacros = (content: string, charName: string, userName: string): string => {
    let expanded = content;
    if (charName) expanded = expanded.replace(/{{\s*char\s*}}/gi, charName);
    if (userName) expanded = expanded.replace(/{{\s*user\s*}}/gi, userName);
    return expanded;
};

export const resolveWorldbookEntries = (
    books: WorldbookLike[] = [],
    messages: WorldbookScanMessage[] = [],
    charName = '',
    userName = '',
    scene: WorldbookScene = 'online',
    options: WorldbookResolveOptions = {},
): ResolvedWorldbookEntry[] => books
    .filter(book => isWorldbookEntryActive(book, messages, scene, options.contextPurpose ?? 'chat'))
    .map(book => ({
        book,
        content: expandWorldbookMacros(book.content || '', charName, userName),
        position: book.position ?? 1,
        order: Number.isFinite(book.order) ? Number(book.order) : 100,
    }))
    .filter(entry => entry.content.trim())
    .sort((a, b) => a.order - b.order);

export const splitWorldbookSections = (entries: ResolvedWorldbookEntry[]): WorldbookSystemSections => ({
    beforeCharacter: entries.filter(entry => entry.position === 0),
    afterCharacter: entries.filter(entry => entry.position === 1),
    authorsNoteTop: entries.filter(entry => entry.position === 2),
    authorsNoteBottom: entries.filter(entry => entry.position === 3),
    atDepth: entries.filter(entry => entry.position === 4),
    beforeExamples: entries.filter(entry => entry.position === 5),
    afterExamples: entries.filter(entry => entry.position === 6),
});

export const formatWorldbookSection = (
    entries: ResolvedWorldbookEntry[],
    heading: string,
): string => {
    if (entries.length === 0) return '';
    let output = `### ${heading}\n`;
    let lastLegacyCategory = '';
    for (const entry of entries) {
        // SillyTavern comments are editor-only and are not part of the prompt.
        if (entry.book.sourceUid === undefined) {
            const category = entry.book.category || '通用设定 (General)';
            if (category !== lastLegacyCategory) {
                output += `#### [${category}]\n`;
                lastLegacyCategory = category;
            }
            output += `**Title: ${entry.book.title}**\n`;
        }
        output += `${entry.content.trim()}\n---\n`;
    }
    return `${output}\n`;
};

export const injectWorldbookDepthEntries = <T extends WorldbookScanMessage>(
    messages: T[],
    entries: ResolvedWorldbookEntry[],
): Array<T | { role: string; content: string }> => {
    if (entries.length === 0) return [...messages];
    const buckets = new Map<number, ResolvedWorldbookEntry[]>();
    for (const entry of entries) {
        const depth = Math.max(0, Math.floor(entry.book.depth ?? 4));
        const index = Math.max(0, messages.length - depth);
        const bucket = buckets.get(index) || [];
        bucket.push(entry);
        buckets.set(index, bucket);
    }

    const result: Array<T | { role: string; content: string }> = [];
    for (let index = 0; index <= messages.length; index += 1) {
        const bucket = buckets.get(index) || [];
        for (const entry of bucket) {
            const roleValue = entry.book.role ?? 0;
            const role = roleValue === 1 ? 'user' : roleValue === 2 ? 'assistant' : 'system';
            result.push({ role, content: entry.content.trim() });
        }
        if (index < messages.length) result.push(messages[index]);
    }
    return result;
};

export const serializeStandardWorldbook = (books: WorldbookLike[]): string => {
    const usedUids = new Set<number>();
    const entries: Record<string, Record<string, unknown>> = {};

    books.forEach((book, index) => {
        let uid = Number.isFinite(book.sourceUid) ? Number(book.sourceUid) : index;
        while (usedUids.has(uid)) uid += 1;
        usedUids.add(uid);

        const primary = book.key || [];
        const secondary = book.keysecondary || [];
        const position = book.position ?? 1;
        entries[String(index)] = {
            uid,
            key: [...primary],
            keysecondary: [...secondary],
            comment: book.title,
            content: book.content,
            constant: book.constant ?? primary.length === 0,
            selective: book.selective ?? secondary.length > 0,
            selectiveLogic: book.selectiveLogic ?? 0,
            order: book.order ?? 100,
            position,
            disable: book.disable === true,
            probability: book.probability ?? 100,
            useProbability: book.useProbability === true,
            depth: book.depth ?? 4,
            role: position === 4 ? (book.role ?? 0) : null,
            scanDepth: book.scanDepth ?? null,
            caseSensitive: book.caseSensitive ?? null,
            matchWholeWords: book.matchWholeWords ?? null,
            displayIndex: index,
            sullyMode: normalizeWorldbookMode(book.mode),
        };
    });

    return JSON.stringify({ entries }, null, 2);
};

export const parseStandardWorldbook = (
    rawText: string,
    category: string,
    now = Date.now(),
): Worldbook[] => {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
        throw new Error('不是受支持的标准世界书文件：缺少 entries');
    }
    const rawEntries = Array.isArray(parsed.entries)
        ? parsed.entries
        : Object.values(parsed.entries);

    const books = rawEntries.flatMap((value: any, index: number): Worldbook[] => {
        if (!value || typeof value !== 'object' || typeof value.content !== 'string') return [];
        const uid = Number.isFinite(Number(value.uid)) ? Number(value.uid) : index;
        const position = clamp(value.position, 0, 6, 1) as WorldbookPosition;
        const rawRole = value.role == null ? null : clamp(value.role, 0, 2, 0) as WorldbookDepthRole;
        return [{
            id: `wb-${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            title: String(value.comment || value.name || `条目 ${uid + 1}`),
            content: value.content,
            category,
            mode: normalizeWorldbookMode(value.sullyMode ?? parsed.sullyMode ?? parsed.mode ?? parsed.originalData?.mode),
            createdAt: now,
            updatedAt: now,
            key: asStringArray(value.key),
            keysecondary: asStringArray(value.keysecondary),
            constant: value.constant === true,
            selective: value.selective === true,
            selectiveLogic: clamp(value.selectiveLogic, 0, 3, 0) as WorldbookSelectiveLogic,
            order: Number.isFinite(Number(value.order)) ? Number(value.order) : 100,
            position,
            disable: value.disable === true,
            probability: clamp(value.probability, 0, 100, 100),
            useProbability: value.useProbability === true,
            depth: Math.max(0, Math.floor(clamp(value.depth, 0, 999, 4))),
            role: rawRole,
            scanDepth: value.scanDepth == null ? null : Math.max(0, Math.floor(clamp(value.scanDepth, 0, 999, 4))),
            caseSensitive: value.caseSensitive == null ? null : value.caseSensitive === true,
            matchWholeWords: value.matchWholeWords == null ? null : value.matchWholeWords === true,
            sourceUid: uid,
            displayOrder: Number.isFinite(Number(value.displayIndex)) ? Number(value.displayIndex) : index,
        }];
    });

    if (books.length === 0) throw new Error('世界书里没有可导入的有效条目');
    return books;
};
