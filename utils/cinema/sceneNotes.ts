/**
 * 影院的「助理笔记」：换场景时让一个模型看一眼截图，写一句客观的画面描述。
 * 角色平时读这些笔记跟剧情，不用每次都亲自看图——省的是角色那一大摞上下文，不是图。
 *
 * 笔记请求**只带一张图和一句指令**，不带人设、记忆、聊天记录，所以就算用主模型也很便宜。
 * 用哪个模型：识图中转（开着才用）→ 记忆宫殿副 API → 主 API。副 API 不会看图时，
 * 调用方（CinemaApp）把这一场降级到主 API（见 nextNoteModel）。
 */
import type { APIConfig } from '../../types';
import { safeFetchJson } from '../safeApi';
import { isVisionInputUnsupportedError } from '../userCameraSnapshot';

export type NoteModelSource = 'vision' | 'light' | 'main';

export interface NoteModel {
    source: NoteModelSource;
    baseUrl: string;
    apiKey: string;
    model: string;
}

interface ModelLike { baseUrl?: string; apiKey?: string; model?: string }

const usable = (m?: ModelLike | null): m is Required<ModelLike> => !!m?.baseUrl?.trim() && !!m?.model?.trim();

const toModel = (source: NoteModelSource, m: ModelLike): NoteModel => ({
    source, baseUrl: String(m.baseUrl).trim().replace(/\/+$/, ''), apiKey: m.apiKey || '', model: String(m.model).trim(),
});

/** 按顺序列出能用的模型：识图中转 → 副 API → 主 API。 */
export const noteModelCandidates = (apiConfig: APIConfig, lightLLM?: ModelLike | null): NoteModel[] => {
    const out: NoteModel[] = [];
    if (apiConfig.visionApi?.enabled && usable(apiConfig.visionApi)) out.push(toModel('vision', apiConfig.visionApi));
    if (usable(lightLLM)) out.push(toModel('light', lightLLM));
    if (usable(apiConfig)) out.push(toModel('main', apiConfig));
    return out;
};

/** 当前这个不会看图，换下一个；没有下一个了返回 null。 */
export const nextNoteModel = (candidates: NoteModel[], current: NoteModel): NoteModel | null => {
    const index = candidates.findIndex(c => c.source === current.source);
    return index >= 0 && index + 1 < candidates.length ? candidates[index + 1] : null;
};

export const NOTE_MODEL_LABEL: Record<NoteModelSource, string> = {
    vision: '识图模型',
    light: '副 API',
    main: '主 API',
};

const NOTE_INSTRUCTION = '你是观影助理。用一句中文（40 字以内）客观描述这张影视截图：谁在做什么、在什么地方、气氛如何；画面里有字幕就把字幕原文带上。只描述，不评论，不猜剧情，不要加前缀。';

/** 把模型回的话收拾成一句笔记。 */
export const cleanNote = (raw: string): string => String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[「"'\s]+|[」"'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

export class NoteVisionUnsupportedError extends Error {
    constructor(readonly source: NoteModelSource, cause: unknown) {
        super(`${NOTE_MODEL_LABEL[source]}不会看图：${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'NoteVisionUnsupportedError';
    }
}

export async function describeFrame(model: NoteModel, dataUrl: string, charName?: string): Promise<string> {
    let data: any;
    try {
        data = await safeFetchJson(`${model.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${model.apiKey || 'sk-none'}` },
            body: JSON.stringify({
                model: model.model,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: NOTE_INSTRUCTION },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                }],
                temperature: 0.3,
                max_tokens: 200,
                stream: false,
            }),
        }, 0, 0, { appName: '影院', charName, purpose: `画面笔记（${NOTE_MODEL_LABEL[model.source]}）` });
    } catch (error) {
        if (isVisionInputUnsupportedError(error)) throw new NoteVisionUnsupportedError(model.source, error);
        throw error;
    }
    const note = cleanNote(data?.choices?.[0]?.message?.content || '');
    if (!note) throw new Error('助理这次没写出笔记（模型返回为空）');
    return note;
}
