import { describe, it, expect } from 'vitest';
import {
    convertSillyTavernCard,
    expandCardMacros,
    extractCardTextFromPng,
    looksLikeSillyTavernCard,
    normalizeSillyTavernCard,
    parseSillyTavernCardText,
    readPngTextChunks,
} from './stCharacterCard';

// ── 造一张最小 PNG，把文本块塞进去 ─────────────────────────
const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

const crc32 = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(data.length + 12);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    const typeAndData = out.subarray(4, 8 + data.length);
    view.setUint32(8 + data.length, crc32(typeAndData));
    return out;
};

const latin1 = (text: string): Uint8Array => {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
};

const utf8ToB64 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};

const textChunk = (keyword: string, text: string) => chunk('tEXt', latin1(`${keyword}\0${text}`));

const buildPng = (...extra: Uint8Array[]): Uint8Array => {
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', new Uint8Array(13)),
        ...extra,
        chunk('IEND', new Uint8Array(0)),
    ];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
};

const V2_CARD = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: '缪',
        description: '{{char}} 是一个住在钟楼上的记录者，认识 {{user}} 很久了。',
        personality: '寡言，但会记住每一件小事',
        scenario: '雨季的旧钟楼，齿轮还在转。',
        first_mes: '{{user}}，你来了。',
        mes_example: '<START>\n{{user}}: 你在写什么？\n{{char}}: 今天的雨。',
        system_prompt: '始终以第三人称叙述动作。',
        post_history_instructions: '不要替 {{user}} 说话。',
        creator_notes: '钟楼系列第一张卡。\n第二行不该出现在简介里。',
        creator: 'someone',
        character_version: '1.2',
        tags: ['原创', '日常'],
        alternate_greetings: ['雨停了才发现你站在门口。', '……又是你。'],
        character_book: {
            name: '钟楼',
            entries: [
                {
                    id: 7,
                    keys: ['钟楼', 'clocktower'],
                    secondary_keys: ['齿轮'],
                    comment: '钟楼的构造',
                    content: '钟楼有七层，{{char}} 住在第六层。',
                    constant: false,
                    selective: true,
                    enabled: true,
                    insertion_order: 20,
                    position: 'before_char',
                    case_sensitive: false,
                    extensions: {
                        position: 4,
                        depth: 2,
                        role: 1,
                        probability: 80,
                        useProbability: true,
                        selectiveLogic: 2,
                        scan_depth: 6,
                        match_whole_words: true,
                        display_index: 3,
                    },
                },
                {
                    keys: [],
                    content: '这座城市一年有九个月在下雨。',
                    enabled: false,
                },
                { keys: ['空'], content: '   ' },
            ],
        },
    },
};

describe('PNG 文本块', () => {
    it('按 PNG 分块结构读出 tEXt', () => {
        const png = buildPng(textChunk('chara', 'AAA'), textChunk('Software', 'x'));
        expect(readPngTextChunks(png)).toEqual([
            { keyword: 'chara', text: 'AAA' },
            { keyword: 'Software', text: 'x' },
        ]);
    });

    it('不是 PNG 就直说', () => {
        expect(() => readPngTextChunks(new Uint8Array([1, 2, 3])))
            .toThrow('这不是一张 PNG 图片');
    });

    it('ccv3 优先于 chara（和 ST 同序）', () => {
        const png = buildPng(
            textChunk('chara', utf8ToB64('{"v":2}')),
            textChunk('ccv3', utf8ToB64('{"v":3}')),
        );
        expect(extractCardTextFromPng(png)).toBe('{"v":3}');
    });

    it('没有 ccv3 时退回 chara，并解出 UTF-8 中文', () => {
        const png = buildPng(textChunk('chara', utf8ToB64('{"name":"缪"}')));
        expect(extractCardTextFromPng(png)).toBe('{"name":"缪"}');
    });

    it('个别工具塞的明文 JSON 也认', () => {
        const png = buildPng(textChunk('chara', '{"name":"x"}'));
        expect(extractCardTextFromPng(png)).toBe('{"name":"x"}');
    });

    it('IEND 之后的垃圾数据不影响', () => {
        const png = buildPng(textChunk('chara', utf8ToB64('{"name":"x"}')));
        const padded = new Uint8Array(png.length + 16);
        padded.set(png);
        expect(extractCardTextFromPng(padded)).toBe('{"name":"x"}');
    });

    it('普通截图（没有角色卡块）给出可读报错', () => {
        expect(() => extractCardTextFromPng(buildPng(textChunk('Software', 'Paint'))))
            .toThrow('找不到 chara / ccv3 信息块');
    });

    it('未压缩的 iTXt 也能读', () => {
        const data = new Uint8Array([
            ...latin1('chara'), 0, 0, 0, ...latin1('en'), 0, 0,
            ...new TextEncoder().encode('{"name":"缪"}'),
        ]);
        const png = buildPng(chunk('iTXt', data));
        expect(extractCardTextFromPng(png)).toBe('{"name":"缪"}');
    });
});

describe('识别 ST 卡', () => {
    it('认得 v2 / v3 的 spec', () => {
        expect(looksLikeSillyTavernCard({ spec: 'chara_card_v2', data: {} })).toBe(true);
        expect(looksLikeSillyTavernCard({ spec: 'chara_card_v3', data: {} })).toBe(true);
    });

    it('v1 裸卡靠 first_mes / mes_example / personality 认', () => {
        expect(looksLikeSillyTavernCard({ name: 'A', first_mes: '嗨' })).toBe(true);
        expect(looksLikeSillyTavernCard({ name: 'A', personality: '温柔' })).toBe(true);
    });

    it('SullyOS 自家角色卡不会被当成 ST 卡', () => {
        expect(looksLikeSillyTavernCard({
            type: 'sully_character_card',
            name: 'A',
            personality: '温柔',
        })).toBe(false);
    });

    it('只有 name 的普通 JSON 不算', () => {
        expect(looksLikeSillyTavernCard({ name: 'A' })).toBe(false);
        expect(looksLikeSillyTavernCard(null)).toBe(false);
    });
});

describe('归一化', () => {
    it('v2 的字段全在 data 里', () => {
        const card = normalizeSillyTavernCard(V2_CARD);
        expect(card.spec).toBe('v2');
        expect(card.name).toBe('缪');
        expect(card.firstMes).toBe('{{user}}，你来了。');
        expect(card.alternateGreetings).toHaveLength(2);
        expect(card.bookName).toBe('钟楼');
    });

    it('v1 裸卡摊在顶层', () => {
        const card = normalizeSillyTavernCard({
            name: '旧卡', description: '描述', personality: '性格',
            scenario: '场景', first_mes: '你好', mes_example: '',
        });
        expect(card.spec).toBe('v1');
        expect(card.name).toBe('旧卡');
        expect(card.scenario).toBe('场景');
        expect(card.bookEntries).toEqual([]);
    });

    it('v3 用 spec 认，nickname 可以顶替 name', () => {
        const card = normalizeSillyTavernCard({
            spec: 'chara_card_v3',
            data: { nickname: '小夜', description: 'x' },
        });
        expect(card.spec).toBe('v3');
        expect(card.name).toBe('小夜');
    });

    it('既没名字也没描述 → 报错', () => {
        expect(() => normalizeSillyTavernCard({ spec: 'chara_card_v2', data: {} }))
            .toThrow('不像是一张有效的卡');
        expect(() => normalizeSillyTavernCard('不是对象'))
            .toThrow('不是一个 JSON 对象');
    });

    it('character_book 条目逐字段落位', () => {
        const [entry] = normalizeSillyTavernCard(V2_CARD).bookEntries;
        expect(entry.title).toBe('钟楼的构造');
        expect(entry.keys).toEqual(['钟楼', 'clocktower']);
        expect(entry.secondaryKeys).toEqual(['齿轮']);
        expect(entry.order).toBe(20);
        // extensions.position 是 ST 内部那套数字，优先于顶层的 before_char
        expect(entry.position).toBe(4);
        expect(entry.role).toBe(1);
        expect(entry.depth).toBe(2);
        expect(entry.probability).toBe(80);
        expect(entry.useProbability).toBe(true);
        expect(entry.selectiveLogic).toBe(2);
        expect(entry.scanDepth).toBe(6);
        expect(entry.caseSensitive).toBe(false);
        expect(entry.matchWholeWords).toBe(true);
        expect(entry.sourceUid).toBe(7);
        expect(entry.displayOrder).toBe(3);
        expect(entry.disable).toBe(false);
    });

    it('enabled=false 翻成 disable=true（两边是反的）', () => {
        const entries = normalizeSillyTavernCard(V2_CARD).bookEntries;
        expect(entries[1].disable).toBe(true);
    });

    it('没有关键词又没写 constant 的条目按常驻处理', () => {
        const entries = normalizeSillyTavernCard(V2_CARD).bookEntries;
        expect(entries[1].constant).toBe(true);
        expect(entries[0].constant).toBe(false);
    });

    it('正文全空的条目直接丢掉', () => {
        expect(normalizeSillyTavernCard(V2_CARD).bookEntries).toHaveLength(2);
    });

    it('position 只有顶层字符串时也能落位', () => {
        const card = normalizeSillyTavernCard({
            spec: 'chara_card_v2',
            data: {
                name: 'A',
                character_book: { entries: [{ keys: ['k'], content: 'c', position: 'before_char' }] },
            },
        });
        expect(card.bookEntries[0].position).toBe(0);
    });

    it('entries 写成对象（而不是数组）也收', () => {
        const card = normalizeSillyTavernCard({
            spec: 'chara_card_v2',
            data: { name: 'A', character_book: { entries: { '0': { keys: ['k'], content: 'c' } } } },
        });
        expect(card.bookEntries).toHaveLength(1);
    });
});

describe('宏展开', () => {
    it('{{char}} / {{user}} 与旧写法 <BOT> / <USER>', () => {
        expect(expandCardMacros('{{char}} 对 {{USER}} 说，<BOT> 又看了 <USER> 一眼', '缪', '千夜'))
            .toBe('缪 对 千夜 说，缪 又看了 千夜 一眼');
    });

    it('没有用户名时保留 {{user}}，不替换成空串', () => {
        expect(expandCardMacros('{{user}} 好', '缪', '')).toBe('{{user}} 好');
    });
});

describe('转换成 SullyOS 角色', () => {
    const convert = () => convertSillyTavernCard(normalizeSillyTavernCard(V2_CARD), {
        userName: '千夜',
        now: 1000,
        idSuffix: () => 'fixed',
    });

    it('设定按 系统指令 → 描述 → 性格 → 示例 → 补充 拼装，并展开宏', () => {
        const { profile } = convert();
        expect(profile.systemPrompt).toBe([
            '【系统指令】\n始终以第三人称叙述动作。',
            '【角色描述】\n缪 是一个住在钟楼上的记录者，认识 千夜 很久了。',
            '【性格】\n寡言，但会记住每一件小事',
            '【对话示例】\n<START>\n千夜: 你在写什么？\n缪: 今天的雨。',
            '【补充指令】\n不要替 千夜 说话。',
        ].join('\n\n'));
    });

    it('空字段不留下空标题', () => {
        const { profile } = convertSillyTavernCard(normalizeSillyTavernCard({
            name: 'A', description: '只有描述',
        }));
        expect(profile.systemPrompt).toBe('【角色描述】\n只有描述');
    });

    it('scenario 落在世界观栏', () => {
        expect(convert().profile.worldview).toBe('雨季的旧钟楼，齿轮还在转。');
    });

    it('简介取创作者备注的第一行', () => {
        expect(convert().profile.description).toBe('钟楼系列第一张卡。');
    });

    it('没有备注时退回描述第一行，并按 60 字截断', () => {
        const { profile } = convertSillyTavernCard(normalizeSillyTavernCard({
            name: 'A', description: '啊'.repeat(80), first_mes: 'x',
        }));
        expect(profile.description).toBe(`${'啊'.repeat(60)}…`);
    });

    it('first_mes 展开宏后作为开场白返回', () => {
        expect(convert().greeting).toBe('千夜，你来了。');
    });

    it('世界书条目原样带宏（运行时才展开）', () => {
        const entry = convert().worldbooks[0];
        expect(entry.content).toBe('钟楼有七层，{{char}} 住在第六层。');
        expect(entry.category).toBe('缪 的世界书');
        expect(entry.mode).toBe('all');
        expect(entry.position).toBe(4);
        expect(entry.role).toBe(1);
        expect(entry.id).toBe('wb-st-1000-0-fixed');
    });

    it('备选开场白存成一条默认关闭的世界书条目', () => {
        const books = convert().worldbooks;
        const greetings = books[books.length - 1];
        expect(greetings.title).toBe('缪 · 备选开场白');
        expect(greetings.disable).toBe(true);
        expect(greetings.content).toContain('【备选 1】\n雨停了才发现你站在门口。');
        expect(greetings.content).toContain('【备选 2】\n……又是你。');
    });

    it('没有备选开场白就不多造条目', () => {
        const { worldbooks } = convertSillyTavernCard(normalizeSillyTavernCard({
            name: 'A', description: 'x', first_mes: 'y',
        }));
        expect(worldbooks).toEqual([]);
    });

    it('挪过位置的内容都写进 notes，不闷声吞掉', () => {
        expect(convert().notes).toEqual([
            '世界书 2 条',
            '备选开场白 2 条（存为已关闭的世界书条目）',
            '场景（scenario）已放进「世界观 / 设定补充」',
        ]);
    });

    it('文本入口一步到位', () => {
        const result = parseSillyTavernCardText(JSON.stringify(V2_CARD), { userName: '千夜' });
        expect(result.profile.name).toBe('缪');
        expect(result.greeting).toBe('千夜，你来了。');
    });
});
