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

/** 写笔记时顺手带给助理的参考：片名、前几条笔记（让人物称呼前后一致）、此刻的台词。 */
export interface NoteContext {
    work?: string;
    prevNotes?: string[];
    subtitles?: string[];
    /** 台词另有来源（外挂 SRT，或小插件在读 B站 字幕）：画面上印着的字幕就不用抄了，台词以那份为准 */
    hasTextSubs?: boolean;
}

/** 笔记最长多少字（10-01 用户要详细一些、每个人分清楚：从一句 40 字改成两到四句）。 */
export const NOTE_MAX_CHARS = 300;

export const buildNoteInstruction = (ctx: NoteContext = {}): string => {
    const prev = (ctx.prevNotes || []).filter(Boolean).slice(-3);
    const subs = (ctx.subtitles || []).filter(Boolean).slice(-3);
    return [
        `你是观影助理，替一个此刻没看屏幕的人记下画面。这是${ctx.work ? ctx.work : '一部影视作品'}的一张截图。用中文写 2~4 句、150 字以内的客观描述：`,
        '- 画面里的**每个人分开写**：是谁（认得出是这部作品里的哪个角色就写名字；认不出就用稳定的外貌特征称呼，比如「银发精灵少女」「戴眼镜的高个男人」），表情神态、在做什么、在画面哪里、在跟谁互动。',
        '- 地点、时间、光线和气氛；镜头是特写、近景还是远景。',
        ctx.hasTextSubs
            ? '- 画面上印着的字幕**不用抄**（台词另有字幕文件）；招牌、信件、屏幕这类画面里别的文字照原文带上。'
            : '- 画面上出现的文字或字幕照原文带上。',
        '只写看得见的，不评论，不猜后面的剧情。写成一段话，不要分点，不要加「画面中」之类的前缀。',
        prev.length ? `\n前面几条笔记（同一个人的称呼请跟它们保持一致）：\n${prev.map(n => `· ${n}`).join('\n')}` : '',
        subs.length ? `\n这会儿播放器上的台词（可以帮你认出是谁在说话）：\n${subs.map(s => `· ${s}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
};

/** 把模型回的话收拾成一句笔记。 */
export const cleanNote = (raw: string): string => String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[「"'\s]+|[」"'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NOTE_MAX_CHARS);

export class NoteVisionUnsupportedError extends Error {
    constructor(readonly source: NoteModelSource, cause: unknown) {
        super(`${NOTE_MODEL_LABEL[source]}不会看图：${cause instanceof Error ? cause.message : String(cause)}`);
        this.name = 'NoteVisionUnsupportedError';
    }
}

export async function describeFrame(model: NoteModel, dataUrl: string, charName?: string, ctx?: NoteContext): Promise<string> {
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
                        { type: 'text', text: buildNoteInstruction(ctx) },
                        { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                }],
                temperature: 0.3,
                // 会思考的模型（Gemini 3 等）思考也算在这里面，给小了笔记会被挤断
                max_tokens: 2000,
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
