import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 接线守卫：桌面组件这套东西大部分逻辑在纯函数里（launcherUserWidgets.test.ts 覆盖），
 * 但「有没有真的接到 Launcher 上」纯函数测不出来。这里锁住几个关键挂载点，
 * 避免合并上游 Launcher.tsx 时被整段覆盖掉还没人发现。
 */
const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

const launcher = read('apps/Launcher.tsx');
const appearance = read('apps/Appearance.tsx');
const widgetView = read('components/os/LauncherUserWidgetView.tsx');
const widgetSheet = read('components/os/LauncherWidgetSheet.tsx');

describe('Launcher 接线', () => {
    it('App 网格按合并后的槽位渲染，而不是只 map appIds', () => {
        expect(launcher).toContain('buildLauncherPageSlots');
        expect(launcher).toContain("data-launcher-kind=\"uwidget\"");
    });

    it('组件靠 grid span 占格，且行高固定（否则跨行组件撑不开）', () => {
        expect(launcher).toContain('launcherWidgetSpan');
        expect(launcher).toContain('gridAutoRows');
        expect(launcher).toContain('gridRow: `span ');
    });

    it('两处 AppGridPage 都拿到了组件列表，不然某一页会看不见组件', () => {
        const passes = launcher.match(/userWidgets=\{userWidgets\}/g) || [];
        expect(passes.length).toBe(2);
    });

    it('拖拽状态机认得组件：可拖动、可跨页、能落到别的格子上', () => {
        expect(launcher).toContain('moveLauncherUserWidget');
        expect(launcher).toContain('appTargetAfterWidget');
        expect(launcher).toContain("pointer.kind === 'uwidget'");
    });

    it('长按组件原地松手会打开编辑面板，而不是把它挪到页尾', () => {
        expect(launcher).toContain('draggedWidgetId && !pointer.moved');
    });

    it('左上角有「＋ 组件」入口，且面板已挂在桌面上', () => {
        expect(launcher).toContain("setWidgetSheet({ mode: 'add' })");
        expect(launcher).toContain('<LauncherWidgetSheet');
    });

    it('长按空白桌面也能进整理模式', () => {
        expect(launcher).toContain('emptyPressTimer');
        expect(launcher).toContain("closest('[data-launcher-page-drop]')");
    });

    it('旧固定槽位有一次性迁移，并把剩余槽位写回去（否则资产会复活旧图）', () => {
        expect(launcher).toContain('migrateLegacyLauncherWidgets');
        expect(launcher).toContain('launcherWidgets: migration.legacyWidgets');
    });

    it('组件图存 blobref 令牌，不把 data URL 塞进会写 localStorage 的 theme', () => {
        expect(launcher).toContain('putImageBlob');
        expect(launcher).not.toContain('processImage(file');
    });

    it('旧的 tl / tr / wide 固定图片槽位不再被渲染', () => {
        expect(launcher).not.toContain("w['wide']");
        expect(launcher).not.toContain("['tl', 'tr'].map");
    });
});

describe('翻页手势不会卡在平移态', () => {
    it('有一个统一的归位函数，把 snap / isDragging / touchActive 一起收回来', () => {
        expect(launcher).toContain('resetCarouselGestureState');
        expect(launcher).toContain('touchActive.current = false;');
    });

    it('长按进整理模式那条路会调它，而不是只清 isDragging', () => {
        // 这是「进整理模式后翻页变横向平移、退出也不恢复」的根因：
        // mousedown 先关了 snap，长按定时器只清 isDragging，handleMouseUp 于是直接返回。
        expect(launcher).toContain('长按之前那次 mousedown 已经把 snap 关掉了');
    });

    it('整理模式进出各兜一次底', () => {
        expect(launcher).toContain('}, [layoutEditing, resetCarouselGestureState]);');
    });
});

describe('自带风车组件可移除', () => {
    it('隐藏的格子不再渲染', () => {
        expect(launcher).toContain('pinwheelOrder.filter(cell => !hiddenBuiltinWidgets.includes');
    });

    it('轻点自带格子会打开移除面板', () => {
        expect(launcher).toContain('setBuiltinWidgetSheet(pointer.key)');
        expect(launcher).toContain('<LauncherBuiltinWidgetSheet');
    });

    it('移除后能在「＋ 组件」面板里恢复', () => {
        expect(launcher).toContain('onRestoreBuiltin={handleRestoreBuiltinWidget}');
        expect(widgetSheet).toContain('已移除的自带组件');
    });

    it('隐藏结果会落到 theme 里，不是只活在内存', () => {
        expect(launcher).toContain('launcherHiddenBuiltinWidgets');
    });
});

describe('整理模式下够得着别的页', () => {
    it('页码点在整理模式下是可点的跳页按钮（此时 touch-action 是 none，划不动）', () => {
        expect(launcher).toContain('goToLauncherPage');
        expect(launcher).toContain("layoutEditing ? '' : 'pointer-events-none'");
    });
});

describe('组件本体与面板', () => {
    it('组件图经 useBlobRefUrl 解析，令牌和图床直链都能显示', () => {
        expect(widgetView).toContain('useBlobRefUrl');
    });

    it('面板同时提供相册上传和图床链接两条路', () => {
        expect(widgetSheet).toContain("accept=\"image/*\"");
        expect(widgetSheet).toContain('onApplyUrl');
    });

    it('面板给出用户要求的全部尺寸', () => {
        expect(widgetSheet).toContain('LAUNCHER_WIDGET_SIZES');
    });

    it('面板自己吞掉指针事件，不会触发桌面的拖拽状态机', () => {
        expect(widgetSheet).toContain('onPointerDown={(e) => e.stopPropagation()}');
    });
});

describe('外观定制不再管小组件', () => {
    it('外观里只留指路，不再有 tl / tr / wide 的上传格子', () => {
        expect(appearance).not.toContain("['tl', 'tr'].map");
        expect(appearance).toContain('小组件已经搬到桌面上直接编辑了');
    });

    it('风车方图（dsq）还留在外观里，且它的文件选择框没被一起删掉', () => {
        expect(appearance).toContain("const slot = 'dsq';");
        expect(appearance).toContain('ref={widgetInputRef}');
    });
});
