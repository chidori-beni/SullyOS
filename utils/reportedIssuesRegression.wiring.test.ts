import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string => readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    'utf8',
).replace(/\r\n?/g, '\n');

describe('用户反馈回归保护', () => {
    it('见面输入栏允许 Firefox 在窄屏收缩 textarea，并固定保留发送按钮', () => {
        const source = read('../components/date/DateSession.tsx');
        const inputLayer = source.slice(source.indexOf('{/* Input Layer */}'), source.indexOf('{/* Settings Overlay */}'));

        expect(inputLayer).toContain('w-[90%] min-w-0 max-w-lg');
        expect(inputLayer).toContain('className={`min-w-0 flex-1');
        expect(inputLayer).toContain('className="shrink-0 px-4 sm:px-6');
    });

    it('见面输入框回车只换行，发送只由发送按钮触发', () => {
        const source = read('../components/date/DateSession.tsx');
        const inputLayer = source.slice(source.indexOf('{/* Input Layer */}'), source.indexOf('{/* Settings Overlay */}'));

        expect(source).not.toContain('const handleComposerKeyDown');
        expect(inputLayer).not.toContain('onKeyDown={handleComposerKeyDown}');
        expect(inputLayer).toContain('onClick={handleSend}');
    });

    it('SAR 输入框回车只换行，发送只由发送按钮触发', () => {
        // 用户明确要求过：多行输入框一律回车换行。见面那条已经有守卫（上面一条），
        // SAR 这条是补的 —— 上游 cd2d8a75 又把回车即发送加了回来，合的时候没拦住，
        // 用户自己发现的。以后再被合进来，这条会立刻变红。
        const source = read('../apps/vrWorld/SARSimulationSession.tsx');

        expect(source).not.toContain("key==='Enter'");
        expect(source).not.toContain("key === 'Enter'");
        // 发送仍然要有按钮入口，别连发都发不出去。
        expect(source).toContain('onClick={()=>void send()}');
    });

    it('剧情重试会在再次生成前先尝试归档，避免超长上下文把后置归档永久卡死', () => {
        const source = read('../components/date/story/StoryTheaterSession.tsx');
        const send = source.slice(source.indexOf('const send = useCallback'), source.indexOf('const archivedCount ='));
        const preflight = send.indexOf('const promptEntry = await archiveIfNeeded() || entry;');
        const completion = send.indexOf('const generated = await callCompletion');

        expect(preflight).toBeGreaterThanOrEqual(0);
        expect(completion).toBeGreaterThan(preflight);
        expect(send).toContain('mirrorArchived(message, promptEntry)');
        expect(send).toContain('promptEntry.archives.filter');
    });

    it('剧情预算里的预设只统计启用项，不把关闭的提示词算进总量', () => {
        const editor = read('../components/date/story/StoryTheaterEditor.tsx');

        expect(editor).toContain('document.prompts.filter(prompt => prompt.enabled).map(prompt => prompt.content)');
    });

    it('默认版预设设置直接提供带人话说明的续写参数', () => {
        const maker = read('../components/date/story/StoryPresetMaker.tsx');

        expect(maker).toContain("['temperature', '温度', 'Temperature'");
        expect(maker).toContain("['topP', '候选范围', 'Top P'");
        expect(maker).toContain("['frequencyPenalty', '重复惩罚', 'Frequency penalty'");
        expect(maker).toContain("['presencePenalty', '话题惩罚', 'Presence penalty'");
        expect(maker).toContain("['maxTokens', '最大输出', 'Max tokens'");
        expect(maker).toContain('使用 Claude 时会自动按 1.0 发送');
        expect(maker).toContain("<h2 className='text-sm font-bold'>续写参数</h2>");
    });

    it('剧情预设导出复用原生分享链路，不依赖 Android WebView 的 a.download', () => {
        const storyTheater = read('./storyTheater.ts');

        expect(storyTheater).toContain("import { shareOrDownloadFile } from './shareExport'");
        expect(storyTheater).toContain('shareOrDownloadFile({');
        expect(storyTheater).not.toContain("anchor.download = `${preset.name");
    });

    it('统一请求出口会在发送前修正 Claude 超范围温度', () => {
        const osContext = read('../context/OSContext.tsx');

        expect(osContext).toContain('clampClaudeTemperature(parsed)');
        expect(osContext.indexOf('clampClaudeTemperature(parsed)')).toBeLessThan(osContext.indexOf('await originalFetch(...sendArgs)'));
    });

    it('静态 PNG 触摸反馈不再按情绪 key 重挂载图片或重播闪白动画', () => {
        const portrait = read('../components/os/StaticCompanionPortrait.tsx');
        const home = read('../components/os/CompanionHome.tsx');

        expect(portrait).not.toContain('key={`${value}-${expressionKey}`}');
        expect(portrait).not.toContain('companion-static-expression-in');
        expect(home).not.toContain('staticExpressionKey');
    });

    it('聊天翻译支持按角色保存直接展开模式，并在气泡内同时渲染原文和译文', () => {
        const chat = read('../apps/Chat.tsx');
        const modals = read('../components/chat/ChatModals.tsx');
        const item = read('../components/chat/MessageItem.tsx');

        expect(chat).toContain('chat_translate_expanded_${activeCharacterId}');
        expect(modals).toContain('原文与译文同时展开');
        expect(item).toContain('showExpandedTranslation');
        expect(item).toContain('{renderContent(langBContent)}');
    });

    it('冷启动第一帧按 localStorage 镜像决定开场，不闪水母', () => {
        // 用户报：关了开场动画、或选了「原版」，冷启动仍会闪一下紫色水母。
        // 病根是 theme 要等 IndexedDB，第一帧 bootAnimationEnabled/Style 都是 undefined
        // （分别被判成「开启」和「水母」）。修法见 utils/bootPreference。
        const shell = read('../components/PhoneShell.tsx');

        // 开关与风格都不许直接读 theme 来决定第一帧
        expect(shell).not.toContain('const bootAnimationEnabled = theme.bootAnimationEnabled !== false;');
        expect(shell).not.toContain('style={theme.bootAnimationStyle}');

        expect(shell).toContain('useState(readBootPreference)');
        expect(shell).toContain('bootPreference.style ?? theme.bootAnimationStyle');
        expect(shell).toContain('style={bootAnimationStyle}');
        // 镜像只允许「关掉」不允许「打开」：数据到位后不会中途补播。
        expect(shell).toContain('(bootPreference.enabled ?? true)');
        expect(shell).toContain('rememberBootPreference(theme)');
    });
});
