import { describe, expect, it } from 'vitest';
import type { ScheduleCardAppearance, ScheduleCardSkinPreset } from '../types';
import { validateScopedCss } from './scopedCss';
import {
    MONO_DOT_SCHEDULE_CSS,
    PLUSH_BEAR_SCHEDULE_CSS,
    SCHEDULE_CSS_SCOPE_HINT,
    SCHEDULE_CSS_SCOPE_REGEX,
    SCHEDULE_SKIN_PRESET_LIMIT,
    applyScheduleSkinPreset,
    removeScheduleSkinPreset,
    renameScheduleSkinPreset,
    upsertScheduleSkinPreset,
} from './scheduleAppearance';

const draft: ScheduleCardAppearance = {
    preset: 'plush',
    background: '#fffdfb',
    textColor: '#6b5647',
    accentColor: '#a9866a',
    customCss: '.sully-schedule-root{border-radius:24px!important;}',
};

const okOrThrow = (result: ReturnType<typeof upsertScheduleSkinPreset>) => {
    if ('error' in result) throw new Error(result.error);
    return result;
};

describe.each([
    ['轻松熊奶油', PLUSH_BEAR_SCHEDULE_CSS],
    ['黑白波点', MONO_DOT_SCHEDULE_CSS],
])('内置皮肤 CSS · %s', (_name, css) => {
    it('只用日程作用域的选择器，能通过白框校验', () => {
        const validation = validateScopedCss(css, SCHEDULE_CSS_SCOPE_REGEX, SCHEDULE_CSS_SCOPE_HINT);

        expect(validation.errors).toEqual([]);
        expect(validation.isValid).toBe(true);
    });

    it('不带毛玻璃 / 模糊这类耗电效果', () => {
        expect(css).not.toMatch(/blur\(/);
        expect(css).toContain('backdrop-filter:none');
    });

    it('不把角色头像 / 看板图变灰', () => {
        expect(css).not.toMatch(/grayscale/);
    });
});

describe('日程皮肤预设', () => {
    it('保存时把配色和 CSS 一起存下来', () => {
        const { presets, preset } = okOrThrow(upsertScheduleSkinPreset([], '奶油熊', draft));

        expect(presets).toHaveLength(1);
        expect(preset).toMatchObject({
            name: '奶油熊',
            preset: 'plush',
            background: '#fffdfb',
            textColor: '#6b5647',
            accentColor: '#a9866a',
            css: draft.customCss,
        });
    });

    it('同名视为覆盖，不会堆出重复条目', () => {
        const first = okOrThrow(upsertScheduleSkinPreset([], '奶油熊', draft));
        const second = okOrThrow(upsertScheduleSkinPreset(
            first.presets,
            '奶油熊',
            { ...draft, customCss: '.sully-schedule-card{border-radius:18px!important;}' },
        ));

        expect(second.presets).toHaveLength(1);
        expect(second.preset.id).toBe(first.preset.id);
        expect(second.presets[0].css).toContain('18px');
    });

    it('名字为空或超出上限时报错而不是静默丢弃', () => {
        expect(upsertScheduleSkinPreset([], '   ', draft)).toHaveProperty('error');

        const full: ScheduleCardSkinPreset[] = Array.from(
            { length: SCHEDULE_SKIN_PRESET_LIMIT },
            (_, index) => ({ id: `p${index}`, name: `皮肤${index}`, css: '' }),
        );
        expect(upsertScheduleSkinPreset(full, '再来一套', draft)).toHaveProperty('error');
        // 覆盖已有同名的那套不受上限影响
        expect(upsertScheduleSkinPreset(full, '皮肤0', draft)).not.toHaveProperty('error');
    });

    it('一键切换会同时换掉配色、CSS 和当前选中项，并保留预设库', () => {
        const { presets, preset } = okOrThrow(upsertScheduleSkinPreset([], '奶油熊', draft));
        const current: ScheduleCardAppearance = {
            preset: 'midnight',
            customCss: '.sully-schedule-root{opacity:.5!important;}',
            skinPresets: presets,
            skinPresetId: undefined,
        };

        const next = applyScheduleSkinPreset(current, preset);

        expect(next.preset).toBe('plush');
        expect(next.customCss).toBe(draft.customCss);
        expect(next.accentColor).toBe('#a9866a');
        expect(next.skinPresetId).toBe(preset.id);
        expect(next.skinPresets).toEqual(presets);
    });

    it('删除只摘掉那一条', () => {
        const first = okOrThrow(upsertScheduleSkinPreset([], '奶油熊', draft));
        const second = okOrThrow(upsertScheduleSkinPreset(first.presets, '午夜', draft));

        const left = removeScheduleSkinPreset(second.presets, first.preset.id);

        expect(left).toHaveLength(1);
        expect(left[0].name).toBe('午夜');
    });
});

describe('重命名预设', () => {
    it('改名保留 id、CSS 和配色', () => {
        const { presets, preset } = okOrThrow(upsertScheduleSkinPreset([], '奶油熊', draft));

        const result = renameScheduleSkinPreset(presets, preset.id, '  秋天的奶油熊 ');
        if ('error' in result) throw new Error(result.error);

        expect(result.presets[0]).toMatchObject({
            id: preset.id,
            name: '秋天的奶油熊',
            css: draft.customCss,
            accentColor: '#a9866a',
        });
    });

    it('空名字、重名和不存在的 id 都会被拦下', () => {
        const first = okOrThrow(upsertScheduleSkinPreset([], '奶油熊', draft));
        const second = okOrThrow(upsertScheduleSkinPreset(first.presets, '午夜', draft));

        expect(renameScheduleSkinPreset(second.presets, first.preset.id, '   ')).toHaveProperty('error');
        expect(renameScheduleSkinPreset(second.presets, first.preset.id, '午夜')).toHaveProperty('error');
        expect(renameScheduleSkinPreset(second.presets, 'nope', '随便')).toHaveProperty('error');
        // 改成自己原来的名字不算重名
        expect(renameScheduleSkinPreset(second.presets, first.preset.id, '奶油熊')).not.toHaveProperty('error');
    });
});
