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
    appendXinshengEntry, clearXinshengHistory, deleteXinshengEntry, deleteOrphanedXinshengEntries,
    readXinshengHistory, toggleXinshengFavorite, XINSHENG_HISTORY_CAP,
    updateXinshengEntryPreset,
    listXinshengPresets, saveXinshengPreset, updateXinshengPreset, deleteXinshengPreset,
    importXinshengPresets, buildPresetExportFile, parsePresetImportFile, normalizePreset,
    toggleXinshengPresetPinned, sortXinshengPresets, renameXinshengPreset,
    saveXinshengFirePackPreset, readXinshengFirePackPreset,
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

    it('只更新指定条目的显示快照，并保留正文、自定义字段和收藏状态', async () => {
        await appendXinshengEntry('c1', 'xs_1', {
            ...entry('a'),
            customField: '正文还在',
            _favorited: true,
        });
        await appendXinshengEntry('c1', 'xs_2', entry('b'));

        const result = await updateXinshengEntryPreset('c1', 'xs_1', {
            name: '预设 A',
            displayMode: 'layout',
            layout: '@quote innerVoice',
            customCss: '.xt-root{}',
            customPrompt: '不能落进历史',
            aiVisibleFields: 'innerVoice',
        } as any);

        expect(result.updated).toBe(true);
        expect(result.history.xs_1).toMatchObject({
            innerVoice: 'a',
            customField: '正文还在',
            _favorited: true,
            _presetOverride: {
                name: '预设 A',
                displayMode: 'layout',
                layout: '@quote innerVoice',
                customCss: '.xt-root{}',
            },
        });
        expect(result.history.xs_1._preset).toBeUndefined();
        expect(result.history.xs_1._presetOverride.customPrompt).toBeUndefined();
        expect(result.history.xs_1._presetOverride.aiVisibleFields).toBeUndefined();
        expect(result.history.xs_2._preset).toBeUndefined();
    });

    it('清除单条快照时不重建记录；目标不存在时不凭空创建', async () => {
        await appendXinshengEntry('c1', 'xs_1', {
            ...entry('a'),
            _preset: { name: '旧预设', displayMode: 'planner', layout: '', customCss: '' },
            customField: '保留',
        });

        const cleared = await updateXinshengEntryPreset('c1', 'xs_1', null);
        expect(cleared.updated).toBe(true);
        expect(cleared.history.xs_1.innerVoice).toBe('a');
        expect(cleared.history.xs_1.customField).toBe('保留');
        expect(cleared.history.xs_1._preset).toMatchObject({ name: '旧预设' });
        expect(cleared.history.xs_1._presetOverride).toBeUndefined();

        const missing = await updateXinshengEntryPreset('c1', 'xs_missing', {
            name: '不会写入', displayMode: 'planner', layout: '', customCss: '',
        });
        expect(missing.updated).toBe(false);
        expect(missing.reason).toBe('not-found');
        expect((await readXinshengHistory('c1')).xs_missing).toBeUndefined();
    });
});

// ─── 孤儿记录清理：对应消息被删了，心声记录也该跟着走 ────────────────────────
//
// 用户实测反馈：把聊天里的回复删掉，心声历史翻页时那条记录还在，翻上一条/下一条能
// 翻到一条已经没有对应消息的孤儿记录。
describe('deleteOrphanedXinshengEntries', () => {
    it('删掉指定的 roundId', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        await appendXinshengEntry('c1', 'xs_2', entry('b'));
        const h = await deleteOrphanedXinshengEntries('c1', ['xs_1']);
        expect(Object.keys(h)).toEqual(['xs_2']);
    });

    it('收藏过的跳过不删——收藏是用户的显式挽留，删原文不代表也要删心声', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        await toggleXinshengFavorite('c1', 'xs_1');
        const h = await deleteOrphanedXinshengEntries('c1', ['xs_1']);
        expect(Object.keys(h)).toEqual(['xs_1']);
        expect(h.xs_1._favorited).toBe(true);
    });

    it('roundId 列表里混着不存在的 id，不报错、按存在的处理', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        const h = await deleteOrphanedXinshengEntries('c1', ['xs_1', 'xs_不存在']);
        expect(Object.keys(h)).toEqual([]);
    });

    it('空数组不碰历史，也不做一次多余的写入', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        const h = await deleteOrphanedXinshengEntries('c1', []);
        expect(Object.keys(h)).toEqual(['xs_1']);
    });

    it('不同角色互不干扰', async () => {
        await appendXinshengEntry('c1', 'xs_1', entry('a'));
        await appendXinshengEntry('c2', 'xs_1', entry('b'));
        await deleteOrphanedXinshengEntries('c1', ['xs_1']);
        expect(Object.keys(await readXinshengHistory('c1'))).toEqual([]);
        expect(Object.keys(await readXinshengHistory('c2'))).toEqual(['xs_1']);
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

describe('置顶预设', () => {
    const add = (name: string) => saveXinshengPreset(name, {
        customCss: '', customPrompt: '', layout: '', displayMode: 'planner', aiVisibleFields: 'innerVoice',
    });

    it('置顶的排到最前面，两组内部保持原来的插入顺序', async () => {
        await add('A'); const b = await add('B'); await add('C'); const d = await add('D');
        await toggleXinshengPresetPinned(d!);
        await toggleXinshengPresetPinned(b!);
        expect((await listXinshengPresets()).map(p => p.name)).toEqual(['B', 'D', 'A', 'C']);
    });

    it('再点一次取消置顶，回到原来的位置', async () => {
        await add('A'); const b = await add('B'); await add('C');
        await toggleXinshengPresetPinned(b!);
        expect((await listXinshengPresets()).map(p => p.name)).toEqual(['B', 'A', 'C']);
        await toggleXinshengPresetPinned(b!);
        expect((await listXinshengPresets()).map(p => p.name)).toEqual(['A', 'B', 'C']);
    });

    it('覆盖（updateXinshengPreset）不会把置顶弄丢', async () => {
        const id = await add('A');
        await toggleXinshengPresetPinned(id!);
        await updateXinshengPreset(id!, 'A', {
            customCss: '.xt-root{}', customPrompt: '', layout: '@header', displayMode: 'layout', aiVisibleFields: 'innerVoice',
        });
        expect((await listXinshengPresets())[0].pinned).toBe(true);
    });

    it('置顶不进导出文件（别人导入时不该跟着被钉住）', async () => {
        const id = await add('A');
        await toggleXinshengPresetPinned(id!);
        const file = JSON.parse(buildPresetExportFile((await listXinshengPresets())[0]));
        expect(file.preset.pinned).toBeUndefined();
    });

    it('id 不存在时原样返回，不炸', async () => {
        await add('A');
        expect((await toggleXinshengPresetPinned('不存在')).map(p => p.name)).toEqual(['A']);
    });

    it('sortXinshengPresets 不改原数组', () => {
        const list = [normalizePreset({ name: 'A' }), normalizePreset({ name: 'B', pinned: true })];
        expect(sortXinshengPresets(list).map(p => p.name)).toEqual(['B', 'A']);
        expect(list.map(p => p.name)).toEqual(['A', 'B']);
    });
});

describe('重命名预设', () => {
    const add = (name: string) => saveXinshengPreset(name, {
        customCss: '.xt-root{}', customPrompt: 'p', layout: '@header', displayMode: 'layout', aiVisibleFields: 'innerVoice',
    });

    it('只改名字，内容一个字不动，位置也不动', async () => {
        await add('A'); const b = await add('B'); await add('C');
        const list = await renameXinshengPreset(b!, '  蓝色小卡  ');
        expect(list.map(p => p.name)).toEqual(['A', '蓝色小卡', 'C']);
        const renamed = list[1];
        expect(renamed.customCss).toBe('.xt-root{}');
        expect(renamed.customPrompt).toBe('p');
        expect(renamed.layout).toBe('@header');
        expect(typeof renamed.updatedAt).toBe('number');
    });

    it('空名字直接忽略，不会把预设改成没名字', async () => {
        const id = await add('A');
        expect((await renameXinshengPreset(id!, '   ')).map(p => p.name)).toEqual(['A']);
    });

    it('改名不影响置顶', async () => {
        const id = await add('A');
        await toggleXinshengPresetPinned(id!);
        expect((await renameXinshengPreset(id!, 'A2'))[0].pinned).toBe(true);
    });
});

describe('主动消息（fire_pack）的预设快照', () => {
    it('存了能读回来，按角色分开', async () => {
        await saveXinshengFirePackPreset('c1', { name: 'A', displayMode: 'layout', layout: '@header', customCss: '.a{}' });
        await saveXinshengFirePackPreset('c2', { name: 'B', displayMode: 'planner', layout: '', customCss: '' });
        expect(await readXinshengFirePackPreset('c1')).toEqual({ name: 'A', displayMode: 'layout', layout: '@header', customCss: '.a{}' });
        expect((await readXinshengFirePackPreset('c2'))!.displayMode).toBe('planner');
    });

    it('没存过读到 null；存着的是垃圾也补齐成合法形状', async () => {
        expect(await readXinshengFirePackPreset('c9')).toBeNull();
        await saveXinshengFirePackPreset('c1', { layout: 123 } as any);
        expect(await readXinshengFirePackPreset('c1')).toEqual({ name: '', displayMode: 'planner', layout: '', customCss: '' });
    });

    it('重新打包会覆盖上一份（worker 上永远只有最后上传的那个包）', async () => {
        await saveXinshengFirePackPreset('c1', { name: 'A', displayMode: 'layout', layout: '@a', customCss: '' });
        await saveXinshengFirePackPreset('c1', { name: 'B', displayMode: 'layout', layout: '@b', customCss: '' });
        expect((await readXinshengFirePackPreset('c1'))!.name).toBe('B');
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
