import { describe, expect, it } from 'vitest';
import type { MountedWorldbook } from '../types';
import {
    injectWorldbookDepthEntries,
    isWorldbookEntryActive,
    parseStandardWorldbook,
    resolveWorldbookEntries,
    serializeStandardWorldbook,
    sortWorldbooksForDisplay,
    splitWorldbookSections,
    toMountedWorldbook,
} from './worldbook';

const book = (overrides: Partial<MountedWorldbook> = {}): MountedWorldbook => ({
    id: 'book-1',
    title: '测试条目',
    content: '{{char}} 在 {{user}} 提到月亮时会想起故乡。',
    category: '测试',
    ...overrides,
});

describe('worldbook activation', () => {
    it('keeps legacy entries constantly active after character definitions', () => {
        const resolved = resolveWorldbookEntries([book()], [], '阿澈', '小雨');
        expect(resolved).toHaveLength(1);
        expect(resolved[0].position).toBe(1);
        expect(resolved[0].content).toContain('阿澈 在 小雨');
    });

    it('activates keyword entries only when the recent scan buffer matches', () => {
        const keywordBook = book({ constant: false, key: ['月亮'], scanDepth: 2 });
        expect(isWorldbookEntryActive(keywordBook, [{ content: '今晚有月亮' }])).toBe(true);
        expect(isWorldbookEntryActive(keywordBook, [{ content: '今晚下雨' }])).toBe(false);
    });

    it('respects secondary keyword logic and disabled state', () => {
        const selectiveBook = book({
            constant: false,
            key: ['学校'],
            keysecondary: ['老师', '同学'],
            selective: true,
            selectiveLogic: 3,
        });
        expect(isWorldbookEntryActive(selectiveBook, [{ content: '学校里的老师和同学' }])).toBe(true);
        expect(isWorldbookEntryActive(selectiveBook, [{ content: '学校里的老师' }])).toBe(false);
        expect(isWorldbookEntryActive({ ...selectiveBook, disable: true }, [{ content: '学校里的老师和同学' }])).toBe(false);
    });

    it('separates online and offline entries while legacy entries remain available in both', () => {
        const online = book({ id: 'online', mode: 'online' });
        const offline = book({ id: 'offline', mode: 'offline' });
        const legacy = book({ id: 'legacy' });

        expect(resolveWorldbookEntries([online, offline, legacy], [], '', '', 'online').map(entry => entry.book.id))
            .toEqual(['online', 'legacy']);
        expect(resolveWorldbookEntries([online, offline, legacy], [], '', '', 'offline').map(entry => entry.book.id))
            .toEqual(['offline', 'legacy']);
    });
});

describe('worldbook display order', () => {
    it('sorts explicit drag order first without changing prompt order', () => {
        const books = [
            { ...book({ id: 'a', order: 500, displayOrder: 2 }), category: '测试', createdAt: 1, updatedAt: 1 },
            { ...book({ id: 'b', order: 100, displayOrder: 0 }), category: '测试', createdAt: 2, updatedAt: 2 },
            { ...book({ id: 'legacy', order: 1 }), category: '测试', createdAt: 3, updatedAt: 3 },
        ];
        expect(sortWorldbooksForDisplay(books).map(entry => entry.id)).toEqual(['b', 'a', 'legacy']);
        expect(resolveWorldbookEntries(books).map(entry => entry.book.id)).toEqual(['legacy', 'b', 'a']);
    });
});

describe('worldbook positions', () => {
    it('splits standard positions and injects at-depth entries using their role', () => {
        const resolved = resolveWorldbookEntries([
            book({ id: 'before', position: 0 }),
            book({ id: 'depth', position: 4, depth: 1, role: 1 }),
        ]);
        const sections = splitWorldbookSections(resolved);
        expect(sections.beforeCharacter.map(entry => entry.book.id)).toEqual(['before']);

        const messages = injectWorldbookDepthEntries(
            [{ role: 'user', content: '一' }, { role: 'assistant', content: '二' }],
            sections.atDepth,
        );
        expect(messages.map(message => message.role)).toEqual(['user', 'user', 'assistant']);
        expect(messages[1].content).toContain('{{char}}');
    });
});

describe('standard worldbook import', () => {
    it('converts entries into a SullyOS category without losing activation metadata', () => {
        const imported = parseStandardWorldbook(JSON.stringify({
            entries: {
                0: {
                    uid: 7,
                    comment: '月亮设定',
                    content: '月亮是蓝色的。',
                    key: ['月亮'],
                    keysecondary: [],
                    constant: false,
                    selective: false,
                    order: 120,
                    position: 4,
                    depth: 2,
                    role: 0,
                    disable: false,
                    probability: 80,
                    useProbability: true,
                },
            },
        }), '导入测试', 1234);

        expect(imported).toHaveLength(1);
        expect(imported[0]).toMatchObject({
            title: '月亮设定',
            category: '导入测试',
            key: ['月亮'],
            constant: false,
            position: 4,
            depth: 2,
            role: 0,
            order: 120,
            probability: 80,
            useProbability: true,
            sourceUid: 7,
        });
    });

    it('exports a whole group as a standard worldbook that can be imported again', () => {
        const source = [{
            ...book({
                id: 'export-1',
                title: '导出条目',
                content: '导出内容',
                constant: false,
                key: ['导出'],
                position: 4,
                depth: 3,
                role: 2,
                mode: 'online',
                displayOrder: 7,
            }),
            category: '导出组',
            createdAt: 1,
            updatedAt: 1,
        }];

        const json = serializeStandardWorldbook(source);
        const raw = JSON.parse(json);
        expect(raw.entries['0']).toMatchObject({
            comment: '导出条目',
            key: ['导出'],
            position: 4,
            depth: 3,
            role: 2,
            sullyMode: 'online',
            displayIndex: 0,
        });

        const imported = parseStandardWorldbook(json, '重新导入', 2);
        expect(imported[0]).toMatchObject({
            title: '导出条目',
            content: '导出内容',
            key: ['导出'],
            position: 4,
            depth: 3,
            role: 2,
            mode: 'online',
            displayOrder: 0,
        });
    });
});

describe('mounted worldbook synchronization', () => {
    it('copies edited activation and injection settings into the character mount cache', () => {
        const mounted = toMountedWorldbook({
            ...book({
                constant: false,
                key: ['月亮'],
                keysecondary: ['夜晚'],
                selective: true,
                selectiveLogic: 0,
                position: 4,
                depth: 2,
                role: 1,
                disable: true,
                order: 180,
                scanDepth: 6,
                useProbability: true,
                probability: 75,
                mode: 'offline',
                displayOrder: 3,
            }),
            category: '同步测试',
            createdAt: 1,
            updatedAt: 2,
        });

        expect(mounted).toMatchObject({
            constant: false,
            key: ['月亮'],
            keysecondary: ['夜晚'],
            selective: true,
            position: 4,
            depth: 2,
            role: 1,
            disable: true,
            order: 180,
            scanDepth: 6,
            useProbability: true,
            probability: 75,
            mode: 'offline',
            displayOrder: 3,
        });
        expect(mounted).not.toHaveProperty('createdAt');
        expect(mounted).not.toHaveProperty('updatedAt');
    });
});
