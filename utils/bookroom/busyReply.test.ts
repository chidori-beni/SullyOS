import { beforeEach, describe, expect, it, vi } from 'vitest';

const saved: any[] = [];
const requests: any[] = [];
let slot: any = null;

vi.mock('../db', () => ({
    DB: {
        saveMessage: vi.fn(async (m: any) => { saved.push(m); }),
        getEmojis: vi.fn(async () => []),
        getEmojiCategories: vi.fn(async () => []),
    },
}));
vi.mock('../chatRequestPayload', () => ({
    buildChatRequestPayload: vi.fn(async () => ({ systemPrompt: 'SYS', cleanedApiMessages: [] })),
}));
vi.mock('../chatContextRange', () => ({ loadCharacterContextMessages: vi.fn(async () => []) }));
vi.mock('../safeApi', () => ({
    safeFetchJson: vi.fn(async (_url: string, init: any) => { requests.push(JSON.parse(init.body)); return { choices: [{ message: { content: '这句我也划了。' } }] }; }),
}));
vi.mock('./bookroomDb', () => ({ triggerMemoryPipeline: vi.fn(async () => undefined) }));
vi.mock('../dailySchedule', () => ({ getDailyScheduleForChar: vi.fn(async () => (slot ? { slots: [slot] } : null)) }));
vi.mock('../scheduleContext', () => ({
    createScheduleContextSnapshot: vi.fn((_c: any, schedule: any) => ({ schedule, current: slot, instant: new Date(0) })),
}));

import { askCharacterInBookroom, BookroomBusyError, checkCharBusy } from './highlightReply';

const baseChar: any = { id: 'c1', name: '萧逸', scheduleFeatureEnabled: true };
const ask = (kind: string, extra: Record<string, unknown> = {}, char: any = baseChar) => askCharacterInBookroom({
    char, userProfile: { name: '千夜' } as any, groups: [], apiConfig: { baseUrl: 'http://x', apiKey: 'k', model: 'm' } as any,
    message: '【书房 · 划线】…', instruction: '[认真回]', kind, purpose: 't', novelId: 'n1', bookTitle: '雨', ...extra,
});

beforeEach(() => { saved.length = 0; requests.length = 0; slot = null; });

describe('书房请角色回话：忙就先不回', () => {
    it('空闲：照常回，回复卡片带书名', async () => {
        slot = { activity: '看书', busyLevel: 'free' };
        await expect(ask('highlight')).resolves.toBe('这句我也划了。');
        expect(saved.map(m => m.role)).toEqual(['user', 'assistant']);
        expect(saved[1].metadata).toMatchObject({ source: 'bookroom', bookroomKind: 'highlight-reply', bookroomBookTitle: '雨' });
    });

    it('边忙边能看手机：算有空，照常认真回', async () => {
        slot = { activity: '通勤', busyLevel: 'light' };
        await ask('review');
        expect(saved).toHaveLength(2);
    });

    it('忙 / 睡：不调模型、什么都不发，抛出「在忙」让书房排队（开没开自动回复都一样）', async () => {
        for (const [busyLevel, activity] of [['busy', '开会'], ['sleep', '睡觉']]) {
            slot = { activity, busyLevel };
            const err = await ask('highlight', {}, { ...baseChar, busyAutoReplyEnabled: true }).catch(e => e);
            expect(err).toBeInstanceOf(BookroomBusyError);
            expect(err.activity).toBe(activity);
            expect(saved).toHaveLength(0);
            expect(requests).toHaveLength(0);
        }
    });

    it('补回（deferred）：不再查忙不忙；提示词说明是几点分享的、要认真回；卡片标上补回', async () => {
        slot = { activity: '开会', busyLevel: 'busy' };
        await ask('highlight', { deferred: { since: new Date(2026, 8, 28, 14, 5).getTime(), activity: '开会' } });
        expect(requests[0].messages[0].content).toContain('9月28日 14:05');
        expect(requests[0].messages[0].content).toContain('正在「开会」');
        expect(requests[0].messages[0].content).toContain('不要敷衍');
        expect(saved[1].metadata.bookroomDeferredSince).toBeTypeOf('number');
    });

    it('补回重试：用户那条已经发过就不再发', async () => {
        const seen = vi.fn();
        await ask('highlight', { deferred: { since: 1 }, skipUserMessage: true, onUserMessageSaved: seen });
        expect(saved.map(m => m.role)).toEqual(['assistant']);
        expect(seen).not.toHaveBeenCalled();
    });

    it('日程功能没开 / 当天没日程：当作有空', async () => {
        slot = { activity: '开会', busyLevel: 'busy' };
        expect(await checkCharBusy({ ...baseChar, scheduleFeatureEnabled: false })).toBeNull();
        slot = null;
        expect(await checkCharBusy(baseChar)).toBeNull();
    });
});
