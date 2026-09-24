import { describe, expect, it } from 'vitest';
import type { APIConfig, ApiPreset } from '../types';
import { resolveStoryApi } from './storyApiPreset';

const main = { baseUrl: 'https://main.example/v1', apiKey: 'main-key', model: 'main-model' } as APIConfig;
const presets = [
    { id: 'p1', name: '剧情专用', config: { baseUrl: 'https://story.example/v1/', apiKey: 'story-key', model: 'story-model' } },
] as ApiPreset[];

describe('resolveStoryApi', () => {
    it('没选时跟随主 API', () => {
        expect(resolveStoryApi(presets, main, null)).toEqual({ api: main, preset: null, missing: false });
    });

    it('选了预设只换三件套，不改主配置对象', () => {
        const resolved = resolveStoryApi(presets, main, 'p1');
        expect(resolved.preset?.id).toBe('p1');
        expect(resolved.api.baseUrl).toBe('https://story.example/v1');
        expect(resolved.api.apiKey).toBe('story-key');
        expect(resolved.api.model).toBe('story-model');
        expect(main.model).toBe('main-model');
    });

    it('预设被删了就回到主 API 并标记', () => {
        expect(resolveStoryApi(presets, main, 'gone')).toEqual({ api: main, preset: null, missing: true });
    });
});
