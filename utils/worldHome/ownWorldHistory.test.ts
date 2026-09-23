import { describe, expect, it } from 'vitest';
import { buildOwnWorldHistory } from './engine';
import type { WorldProfile, WorldEpisode, WorldCharBeat } from '../../types';

// 摘自上游 utils/worldHome/reroll.test.ts 的「本人经历」那一条。
// 上游那份其余用例测的是它重写后的重演（整轮回滚 + 原子替换），本 fork 保留自己的重演
// （关系锁 / 改名历史 / 礼物 / 约定 / 卡片同步），所以那些用例没有搬。
const beat = (text = '旧剧情'): WorldCharBeat => ({ charId: 'a', charName: '甲', location: '公园', mood: '平静', narrative: text,
    memo: [text + '备忘'], phone: { dms: [{ to: '乙', lines: [text] }] },
    relationshipDeltas: [{ withName: '乙', delta: 10, newLabel: '旧标签' }],
});
const world = (id: string): WorldProfile => ({ id, name: '镇', worldview: '', mode: 'light', timeMode: 'sim',
    storyClock: 1, memberIds: ['a', 'b'], npcs: [], houses: [], relationships: [{ fromId: 'a', toId: 'b', value: 100, label: '旧标签' }], createdAt: 0, updatedAt: 0 });
const episode = (id: string): WorldEpisode => ({ id: id + '-ep', worldId: id, round: 1, storyTime: '第1天中午', trigger: 'observe', createdAt: 1,
    summary: '旧梗概', beats: [beat()] });

describe('家园：本人经历进入后续上下文', () => {
    it('本人最新正文和备忘进入后续上下文，不泄露其他角色私人叙事', () => {
        const w = world('history'), ep = episode(w.id);
        ep.beats = [beat('新剧情'), { ...beat('他人秘密'), charId: 'b' }];
        const context = buildOwnWorldHistory(w, [ep], 'a');
        expect(context).toContain('新剧情备忘'); expect(context).not.toContain('旧剧情'); expect(context).not.toContain('他人秘密');
        expect(buildOwnWorldHistory({ ...w, simSummarizedClock: 1 }, [ep], 'a')).toBe('');
    });
});
