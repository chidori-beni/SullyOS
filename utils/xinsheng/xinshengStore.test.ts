import { describe, it, expect, beforeEach, vi } from 'vitest';

// assets 表是个简单的 JSON 键值区，用内存 Map 顶掉即可（心声的读写模式是整取整存）
const store = new Map<string, any>();
vi.mock('../db', () => ({
    DB: {
        getAssetRaw: async (id: string) => (store.has(id) ? store.get(id) : null),
        saveAssetRaw: async (id: string, data: any) => { store.set(id, data); },
    },
}));

const {
    appendXinshengEntry, clearXinshengHistory, deleteXinshengEntry, readXinshengHistory,
    toggleXinshengFavorite, XINSHENG_HISTORY_CAP,
    listXinshengPresets, saveXinshengPreset, updateXinshengPreset, deleteXinshengPreset,
    importXinshengPresets, buildPresetExportFile, parsePresetImportFile, normalizePreset,
    isPresetRandomEnabled, setPresetRandomEnabled, pickRandomPreset,
} = await import('./xinshengStore');

const entry = (innerVoice: string) => ({
    innerVoice, statusText: '', temperature: '36.5°C', emotionLevel: 70,
    moodDelta: null, weather: null, location: null, activity: null, raw: null,
});

beforeEach(() => { store.clear(); });

describe('心声历史', () => {
    it('落库后读得回来，自动补 _at', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('第一条'));
        const h = await readXinshengHistory('c1');
        expect(h.xs_1.innerVoice).toBe('第一条');
        expect(typeof h.xs_1._at).toBe('number');
    });

    it('超过上限时淘汰最旧的，但收藏过的永远留着', async () => {
        // 定长时间戳保证字典序 == 时间序。先落两条最旧的并收藏其中一条，
        // 再灌满到超过上限 —— 收藏必须在被淘汰之前发生，否则测的是「已经没了」。
        await appendXinshengEntry('c1', 'xs_1756000000000_x', entry('最旧·已收藏'));
        await appendXinshengEntry('c1', 'xs_1756000000001_x', entry('次旧·没收藏'));
        await toggleXinshengFavorite('c1', 'xs_1756000000000_x');

        for (let i = 2; i < XINSHENG_HISTORY_CAP + 5; i++) {
            await appendXinshengEntry('c1', `xs_${String(1756000000000 + i)}_x`, entry(`第 ${i} 条`));
        }

        const h = await readXinshengHistory('c1');
        expect(h['xs_1756000000000_x']).toBeDefined();      // 收藏的活着
        expect(h['xs_1756000000001_x']).toBeUndefined();    // 没收藏的次旧被淘汰
        // 上限只约束「非收藏」的部分，收藏的额外挂在外面
        const unfavored = Object.values(h).filter(e => !e._favorited);
        expect(unfavored.length).toBeLessThanOrEqual(XINSHENG_HISTORY_CAP);
    });

    it('删除单条 / 收藏开关', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        await appendXinshengEntry('c1', 'xs_2', entry('b'));
        expect(Object.keys(await deleteXinshengEntry('c1', 'xs_1'))).toEqual(['xs_2']);
        expect((await toggleXinshengFavorite('c1', 'xs_2')).xs_2._favorited).toBe(true);
        expect((await toggleXinshengFavorite('c1', 'xs_2')).xs_2._favorited).toBe(false);
    });

    it('清空保留收藏', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        await appendXinshengEntry('c1', 'xs_2', entry('b'));
        await toggleXinshengFavorite('c1', 'xs_2');
        expect(Object.keys(await clearXinshengHistory('c1'))).toEqual(['xs_2']);
    });

    it('不同角色互不干扰', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        await appendXinshengEntry('c2', 'xs_1', entry('b'));
        expect((await readXinshengHistory('c1')).xs_1.innerVoice).toBe('a');
        expect((await readXinshengHistory('c2')).xs_1.innerVoice).toBe('b');
    });
});

describe('预设', () => {
    it('normalizePreset：有布局就一定是 layout 模式（v1 导出没有 displayMode 字段）', () => {
        expect(normalizePreset({ name: 'x', layout: '@header' }).displayMode).toBe('layout');
        expect(normalizePreset({ name: 'x' }).displayMode).toBe('planner');
        // v1 里 customCss 叫 template
        expect(normalizePreset({ name: 'x', template: '.xt-root{}' }).customCss).toBe('.xt-root{}');
        expect(normalizePreset({ name: 'x' }).aiVisibleFields).toBe('innerVoice');
    });

    it('保存 / 更新 / 删除', async () => {
        const id = await saveXinshengPreset('浅浅蓝', {
            customCss: '.xt-root{}', customPrompt: 'p', layout: '@header', displayMode: 'layout', aiVisibleFields: 'innerVoice',
        });
        expect(id).toBeTruthy();
        expect(await updateXinshengPreset(id!, '浅浅蓝 v2', {
            customCss: '.xt-root{--a:1}', customPrompt: 'p2', layout: '@duo', displayMode: 'layout', aiVisibleFields: 'mood',
        })).toBe(true);
        const [p] = await listXinshengPresets();
        expect(p).toMatchObject({ name: '浅浅蓝 v2', layout: '@duo', aiVisibleFields: 'mood' });
        expect(await deleteXinshengPreset(p.id)).toEqual([]);
    });

    it('导出的文件糯叽机能认（type / version / preset 三件套）', async () => {
        const file = JSON.parse(buildPresetExportFile(normalizePreset({ name: '甲', layout: '@header' })));
        expect(file.type).toBe('nuojiji.xinsheng.preset');
        expect(file.version).toBe(2);
        expect(Object.keys(file.preset).sort()).toEqual(
            ['aiVisibleFields', 'customCss', 'customPrompt', 'displayMode', 'layout', 'name'],
        );
    });

    it('parsePresetImportFile 认单预设信封 / 多预设信封 / 裸数组', () => {
        expect(parsePresetImportFile('{"type":"nuojiji.xinsheng.preset","version":2,"preset":{"name":"甲"}}')).toHaveLength(1);
        expect(parsePresetImportFile('{"presets":[{"name":"甲"},{"name":"乙"}]}')).toHaveLength(2);
        expect(parsePresetImportFile('[{"name":"甲"}]')).toHaveLength(1);
        expect(parsePresetImportFile('{"name":"裸预设","layout":"@header"}')).toHaveLength(1);
        expect(parsePresetImportFile('{"foo":1}')).toHaveLength(0);
    });

    it('导入重名自动加序号，不覆盖正在用的那份', async () => {
        await saveXinshengPreset('浅浅蓝', { customCss: '', customPrompt: '', layout: '', displayMode: 'planner', aiVisibleFields: 'innerVoice' });
        await importXinshengPresets([{ name: '浅浅蓝', layout: '@header' }]);
        await importXinshengPresets([{ name: '浅浅蓝', layout: '@duo' }]);
        expect((await listXinshengPresets()).map(p => p.name)).toEqual(['浅浅蓝', '浅浅蓝 (2)', '浅浅蓝 (3)']);
    });

    it('replace 模式整库替换', async () => {
        await saveXinshengPreset('旧的', { customCss: '', customPrompt: '', layout: '', displayMode: 'planner', aiVisibleFields: '' });
        await importXinshengPresets([{ name: '新的' }], 'replace');
        expect((await listXinshengPresets()).map(p => p.name)).toEqual(['新的']);
    });
});

describe('随机预设', () => {
    it('开关默认关', async () => {
        expect(await isPresetRandomEnabled()).toBe(false);
        await setPresetRandomEnabled(true);
        expect(await isPresetRandomEnabled()).toBe(true);
    });

    it('空库返回 null；只有一个时就返回它', async () => {
        expect(await pickRandomPreset()).toBeNull();
        await saveXinshengPreset('唯一', { customCss: '', customPrompt: '', layout: '', displayMode: 'planner', aiVisibleFields: '' });
        expect((await pickRandomPreset())!.name).toBe('唯一');
        expect((await pickRandomPreset())!.name).toBe('唯一');
    });

    it('两个以上时永远避开上一次抽中的那个', async () => {
        for (const n of ['甲', '乙', '丙']) {
            await saveXinshengPreset(n, { customCss: '', customPrompt: '', layout: '', displayMode: 'planner', aiVisibleFields: '' });
        }
        let last = (await pickRandomPreset())!.id;
        for (let i = 0; i < 20; i++) {
            const next = (await pickRandomPreset())!;
            expect(next.id).not.toBe(last);
            last = next.id;
        }
    });
});
