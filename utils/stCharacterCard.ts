/**
 * SillyTavern 角色卡（Character Card）导入。
 *
 * 参考实现：https://github.com/SillyTavern/SillyTavern
 *   - `src/character-card-parser.js`   PNG 里 `ccv3` / `chara` 两个 tEXt 块，值是 base64(JSON)
 *   - `public/scripts/char-data.js`    v1 / v2 卡的字段清单与 `character_book` 条目结构
 *
 * 这里只做**纯数据转换**：读字节 → 归一化成一份 `SillyTavernCard` → 映射成 SullyOS 的
 * `CharacterProfile` 片段 + `Worldbook[]`。不碰 IndexedDB、不碰 React，方便直接跑测试。
 * 落库、头像压缩、开场白写进聊天记录都由 `apps/Character.tsx` 负责。
 *
 * 三种入口格式：
 *   - `.png`   角色卡图片本身，元数据在 tEXt / iTXt 块里（最常见）
 *   - `.json`  裸的 v1 / v2 / v3 JSON
 *   - `.charx` v3 的 zip 包，卡片正文在 `card.json`（解包在调用方做）
 */

import type {
    Worldbook,
    WorldbookDepthRole,
    WorldbookPosition,
    WorldbookSelectiveLogic,
} from '../types';

// ────────────────────────────────────────────────────────────
// 归一化后的卡片
// ────────────────────────────────────────────────────────────

export interface SillyTavernBookEntry {
    title: string;
    content: string;
    keys: string[];
    secondaryKeys: string[];
    constant: boolean;
    selective: boolean;
    selectiveLogic: WorldbookSelectiveLogic;
    order: number;
    position: WorldbookPosition;
    disable: boolean;
    probability: number;
    useProbability: boolean;
    depth: number;
    role: WorldbookDepthRole | null;
    scanDepth: number | null;
    caseSensitive: boolean | null;
    matchWholeWords: boolean | null;
    sourceUid: number;
    displayOrder: number;
}

export interface SillyTavernCard {
    /** 卡片声明的规格；v1 是没有 `spec` 字段的裸 JSON。 */
    spec: 'v1' | 'v2' | 'v3';
    name: string;
    description: string;
    personality: string;
    scenario: string;
    firstMes: string;
    mesExample: string;
    systemPrompt: string;
    postHistoryInstructions: string;
    creatorNotes: string;
    creator: string;
    characterVersion: string;
    tags: string[];
    alternateGreetings: string[];
    bookName: string;
    bookEntries: SillyTavernBookEntry[];
}

// ────────────────────────────────────────────────────────────
// 小工具
// ────────────────────────────────────────────────────────────

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

const asStringArray = (value: unknown): string[] => (
    Array.isArray(value) ? value.map(item => String(item ?? '').trim()).filter(Boolean) : []
);

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
};

/** `undefined` / `null` 保持三态；其余按真假收敛成布尔。 */
const asTriBool = (value: unknown): boolean | null => (
    value === undefined || value === null ? null : value === true
);

const b64ToUtf8 = (raw: string): string => {
    const binary = atob(raw.replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
};

// ────────────────────────────────────────────────────────────
// PNG：把 `ccv3` / `chara` 文本块挖出来
// ────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface PngTextChunk {
    keyword: string;
    text: string;
}

/** 解 tEXt：`keyword\0text`（Latin-1）。 */
const decodeTextChunk = (data: Uint8Array): PngTextChunk | null => {
    const nul = data.indexOf(0);
    if (nul < 0) return null;
    let keyword = '';
    for (let i = 0; i < nul; i++) keyword += String.fromCharCode(data[i]);
    let text = '';
    for (let i = nul + 1; i < data.length; i++) text += String.fromCharCode(data[i]);
    return { keyword, text };
};

/**
 * 解 iTXt：`keyword\0 压缩标志 压缩方法 语言\0 翻译关键字\0 正文(UTF-8)`。
 * 压缩过的（标志=1）需要 zlib，这里直接放弃——ST 自己写卡用的是 tEXt。
 */
const decodeItxtChunk = (data: Uint8Array): PngTextChunk | null => {
    const nul = data.indexOf(0);
    if (nul < 0 || data.length < nul + 3) return null;
    let keyword = '';
    for (let i = 0; i < nul; i++) keyword += String.fromCharCode(data[i]);
    if (data[nul + 1] !== 0) return null; // 压缩过，跳过
    let cursor = nul + 3;
    for (let skipped = 0; skipped < 2; skipped++) {
        const next = data.indexOf(0, cursor);
        if (next < 0) return null;
        cursor = next + 1;
    }
    return { keyword, text: new TextDecoder('utf-8').decode(data.subarray(cursor)) };
};

/** 按 PNG 分块结构走一遍，收集所有文本块。 */
export const readPngTextChunks = (bytes: Uint8Array): PngTextChunk[] => {
    if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
        throw new Error('这不是一张 PNG 图片');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks: PngTextChunk[] = [];
    let offset = 8;
    // 每块：4 字节长度 + 4 字节类型 + 正文 + 4 字节 CRC
    while (offset + 8 <= bytes.length) {
        const length = view.getUint32(offset);
        const type = String.fromCharCode(
            bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
        );
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd > bytes.length) break; // 截断的文件，能挖多少算多少
        if (type === 'tEXt' || type === 'iTXt') {
            const data = bytes.subarray(dataStart, dataEnd);
            const parsed = type === 'tEXt' ? decodeTextChunk(data) : decodeItxtChunk(data);
            if (parsed) chunks.push(parsed);
        }
        if (type === 'IEND') break;
        offset = dataEnd + 4;
    }
    return chunks;
};

/**
 * 从 PNG 字节里取出角色卡 JSON 文本。
 * 与 ST 同序：先找 `ccv3`（v3 卡），没有再退回 `chara`（v1/v2 卡）。
 */
export const extractCardTextFromPng = (bytes: Uint8Array): string => {
    const chunks = readPngTextChunks(bytes);
    const pick = (keyword: string) => chunks.find(
        chunk => chunk.keyword.toLowerCase() === keyword && chunk.text.trim(),
    );
    const chunk = pick('ccv3') || pick('chara');
    if (!chunk) {
        throw new Error('这张 PNG 里没有角色卡数据（找不到 chara / ccv3 信息块）');
    }
    // 正常是 base64(JSON)；个别工具直接塞明文 JSON，两种都收。
    const text = chunk.text.trim();
    if (text.startsWith('{')) return text;
    try {
        return b64ToUtf8(text);
    } catch {
        throw new Error('角色卡信息块解不开（base64 损坏）');
    }
};

// ────────────────────────────────────────────────────────────
// JSON → 归一化卡片
// ────────────────────────────────────────────────────────────

/**
 * ST 的 `character_book` 条目位置有两处来源：
 * 顶层 `position` 是字符串（before_char / after_char），
 * `extensions.position` 才是 ST 内部那套 0–6 的数字，和 SullyOS 的 `WorldbookPosition` 同义。
 */
const resolveEntryPosition = (entry: any): WorldbookPosition => {
    const extPosition = Number(entry?.extensions?.position);
    if (Number.isFinite(extPosition)) return clampInt(extPosition, 0, 6, 1) as WorldbookPosition;
    if (entry?.position === 'before_char') return 0;
    if (entry?.position === 'after_char') return 1;
    const numeric = Number(entry?.position);
    if (Number.isFinite(numeric)) return clampInt(numeric, 0, 6, 1) as WorldbookPosition;
    return 1;
};

const normalizeBookEntry = (entry: any, index: number): SillyTavernBookEntry | null => {
    if (!entry || typeof entry !== 'object') return null;
    const content = asText(entry.content);
    if (!content.trim()) return null;

    const ext = (entry.extensions && typeof entry.extensions === 'object') ? entry.extensions : {};
    const keys = asStringArray(entry.keys ?? entry.key);
    const secondaryKeys = asStringArray(entry.secondary_keys ?? entry.keysecondary);
    const position = resolveEntryPosition(entry);
    const uid = Number.isFinite(Number(entry.id)) ? Number(entry.id) : index;

    return {
        title: String(entry.comment || entry.name || `条目 ${index + 1}`).trim() || `条目 ${index + 1}`,
        content,
        keys,
        secondaryKeys,
        // 没写 constant 的条目：没有关键词就只能当常驻，否则永远不会被触发。
        constant: entry.constant === true || (entry.constant === undefined && keys.length === 0),
        selective: entry.selective === true || (entry.selective === undefined && secondaryKeys.length > 0),
        selectiveLogic: clampInt(ext.selectiveLogic, 0, 3, 0) as WorldbookSelectiveLogic,
        order: Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : 100,
        position,
        // ST 用 `enabled`（默认开），SullyOS 用 `disable`（默认关），是反的。
        disable: entry.enabled === false,
        probability: clampInt(ext.probability, 0, 100, 100),
        useProbability: ext.useProbability === true,
        depth: clampInt(ext.depth, 0, 999, 4),
        role: position === 4 ? clampInt(ext.role, 0, 2, 0) as WorldbookDepthRole : null,
        scanDepth: ext.scan_depth == null ? null : clampInt(ext.scan_depth, 0, 999, 4),
        caseSensitive: asTriBool(entry.case_sensitive ?? ext.case_sensitive),
        matchWholeWords: asTriBool(ext.match_whole_words),
        sourceUid: uid,
        displayOrder: Number.isFinite(Number(ext.display_index)) ? Number(ext.display_index) : index,
    };
};

/** 这份 JSON 看起来像不像一张 ST 角色卡（用来和 SullyOS 自家卡区分）。 */
export const looksLikeSillyTavernCard = (raw: unknown): boolean => {
    if (!raw || typeof raw !== 'object') return false;
    const obj = raw as any;
    if (obj.type === 'sully_character_card') return false;
    const spec = asText(obj.spec).toLowerCase();
    if (spec === 'chara_card_v2' || spec === 'chara_card_v3') return true;
    // v1 裸卡没有 spec，靠 ST 特有字段认。只有 name 的话不算（SullyOS 自家卡也有）。
    const body = (obj.data && typeof obj.data === 'object') ? obj.data : obj;
    return typeof body.first_mes === 'string'
        || typeof body.mes_example === 'string'
        || typeof body.personality === 'string';
};

/**
 * 把 v1 / v2 / v3 统一成一份 `SillyTavernCard`。
 * v2/v3 的正文在 `data` 里，v1 直接摊在顶层；字段缺失一律退回空串而不是抛错，
 * 因为野卡缺字段是常态，缺一个不该让整张卡导不进来。
 */
export const normalizeSillyTavernCard = (raw: unknown): SillyTavernCard => {
    if (!raw || typeof raw !== 'object') {
        throw new Error('角色卡内容不是一个 JSON 对象');
    }
    const obj = raw as any;
    const specText = asText(obj.spec).toLowerCase();
    const spec: SillyTavernCard['spec'] = specText === 'chara_card_v3'
        ? 'v3'
        : specText === 'chara_card_v2' ? 'v2' : 'v1';
    const body = (obj.data && typeof obj.data === 'object') ? obj.data : obj;

    const name = asText(body.name).trim() || asText(body.nickname).trim();
    if (!name && !asText(body.description).trim()) {
        throw new Error('角色卡里既没有名字也没有描述，不像是一张有效的卡');
    }

    const book = (body.character_book && typeof body.character_book === 'object')
        ? body.character_book
        : null;
    const rawEntries = Array.isArray(book?.entries)
        ? book.entries
        : (book?.entries && typeof book.entries === 'object' ? Object.values(book.entries) : []);

    return {
        spec,
        name,
        description: asText(body.description),
        personality: asText(body.personality),
        scenario: asText(body.scenario),
        firstMes: asText(body.first_mes),
        mesExample: asText(body.mes_example),
        systemPrompt: asText(body.system_prompt),
        postHistoryInstructions: asText(body.post_history_instructions),
        creatorNotes: asText(body.creator_notes) || asText(body.creatorcomment),
        creator: asText(body.creator),
        characterVersion: asText(body.character_version),
        tags: asStringArray(body.tags),
        alternateGreetings: asStringArray(body.alternate_greetings),
        bookName: asText(book?.name),
        bookEntries: rawEntries
            .map((entry: any, index: number) => normalizeBookEntry(entry, index))
            .filter((entry): entry is SillyTavernBookEntry => entry !== null),
    };
};

// ────────────────────────────────────────────────────────────
// 归一化卡片 → SullyOS 角色
// ────────────────────────────────────────────────────────────

/**
 * ST 的宏。SullyOS 只在**世界书**里运行时展开 `{{char}}` / `{{user}}`（见
 * `utils/worldbook.ts` 的 `expandWorldbookMacros`），角色设定那几栏是原样拼进提示词的。
 * 所以设定 / 开场白在导入这一刻就替换掉，世界书正文则保留宏，交给运行时。
 */
export const expandCardMacros = (text: string, charName: string, userName: string): string => {
    let out = text;
    if (charName) {
        out = out.replace(/\{\{\s*char\s*\}\}/gi, charName).replace(/<BOT>/g, charName);
    }
    if (userName) {
        out = out.replace(/\{\{\s*user\s*\}\}/gi, userName).replace(/<USER>/g, userName);
    }
    return out;
};

const section = (title: string, body: string): string => (
    body.trim() ? `【${title}】\n${body.trim()}` : ''
);

/** 列表页那行小字只有一行的位置，从创作者备注 / 描述里取第一句。 */
const buildShortDescription = (card: SillyTavernCard): string => {
    const source = (card.creatorNotes.trim() || card.description.trim())
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(Boolean) || '';
    return source.length > 60 ? `${source.slice(0, 60)}…` : source;
};

export interface StCardConversionOptions {
    /** 用户档案里的名字，用来展开 `{{user}}`。 */
    userName?: string;
    /** 世界书分类名；不给就用「<角色名> 的世界书」。 */
    category?: string;
    now?: number;
    /** 测试里可注入，避免随机 id。 */
    idSuffix?: () => string;
}

export interface StCardConversion {
    /** 直接铺进 `CharacterProfile` 的字段（不含 id / avatar / memories）。 */
    profile: {
        name: string;
        description: string;
        systemPrompt: string;
        worldview: string;
    };
    /** `character_book` 转出来的世界书条目，同时挂到角色和世界书 App。 */
    worldbooks: Worldbook[];
    /** `first_mes`；调用方把它写成聊天里的第一条角色消息。空串表示这张卡没写开场白。 */
    greeting: string;
    /** 有哪些内容被换了地方 / 没能带过来，交付给用户看，不要闷声吞掉。 */
    notes: string[];
}

export const convertSillyTavernCard = (
    card: SillyTavernCard,
    options: StCardConversionOptions = {},
): StCardConversion => {
    const now = options.now ?? Date.now();
    const idSuffix = options.idSuffix ?? (() => Math.random().toString(36).slice(2, 8));
    const name = card.name.trim() || '导入角色';
    const userName = options.userName?.trim() || '';
    const expand = (text: string) => expandCardMacros(text, name, userName);

    // ST 的 system_prompt 是「替换主提示词」的位置，放最前；post_history_instructions
    // 是历史之后的最后一句叮嘱，放最后。中间按 描述 → 性格 → 示例对话 的老顺序。
    const systemPrompt = [
        section('系统指令', expand(card.systemPrompt)),
        section('角色描述', expand(card.description)),
        section('性格', expand(card.personality)),
        section('对话示例', expand(card.mesExample)),
        section('补充指令', expand(card.postHistoryInstructions)),
    ].filter(Boolean).join('\n\n');

    const category = options.category?.trim() || `${name} 的世界书`;
    const worldbooks: Worldbook[] = card.bookEntries.map((entry, index) => ({
        id: `wb-st-${now}-${index}-${idSuffix()}`,
        title: entry.title,
        // 世界书正文保留 {{char}} / {{user}}，SullyOS 每轮注入时自己展开。
        content: entry.content,
        category,
        mode: 'all',
        createdAt: now,
        updatedAt: now,
        key: entry.keys,
        keysecondary: entry.secondaryKeys,
        constant: entry.constant,
        selective: entry.selective,
        selectiveLogic: entry.selectiveLogic,
        order: entry.order,
        position: entry.position,
        disable: entry.disable,
        probability: entry.probability,
        useProbability: entry.useProbability,
        depth: entry.depth,
        role: entry.role,
        scanDepth: entry.scanDepth,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
        sourceUid: entry.sourceUid,
        displayOrder: entry.displayOrder,
    }));

    // 备选开场白在 SullyOS 没有对应功能位。丢掉太可惜，落成一条**默认关闭**的世界书条目，
    // 用户想用就去世界书 App 打开或复制，不打开就完全不进提示词。
    if (card.alternateGreetings.length > 0) {
        worldbooks.push({
            id: `wb-st-${now}-greetings-${idSuffix()}`,
            title: `${name} · 备选开场白`,
            content: card.alternateGreetings
                .map((text, index) => `【备选 ${index + 1}】\n${text.trim()}`)
                .join('\n\n'),
            category,
            mode: 'all',
            createdAt: now,
            updatedAt: now,
            key: [],
            keysecondary: [],
            constant: true,
            selective: false,
            selectiveLogic: 0,
            order: 100,
            position: 1,
            disable: true,
            probability: 100,
            useProbability: false,
            depth: 4,
            role: null,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            displayOrder: worldbooks.length,
        });
    }

    const notes: string[] = [];
    if (card.bookEntries.length > 0) {
        notes.push(`世界书 ${card.bookEntries.length} 条`);
    }
    if (card.alternateGreetings.length > 0) {
        notes.push(`备选开场白 ${card.alternateGreetings.length} 条（存为已关闭的世界书条目）`);
    }
    if (card.scenario.trim()) {
        notes.push('场景（scenario）已放进「世界观 / 设定补充」');
    }

    return {
        profile: {
            name,
            description: buildShortDescription(card),
            systemPrompt,
            worldview: expand(card.scenario).trim(),
        },
        worldbooks,
        greeting: expand(card.firstMes).trim(),
        notes,
    };
};

/** `.png` / `.json` / `.charx` 解出来的文本 → 转换结果，一步到位。 */
export const parseSillyTavernCardText = (
    text: string,
    options?: StCardConversionOptions,
): StCardConversion => convertSillyTavernCard(
    normalizeSillyTavernCard(JSON.parse(text)),
    options,
);
