import { describe, expect, it } from 'vitest';
import type { StoryTheaterEntry } from '../types';
import { DB } from './db';
import { storyTheaterThreadId } from './storyTheater';
import { repairStoryTheaterFictionMirrors } from './storyTheaterMirrorRepair';
import { buildPendingStoryBackgroundJob } from './storyBackgroundJobs';

const ACTOR = 'repair-actor';
const OTHER_ACTOR = 'repair-ex-actor';

const entry = (id: string, writesToCharacterMemory: boolean, characterIds = [ACTOR]): StoryTheaterEntry => ({
    id,
    title: id,
    premise: '',
    openingMode: 'user',
    mask: { type: 'user' },
    characterIds,
    writesToCharacterMemory,
    characterMemoryDates: {},
    carryCharacterMemory: writesToCharacterMemory,
    characterContextLimits: {},
    archiveAfter: 20,
    archiveKeepRecent: 5,
    archiveStrategy: 'summary',
    archives: [],
    selectedWorldbookIds: [],
    createdAt: 1,
    updatedAt: 1,
});

describe('虚构剧场不写角色记忆', () => {
    it('后台生成任务在虚构剧场下不带任何镜像收件人', () => {
        const fiction = entry('bg-fiction', false);
        const job = buildPendingStoryBackgroundJob({
            entry: fiction,
            primaryChar: { id: ACTOR, name: '演员' },
            operation: 'append',
            turnKind: 'advance',
            messages: [{ role: 'user', content: '我推开门。' }],
            promptTokenEstimate: 10,
            mirrorTargets: [{ charId: ACTOR, entryCreatedAt: 1 }],
            targetMirrorIds: { [ACTOR]: 123 },
        });
        expect(job?.input.mirrorTargets).toEqual([]);
        expect(job?.input.targetMirrorIds).toBeUndefined();
    });

    it('真实时间陪伴仍然照常镜像', () => {
        const real = entry('bg-real', true);
        const job = buildPendingStoryBackgroundJob({
            entry: real,
            primaryChar: { id: ACTOR, name: '演员' },
            operation: 'append',
            turnKind: 'advance',
            messages: [{ role: 'user', content: '我推开门。' }],
            promptTokenEstimate: 10,
            mirrorTargets: [{ charId: ACTOR, entryCreatedAt: 1 }],
        });
        expect(job?.input.mirrorTargets).toEqual([{ charId: ACTOR, entryCreatedAt: 1 }]);
    });
});

describe('repairStoryTheaterFictionMirrors', () => {
    it('只删虚构剧场的镜像，保留真实陪伴镜像和普通聊天', async () => {
        const fiction = entry('repair-fiction', false);
        const real = entry('repair-real', true);

        const centralId = await DB.saveMessage({
            charId: storyTheaterThreadId(fiction.id),
            role: 'assistant',
            type: 'text',
            content: '<scene_header>目黑区</scene_header>',
            metadata: { source: 'story_theater', theaterId: fiction.id },
        });
        const fictionMirror = await DB.saveMessage({
            charId: ACTOR,
            role: 'assistant',
            type: 'text',
            content: '<scene_header>目黑区</scene_header>',
            metadata: { source: 'story_theater_memory', theaterId: fiction.id, theaterCentralId: centralId },
        });
        await DB.updateMessageMetadata(centralId, previous => ({ ...previous, theaterMirrorIds: { [ACTOR]: fictionMirror } }));
        const realMirror = await DB.saveMessage({
            charId: ACTOR,
            role: 'assistant',
            type: 'text',
            content: '真实陪伴',
            metadata: { source: 'story_theater_memory', theaterId: real.id },
        });
        const plainChat = await DB.saveMessage({ charId: ACTOR, role: 'user', type: 'text', content: '普通聊天' });
        // 已经被移出卡司的旧收件人那边也要能扫到。
        const strayMirror = await DB.saveMessage({
            charId: OTHER_ACTOR,
            role: 'assistant',
            type: 'text',
            content: '<scene_header>目黑区</scene_header>',
            metadata: { source: 'story_theater_memory', theaterId: fiction.id },
        });

        const result = await repairStoryTheaterFictionMirrors([fiction, real], [ACTOR, OTHER_ACTOR]);
        expect(result.deletedMessageCount).toBe(2);
        expect(result.storyTitles).toEqual([fiction.id]);

        const actorRows = await DB.getMessagesByCharId(ACTOR, true);
        expect(actorRows.map(row => row.id).sort()).toEqual([realMirror, plainChat].sort());
        expect(await DB.getMessagesByCharId(OTHER_ACTOR, true)).toEqual([]);
        expect(strayMirror).toBeGreaterThan(0);

        // 剧情沙盒正文保留，只是不再指向已删掉的镜像。
        const centralRows = await DB.getMessagesByCharId(storyTheaterThreadId(fiction.id), true);
        expect(centralRows).toHaveLength(1);
        expect(centralRows[0].metadata?.theaterMirrorIds).toEqual({});

        // 再跑一次是空操作。
        expect((await repairStoryTheaterFictionMirrors([fiction, real], [ACTOR, OTHER_ACTOR])).deletedMessageCount).toBe(0);
    });
});
