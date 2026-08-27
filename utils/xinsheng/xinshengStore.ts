// 心声的持久化：历史记录（按角色）+ 预设库（全局）。
//
// 全部走 DB.getAssetRaw / saveAssetRaw 这个现成的 JSON 键值区，**不新建 objectStore**：
//   · 不用动 DB_VERSION，就没有升级迁移这一类事故面（这个库被多标签页/PWA 同时开着）
//   · assets 表本来就在全量导出与云备份的名单里，心声历史和预设自动跟着一起备份还原
// 代价是拿不到索引，但心声的读写模式（按角色整取整存、预设库整取整存）本来也不需要。

import { DB } from '../db';
import type { XinshengEntry } from './xinshengData';

const HISTORY_KEY = (charId: string) => `xinsheng_history_${charId}`;
const PRESETS_KEY = 'xinsheng_presets';
const RANDOM_ENABLED_KEY = 'xinsheng_preset_random_enabled';
const LAST_RANDOM_KEY = 'xinsheng_preset_last_random_id';

/** 历史上限。超出后从最旧的开始删，但收藏过的永远留着。 */
export const XINSHENG_HISTORY_CAP = 100;

/** 一条历史 = 一轮回复。key 是 roundId（见 xinshengRound.ts）。 */
export type XinshengHistory = Record<string, XinshengEntry>;

// ─── 历史 ───

export const readXinshengHistory = async (charId: string): Promise<XinshengHistory> => {
    if (!charId) return {};
    try {
        const raw = await DB.getAssetRaw(HISTORY_KEY(charId));
        return raw && typeof raw === 'object' ? (raw as XinshengHistory) : {};
    } catch (e) {
        console.warn('[xinsheng] 读历史失败:', e);
        return {};
    }
};

export const writeXinshengHistory = async (charId: string, history: XinshengHistory): Promise<void> => {
    if (!charId) return;
    try {
        await DB.saveAssetRaw(HISTORY_KEY(charId), history);
    } catch (e) {
        console.warn('[xinsheng] 写历史失败:', e);
    }
};

/**
 * roundId 按时间前缀生成，所以字典序 = 时间序。
 * 排序单独抽出来，是因为历史里可能混入手工导入/旧格式的 key，`sort()` 的默认行为
 * 至少保证「同一格式内有序」，不至于翻页乱跳。
 */
export const sortRoundIds = (ids: string[]): string[] => [...ids].sort();

/**
 * 落一条心声。超上限时淘汰最旧的非收藏条目。
 *
 * 每次都整取整存：心声一轮才写一次，不是热路径；而 read-modify-write 能保证
 * 「主动消息在后台落的那一条」和「前台这一轮」不会互相覆盖掉对方的收藏标记。
 */
export const appendXinshengEntry = async (
    charId: string,
    roundId: string,
    entry: XinshengEntry,
): Promise<void> => {
    if (!charId || !roundId) return;
    const history = await readXinshengHistory(charId);
    history[roundId] = { ...entry, _at: entry._at ?? Date.now() };

    const ids = sortRoundIds(Object.keys(history));
    if (ids.length > XINSHENG_HISTORY_CAP) {
        for (const id of ids.slice(0, ids.length - XINSHENG_HISTORY_CAP)) {
            if (!history[id]?._favorited) delete history[id];
        }
    }
    await writeXinshengHistory(charId, history);
};

export const deleteXinshengEntry = async (charId: string, roundId: string): Promise<XinshengHistory> => {
    const history = await readXinshengHistory(charId);
    delete history[roundId];
    await writeXinshengHistory(charId, history);
    return history;
};

/** 清空：保留收藏（和糯叽机的「清空全部」一致，收藏是用户的显式挽留）。 */
export const clearXinshengHistory = async (charId: string): Promise<XinshengHistory> => {
    const history = await readXinshengHistory(charId);
    const kept: XinshengHistory = {};
    for (const [id, e] of Object.entries(history)) {
        if (e?._favorited) kept[id] = e;
    }
    await writeXinshengHistory(charId, kept);
    return kept;
};

export const toggleXinshengFavorite = async (charId: string, roundId: string): Promise<XinshengHistory> => {
    const history = await readXinshengHistory(charId);
    const cur = history[roundId];
    if (!cur) return history;
    history[roundId] = { ...cur, _favorited: !cur._favorited };
    await writeXinshengHistory(charId, history);
    return history;
};

// ─── 预设库 ───

/**
 * 一个心声预设 = 布局 + CSS + 提示词 + 字段可见性，四件套一起分发。
 * 字段名和糯叽机导出的 JSON 完全一致 —— 论坛下载的 `.json` 要能直接导入。
 */
export interface XinshengPreset {
    id: string;
    name: string;
    customCss: string;
    customPrompt: string;
    layout: string;
    displayMode: 'planner' | 'layout';
    aiVisibleFields: string;
    createdAt: number;
    updatedAt?: number;
}

/** 糯叽机导出文件的信封。导入时按这个校验。 */
export const XINSHENG_PRESET_FILE_TYPE = 'nuojiji.xinsheng.preset';
export const XINSHENG_PRESET_FILE_VERSION = 2;

const newPresetId = (seed = 0): string =>
    `xp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${seed}`;

/**
 * 把任意来源的对象补齐成合法预设。
 * `template` 是糯叽机 v1 导出里 customCss 的旧名字，这里一并兼容。
 */
export const normalizePreset = (raw: any, index = 0): XinshengPreset => {
    const layout = typeof raw?.layout === 'string' ? raw.layout : '';
    return {
        id: raw?.id || newPresetId(index),
        name: String(raw?.name || '').slice(0, 60) || `预设 ${index + 1}`,
        customCss: typeof raw?.customCss === 'string'
            ? raw.customCss
            : (typeof raw?.template === 'string' ? raw.template : ''),
        customPrompt: typeof raw?.customPrompt === 'string' ? raw.customPrompt : '',
        layout,
        // 有布局文本就一定是布局模式：v1 的导出没有 displayMode 字段，
        // 靠这条推断才不会把论坛美化装成「默认卡 + 一份用不上的 CSS」
        displayMode: raw?.displayMode === 'layout' || layout.trim() ? 'layout' : 'planner',
        aiVisibleFields: typeof raw?.aiVisibleFields === 'string' ? raw.aiVisibleFields : 'innerVoice',
        createdAt: typeof raw?.createdAt === 'number' ? raw.createdAt : Date.now(),
        updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : undefined,
    };
};

export const listXinshengPresets = async (): Promise<XinshengPreset[]> => {
    try {
        const raw = await DB.getAssetRaw(PRESETS_KEY);
        if (!Array.isArray(raw)) return [];
        return raw
            .filter(p => p && typeof p === 'object' && typeof p.name === 'string')
            .map((p, i) => normalizePreset(p, i));
    } catch (e) {
        console.warn('[xinsheng] 读预设库失败:', e);
        return [];
    }
};

const savePresets = async (list: XinshengPreset[]): Promise<void> => {
    await DB.saveAssetRaw(PRESETS_KEY, list);
};

export const saveXinshengPreset = async (
    name: string,
    body: Omit<XinshengPreset, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
): Promise<string | null> => {
    try {
        const list = await listXinshengPresets();
        const preset = normalizePreset({ ...body, name, createdAt: Date.now() }, list.length);
        await savePresets([...list, preset]);
        return preset.id;
    } catch (e) {
        console.warn('[xinsheng] 保存预设失败:', e);
        return null;
    }
};

export const updateXinshengPreset = async (
    id: string,
    name: string,
    body: Omit<XinshengPreset, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
): Promise<boolean> => {
    try {
        const list = await listXinshengPresets();
        const idx = list.findIndex(p => p.id === id);
        if (idx < 0) return false;
        list[idx] = normalizePreset({ ...list[idx], ...body, id, name, updatedAt: Date.now() }, idx);
        await savePresets(list);
        return true;
    } catch (e) {
        console.warn('[xinsheng] 更新预设失败:', e);
        return false;
    }
};

export const deleteXinshengPreset = async (id: string): Promise<XinshengPreset[]> => {
    const list = (await listXinshengPresets()).filter(p => p.id !== id);
    await savePresets(list);
    return list;
};

/**
 * 导入预设。默认 merge（追加），重名自动加 (2) (3)，id 冲突重新发一个。
 * 论坛上同一个作者的不同版本经常同名，直接覆盖会让人丢掉正在用的那份。
 */
export const importXinshengPresets = async (
    incoming: any[],
    mode: 'merge' | 'replace' = 'merge',
): Promise<{ count: number; saved: XinshengPreset[] }> => {
    if (!Array.isArray(incoming) || incoming.length === 0) return { count: 0, saved: [] };
    const normalized = incoming
        .filter(p => p && typeof p === 'object')
        .map((p, i) => normalizePreset({ ...p, id: newPresetId(i) }, i));
    if (normalized.length === 0) return { count: 0, saved: [] };

    if (mode === 'replace') {
        await savePresets(normalized);
        return { count: normalized.length, saved: normalized };
    }

    const existing = await listXinshengPresets();
    const usedIds = new Set(existing.map(p => p.id));
    const usedNames = new Set(existing.map(p => p.name));
    const merged = [...existing];
    const saved: XinshengPreset[] = [];

    for (const p of normalized) {
        let id = p.id;
        let seed = 0;
        while (usedIds.has(id)) id = newPresetId(seed++);
        usedIds.add(id);

        let name = p.name;
        let n = 2;
        while (usedNames.has(name)) name = `${p.name} (${n++})`;
        usedNames.add(name);

        const one = { ...p, id, name };
        merged.push(one);
        saved.push(one);
    }
    await savePresets(merged);
    return { count: saved.length, saved };
};

/** 导出成糯叽机同款单预设文件，能被糯叽机原样导回去。 */
export const buildPresetExportFile = (preset: XinshengPreset): string =>
    JSON.stringify({
        type: XINSHENG_PRESET_FILE_TYPE,
        version: XINSHENG_PRESET_FILE_VERSION,
        exportedAt: new Date().toISOString(),
        preset: {
            name: preset.name,
            customCss: preset.customCss,
            customPrompt: preset.customPrompt,
            layout: preset.layout,
            displayMode: preset.displayMode,
            aiVisibleFields: preset.aiVisibleFields,
        },
    }, null, 2);

/**
 * 解析导入文件。三种形状都收：
 *   · 单预设信封 `{type, version, preset}`（糯叽机的导出）
 *   · 多预设信封 `{type, version, presets: []}`
 *   · 裸数组（我们自己的整库导出）
 */
export const parsePresetImportFile = (text: string): any[] => {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return data;
    if (data?.preset && typeof data.preset === 'object') return [data.preset];
    if (Array.isArray(data?.presets)) return data.presets;
    // 没有信封但长得像预设本体（有 name + 布局或 CSS）也放行
    if (data && typeof data === 'object' && typeof data.name === 'string') return [data];
    return [];
};

// ─── 「每次生成随机换一个预设」 ───

export const isPresetRandomEnabled = async (): Promise<boolean> => {
    try {
        return (await DB.getAssetRaw(RANDOM_ENABLED_KEY)) === true;
    } catch {
        return false;
    }
};

export const setPresetRandomEnabled = async (on: boolean): Promise<void> => {
    try {
        await DB.saveAssetRaw(RANDOM_ENABLED_KEY, !!on);
    } catch (e) {
        console.warn('[xinsheng] 保存随机开关失败:', e);
    }
};

/**
 * 抽一个预设。会避开「上一次抽中的那个」——只有一个预设时除外。
 * 不避的话两个预设来回抽，用户平均每两轮就看到一次重复，随机的意义就没了。
 */
export const pickRandomPreset = async (): Promise<XinshengPreset | null> => {
    try {
        const list = await listXinshengPresets();
        if (list.length === 0) return null;
        if (list.length === 1) return list[0];

        let lastId: string | null = null;
        try { lastId = await DB.getAssetRaw(LAST_RANDOM_KEY); } catch { /* 没有就当没抽过 */ }

        const pool = lastId ? list.filter(p => p.id !== lastId) : list;
        const picked = (pool.length > 0 ? pool : list)[Math.floor(Math.random() * (pool.length > 0 ? pool.length : list.length))];
        try { await DB.saveAssetRaw(LAST_RANDOM_KEY, picked.id); } catch { /* 记不住就下次可能重复，不致命 */ }
        return picked;
    } catch (e) {
        console.warn('[xinsheng] 随机预设失败:', e);
        return null;
    }
};
