/**
 * 剧情（StoryTheater）专用的 API 预设。
 *
 * 只记一个预设 id，不复制 URL / Key：预设在设置里改了，剧情这边跟着变；预设被删了
 * 就自动回到主 API，不会拿着一份过期的 Key 悄悄发请求。
 *
 * 只影响剧情模式——主 apiConfig、聊天、见面陪伴都不动。
 */

import type { APIConfig, ApiPreset } from '../types';
import { configFromPreset } from './apiPresetSwitch';

export const STORY_API_PRESET_STORAGE_KEY = 'sully_story_theater_api_preset_v1';

export function readStoryApiPresetId(): string | null {
    try {
        const value = localStorage.getItem(STORY_API_PRESET_STORAGE_KEY);
        return value ? value : null;
    } catch {
        return null;
    }
}

export function writeStoryApiPresetId(presetId: string | null): void {
    try {
        if (presetId) localStorage.setItem(STORY_API_PRESET_STORAGE_KEY, presetId);
        else localStorage.removeItem(STORY_API_PRESET_STORAGE_KEY);
    } catch { /* 存不了就只在本次打开期间生效 */ }
}

export interface ResolvedStoryApi {
    /** 剧情这一轮真正要用的配置 */
    api: APIConfig;
    /** 选中的剧情专用预设；跟随主 API 时为 null */
    preset: ApiPreset | null;
    /** 记着的预设已经在设置里被删掉了（已自动回到主 API） */
    missing: boolean;
}

export function resolveStoryApi(
    presets: ApiPreset[],
    mainApi: APIConfig,
    presetId: string | null,
): ResolvedStoryApi {
    if (!presetId) return { api: mainApi, preset: null, missing: false };
    const preset = presets.find(item => item.id === presetId) || null;
    if (!preset) return { api: mainApi, preset: null, missing: true };
    return { api: { ...mainApi, ...configFromPreset(preset) }, preset, missing: false };
}

/** 剧情单独选了 API 时，后台生成用的云端凭据行——不能占角色私聊的 instant 那一格。 */
export const storyCredId = (threadId: string): string => `${threadId}/instant`;
