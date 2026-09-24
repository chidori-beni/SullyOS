import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

// 仅保留已审计的文本消费者；新增 App 不得再接旧文本入口。
// 多人布局先渲染不带世界书的人设，最终仍走 ContextBuilder 消息管线。
//
// ⚠️ 本 fork 的清单比上游长（上游 25468054 只留 7 处）。多出来的都是 fork 自己改过、
// 合并时特意保留旧写法的地方：
//   - 见面 / 通话：自己按「生效场景」解析一次并插深度条目（depthEntriesInjectedByCaller）
//   - 日程：日程专用书 + 「本次日程参考」深度块
//   - 社交 App：上游改成 Spark 那套，本 fork 永久不采用
//   - 陪伴开机：按时段生成开场；私聊 Messaging：fork 自己的两处
// 数字只许减不许加：要新增旧文本调用，先想清楚为什么不能走 buildCharacterRequest。
const legacyTextCalls: Record<string, number> = {
    'apps/CallApp.tsx': 2,
    'apps/GameApp.tsx': 1,
    'apps/GroupChat.tsx': 1,
    'apps/MemoryPalaceApp.tsx': 1,
    'apps/Messaging.tsx': 2,
    'apps/SocialApp.tsx': 2,
    'components/date/story/StoryTheaterSession.tsx': 2,
    'utils/companionStartup.ts': 2,
    'utils/datePrompts.ts': 2,
    // 记忆诊断、迁移、后台门牌任务目前的契约是序列化文本，不是角色对话。
    'utils/memoryPalace/memoryRepair.ts': 1,
    'utils/memoryPalace/roomPlates.ts': 1,
    'utils/scheduleGenerator.ts': 1,
};

// 本 fork 允许自己解析世界书的文件：它们要按「生效场景」（线上 / 线下 / 日程）挑书，
// 上游的公共管线没有这个参数时就是这么接的。清单同样只许减不许加。
const forkSceneAwareResolvers = new Set([
    'apps/CallApp.tsx',
    'utils/datePrompts.ts',
    'utils/scheduleGenerator.ts',
    'utils/storyTheater.ts',
]);

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = join(dir, entry.name);
        return entry.isDirectory() ? sourceFiles(path)
            : /\.tsx?$/.test(path) && !/\.(test|spec)\./.test(path) ? [path] : [];
    });
}

it('世界书底层处理只允许 ContextBuilder 调用；旧文本调用点不能继续扩散', () => {
    const root = process.cwd();
    const actual: Record<string, number> = {};
    const violations: string[] = [];
    for (const path of ['apps', 'components', 'utils'].flatMap(dir => sourceFiles(join(root, dir)))) {
        const name = relative(root, path).replace(/\\/g, '/');
        if (name === 'utils/context.ts' || name === 'utils/worldbook.ts') continue;
        const source = readFileSync(path, 'utf8');
        if (!/buildCoreContext|resolveWorldbookEntries|resolveWorldbookDepthEntries|injectWorldbookDepthEntries|splitWorldbookSections/.test(source)) continue;
        const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
            if (ts.isCallExpression(node) && node.expression.getText(file) === 'ContextBuilder.buildCoreContext') {
                actual[name] = (actual[name] || 0) + 1;
            }
            if (ts.isImportDeclaration(node) && /worldbook['"]$/.test(node.moduleSpecifier.getText(file))
                && /resolveWorldbookEntries|resolveWorldbookDepthEntries|injectWorldbookDepthEntries|splitWorldbookSections/.test(node.getText(file))
                && !forkSceneAwareResolvers.has(name)) {
                violations.push(name);
            }
            ts.forEachChild(node, visit);
        };
        visit(file);
    }
    expect(violations).toEqual([]);
    expect(actual).toEqual(legacyTextCalls);
});
