import type { StoryTheaterEntry } from '../types';
import { DB } from './db';
import { storyTheaterMemoryRecipientIds, storyTheaterThreadId } from './storyTheater';

export interface StoryTheaterMirrorRepairResult {
    deletedMessageCount: number;
    /** 受影响的剧情标题，用来给用户一句能看懂的提示。 */
    storyTitles: string[];
}

/**
 * 一次性自愈：清掉「虚构剧场」误写进角色聊天的剧情镜像。
 *
 * 背景：前台 saveCentralAndMirrors 一直会检查 writesToCharacterMemory，但后台生成
 * 路径（storyBackgroundJobs）以前不看这个开关，照样按全体演员写 story_theater_memory
 * 镜像。这些消息在私聊界面和聊天预览里都被过滤掉，用户看不见也删不掉，却会被
 * chatPrompts 以 [剧情：xxx] 注入角色上下文、并进入记忆宫殿的总结范围。
 *
 * 只删两个条件同时成立的消息：source === 'story_theater_memory'，且它指向的剧情
 * 现在是虚构剧场。真实时间陪伴的镜像是用户主动要的，一条都不动。
 */
export async function repairStoryTheaterFictionMirrors(
    entries: StoryTheaterEntry[],
    characterIds: string[],
): Promise<StoryTheaterMirrorRepairResult> {
    const fictionEntries = entries.filter(entry => entry.writesToCharacterMemory !== true);
    if (fictionEntries.length === 0) return { deletedMessageCount: 0, storyTitles: [] };

    const fictionTitles = new Map(fictionEntries.map(entry => [entry.id, entry.title || '未命名剧情']));
    // 现役演员 + 全部角色：剧情改过卡司之后，旧收件人那边的残留也要能扫到。
    const scanIds = new Set<string>(characterIds);
    for (const entry of fictionEntries) {
        for (const id of storyTheaterMemoryRecipientIds(entry)) scanIds.add(id);
    }

    const doomedIds = new Set<number>();
    const touchedStoryIds = new Set<string>();
    for (const charId of scanIds) {
        const messages = await DB.getMessagesByCharId(charId, true);
        for (const message of messages) {
            if (message.metadata?.source !== 'story_theater_memory') continue;
            const theaterId = String(message.metadata?.theaterId || '');
            if (!fictionTitles.has(theaterId)) continue;
            doomedIds.add(message.id);
            touchedStoryIds.add(theaterId);
        }
    }
    if (doomedIds.size === 0) return { deletedMessageCount: 0, storyTitles: [] };

    // 剧情沙盒里的正文仍然保留，只把指向已删镜像的索引擦掉，避免重 roll 时去改不存在的行。
    for (const storyId of touchedStoryIds) {
        const centralRows = await DB.getMessagesByCharId(storyTheaterThreadId(storyId), true);
        for (const row of centralRows) {
            const mirrorIds = row.metadata?.theaterMirrorIds as Record<string, number> | undefined;
            if (!mirrorIds || Object.keys(mirrorIds).length === 0) continue;
            await DB.updateMessageMetadata(row.id, previous => ({ ...previous, theaterMirrorIds: {} }));
        }
    }

    await DB.deleteMessages([...doomedIds]);
    return {
        deletedMessageCount: doomedIds.size,
        storyTitles: [...touchedStoryIds].map(id => fictionTitles.get(id) || '未命名剧情'),
    };
}
