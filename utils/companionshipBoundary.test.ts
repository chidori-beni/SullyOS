import { describe, it, expect } from 'vitest';
import {
    buildCompanionshipBoundary,
    companionshipBoundaryOn,
    COMPANIONSHIP_HEADING,
} from './companionshipBoundary';

describe('「陪伴，不监督」边界', () => {
    describe('开关', () => {
        it('⭐ 缺省开 —— 这条原本在通话里是无条件生效的，缺省开才保得住现有行为', () => {
            expect(companionshipBoundaryOn(undefined)).toBe(true);
            expect(companionshipBoundaryOn(null)).toBe(true);
            expect(companionshipBoundaryOn({})).toBe(true);
            expect(companionshipBoundaryOn({ companionshipBoundaryEnabled: true })).toBe(true);
        });

        it('只有显式 false 才算关（想要唠叨型角色的人）', () => {
            expect(companionshipBoundaryOn({ companionshipBoundaryEnabled: false })).toBe(false);
        });

        it('⛔ 关掉 → 空串，一个字都不注入', () => {
            expect(buildCompanionshipBoundary('chat', false)).toBe('');
            expect(buildCompanionshipBoundary('call', false)).toBe('');
        });
    });

    describe('文案', () => {
        it('两个场景都带小标题', () => {
            expect(buildCompanionshipBoundary('chat')).toContain(COMPANIONSHIP_HEADING);
            expect(buildCompanionshipBoundary('call')).toContain(COMPANIONSHIP_HEADING);
        });

        it('⭐ 核心那句：分享近况 ≠ 把进度交给你管理', () => {
            expect(buildCompanionshipBoundary('chat')).toContain('通常是在分享近况，不是在把进度交给你管理');
        });

        it('⭐ 明确禁掉催促的几种形态', () => {
            const t = buildCompanionshipBoundary('chat');
            for (const x of ['不要催快点', '追问做完没有', '倒计时', '布置下一步']) {
                expect(t).toContain(x);
            }
        });

        it('⭐ 关心不等于监督，更不等于管教', () => {
            expect(buildCompanionshipBoundary('chat')).toContain('关心不等于监督，更不等于管教');
        });

        it('⭐⛔ 必须留「明确要求提醒」的例外 —— 不然这条会变成「角色拒绝帮忙」', () => {
            const t = buildCompanionshipBoundary('chat');
            expect(t).toContain('只有对方明确要求你提醒、督促或帮忙安排时');
            expect(t).toContain('不把一次授权扩展成长期监督，也不反复催促');
        });

        it('⭐⛔ 聊天说「本次对话」，通话说「本通电话」—— 在聊天里说电话会让角色以为在打电话', () => {
            const chat = buildCompanionshipBoundary('chat');
            const call = buildCompanionshipBoundary('call');
            expect(chat).toContain('这条边界在本次对话后续持续有效');
            expect(chat).not.toContain('本通电话');
            expect(call).toContain('这条边界在本通电话后续持续有效');
            expect(call).not.toContain('本次对话');
        });

        it('⛔ 除了那一处措辞，两边逐字相同 —— 共用一份就是为了不漂', () => {
            const chat = buildCompanionshipBoundary('chat');
            const call = buildCompanionshipBoundary('call');
            expect(chat.replace('本次对话', '§')).toBe(call.replace('本通电话', '§'));
        });

        it('⭐ 兜底那句：表达在意优先用陪伴，而不是指挥对方立刻行动', () => {
            expect(buildCompanionshipBoundary('call')).toContain('而不是指挥对方立刻行动');
        });
    });
});
