import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeFetchJson = vi.fn();
vi.mock('../safeApi', () => ({ safeFetchJson: (...args: any[]) => safeFetchJson(...args) }));

const { cleanNote, describeFrame, nextNoteModel, noteModelCandidates, NoteVisionUnsupportedError } = await import('./sceneNotes');

const main = { baseUrl: 'https://main.example/v1/', apiKey: 'k', model: 'big-vision' } as any;
const light = { baseUrl: 'https://light.example/v1', apiKey: 'l', model: 'small' };

describe('助理用哪个模型', () => {
    it('识图中转开着就先用它，然后副 API，最后主 API', () => {
        const withVision = { ...main, visionApi: { enabled: true, baseUrl: 'https://v.example', apiKey: 'v', model: 'eye' } };
        expect(noteModelCandidates(withVision, light).map(m => m.source)).toEqual(['vision', 'light', 'main']);
    });

    it('用户的情况：没配识图中转、配了副 API → 先副 API，不会看图就换主 API', () => {
        const list = noteModelCandidates(main, light);
        expect(list.map(m => m.source)).toEqual(['light', 'main']);
        expect(nextNoteModel(list, list[0])?.source).toBe('main');
        expect(nextNoteModel(list, list[1])).toBeNull();
        expect(list[1].baseUrl).toBe('https://main.example/v1');
    });

    it('识图中转关着、副 API 没填 → 只剩主 API', () => {
        const off = { ...main, visionApi: { enabled: false, baseUrl: 'x', apiKey: '', model: 'y' } };
        expect(noteModelCandidates(off, { baseUrl: '', model: '' }).map(m => m.source)).toEqual(['main']);
    });
});

describe('写一条画面笔记', () => {
    // 花括号不能省：箭头函数直接返回 mock 的话，vitest 会把它当成收尾函数再调一次
    beforeEach(() => { safeFetchJson.mockReset(); });

    it('只发一张图和一句指令（不带人设和聊天记录）', async () => {
        safeFetchJson.mockResolvedValue({ choices: [{ message: { content: '「女主在雨夜的钟楼里翻日记」' } }] });
        const [model] = noteModelCandidates(main, light);
        const note = await describeFrame(model, 'data:image/jpeg;base64,xx', '萧逸');
        expect(note).toBe('女主在雨夜的钟楼里翻日记');
        const body = JSON.parse(safeFetchJson.mock.calls[0][1].body);
        expect(body.model).toBe('small');
        expect(body.messages).toHaveLength(1);
        expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xx' } });
    });

    it('模型不收图片 → 抛「不会看图」，让调用方换模型', async () => {
        safeFetchJson.mockRejectedValue(new Error('400: this model does not support image input'));
        const [model] = noteModelCandidates(main, light);
        const error = await describeFrame(model, 'data:image/jpeg;base64,xx').catch(e => e);
        expect(error instanceof NoteVisionUnsupportedError).toBe(true);
        expect(error.source).toBe('light');
    });

    it('笔记收拾干净、太长截断', () => {
        expect(cleanNote('<think>嗯</think>  男主  推开门 ')).toBe('男主 推开门');
        expect(cleanNote('字'.repeat(200))).toHaveLength(80);
    });
});
