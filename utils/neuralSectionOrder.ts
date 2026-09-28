/**
 * 神经链接「设定」页的模块顺序。
 *
 * 顺序是全局的（所有角色共用一套），只存在这台设备的 localStorage 里——
 * 纯界面偏好，不进备份、不影响任何提示词。
 * 读回来的时候会做一次整理：丢掉不认识的、去重、把以后新加的模块补到末尾，
 * 所以哪怕存的是旧版本的顺序，也不会有模块凭空消失。
 */

export type NeuralSectionId =
    | 'group'
    | 'prompt'
    | 'worldview'
    | 'identity'
    | 'wardrobe'
    | 'time'
    | 'lifeRecord'
    | 'voice'
    | 'worldbook';

export const NEURAL_SECTIONS: ReadonlyArray<{ id: NeuralSectionId; label: string }> = [
    { id: 'group', label: '分组' },
    { id: 'prompt', label: '核心指令' },
    { id: 'worldview', label: '世界观 / 设定补充' },
    { id: 'identity', label: '身份归属' },
    { id: 'wardrobe', label: '生图衣橱' },
    { id: 'time', label: '时间感知 & 时区' },
    { id: 'lifeRecord', label: '生活记录注入' },
    { id: 'voice', label: '角色语音音色' },
    { id: 'worldbook', label: '扩展设定（世界书）' },
];

export const DEFAULT_NEURAL_SECTION_ORDER: NeuralSectionId[] = NEURAL_SECTIONS.map(s => s.id);

export const NEURAL_SECTION_ORDER_KEY = 'os_neural_section_order';

export function normalizeNeuralSectionOrder(raw: unknown): NeuralSectionId[] {
    const known = new Set<string>(DEFAULT_NEURAL_SECTION_ORDER);
    const out: NeuralSectionId[] = [];
    if (Array.isArray(raw)) {
        for (const id of raw) {
            if (typeof id === 'string' && known.has(id) && !out.includes(id as NeuralSectionId)) {
                out.push(id as NeuralSectionId);
            }
        }
    }
    for (const id of DEFAULT_NEURAL_SECTION_ORDER) {
        if (!out.includes(id)) out.push(id);
    }
    return out;
}

/** 把某个模块往上（-1）或往下（+1）挪一格；到头了就原样返回。 */
export function moveNeuralSection(order: NeuralSectionId[], id: NeuralSectionId, delta: -1 | 1): NeuralSectionId[] {
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return order;
    const next = order.slice();
    [next[from], next[to]] = [next[to], next[from]];
    return next;
}

export function loadNeuralSectionOrder(): NeuralSectionId[] {
    try {
        const raw = localStorage.getItem(NEURAL_SECTION_ORDER_KEY);
        return normalizeNeuralSectionOrder(raw ? JSON.parse(raw) : null);
    } catch {
        return DEFAULT_NEURAL_SECTION_ORDER.slice();
    }
}

export function saveNeuralSectionOrder(order: NeuralSectionId[]): void {
    try { localStorage.setItem(NEURAL_SECTION_ORDER_KEY, JSON.stringify(order)); } catch {}
}
