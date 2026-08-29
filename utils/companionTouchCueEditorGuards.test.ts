import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 源码级护栏。仓库没装 @testing-library，`vitest.config.ts` 也显式排除了组件测试，
 * 所以这里只能守住「曾经真的坏过」的那几个代码形状，不是行为测试。
 */
const editorSource = () => readFileSync(
  path.resolve(__dirname, '../components/os/CompanionTouchCueEditor.tsx'),
  'utf8',
);
const homeSource = () => readFileSync(
  path.resolve(__dirname, '../components/os/CompanionHome.tsx'),
  'utf8',
);

describe('touch cue editor position handling', () => {
  it('never splits position into two setters that overwrite each other', () => {
    const source = editorSource();
    // 曾经的写法：
    //   const setIndex = (v) => onPositionChange({ index: v, phase });
    //   const setPhase = (v) => onPositionChange({ index: position.index, phase: v });
    //   onClick={() => { setIndex(i); setPhase('start'); }}
    // 同一个事件里连调两次，第二次读到的是本次渲染的旧 position，
    // 会把刚写进去的下标覆盖回去——点哪一拍都弹回原来那拍。
    expect(source).not.toMatch(/const\s+setIndex\s*=/);
    expect(source).not.toMatch(/const\s+setPhase\s*=/);
    // 每个 onClick 里最多只能写一次完整的 position。
    // 用配对花括号扫描而不是正则：单行的 `onClick={() => onPositionChange({...})}`
    // 正是出问题的那一处，宽松的正则反而会漏掉它。
    const handlers: string[] = [];
    for (let cursor = source.indexOf('onClick={'); cursor >= 0; cursor = source.indexOf('onClick={', cursor + 1)) {
      let depth = 0;
      const from = cursor + 'onClick='.length;
      for (let scan = from; scan < source.length; scan += 1) {
        if (source[scan] === '{') depth += 1;
        else if (source[scan] === '}') {
          depth -= 1;
          if (depth === 0) { handlers.push(source.slice(from, scan + 1)); break; }
        }
      }
    }
    const positionHandlers = handlers.filter(handler => handler.includes('onPositionChange('));
    // 至少要真的扫到几个，否则这条断言是空转的。
    expect(positionHandlers.length).toBeGreaterThanOrEqual(3);
    for (const handler of positionHandlers) {
      expect(handler.match(/onPositionChange\(/g)?.length ?? 0).toBe(1);
    }
  });

  it('keeps the beat editor outside the whole-line block that early-returns', () => {
    const source = homeSource();
    // 逐拍编辑器一度被写在「有编排就提前 return 一行说明」的 IIFE 内部，
    // 于是恰好在有编排时整块消失。它必须是那个 IIFE 的兄弟节点。
    const iifeEnd = source.indexOf('})()}');
    const editorAt = source.indexOf('<CompanionTouchCueEditor');
    expect(iifeEnd).toBeGreaterThan(0);
    expect(editorAt).toBeGreaterThan(iifeEnd);
  });

  it('does not force the settings sheet scroll position back on every render', () => {
    const source = homeSource();
    // 内联 ref 回调每次渲染都会重挂，在里面写 scrollTop 等于持续把用户拽回原处。
    expect(source).not.toMatch(/node\.scrollTop\s*=/);
    expect(source).not.toContain('touchSheetScrollTopRef');
  });
});

describe('startup preset save controls', () => {
  const source = () => readFileSync(
    path.resolve(__dirname, '../components/os/CompanionHome.tsx'),
    'utf8',
  );

  it('gates the overwrite button on the draft origin, not the dropdown selection', () => {
    const text = source();
    // selectedStartupPresetId 会被 17 处编辑操作清空（表示「草稿已偏离选中的那套」），
    // 用它当「更新这套预设」的显示条件，按钮会在用户刚动手时就消失——
    // 正好是最需要它的时刻。必须用只在切换/保存/删除时才变的 origin。
    expect(text).toContain('startupPresetOrigin');
    expect(text).toContain('{startupOriginPreset ? (');
    expect(text).not.toContain('{selectedStartupPresetId ? (');
    // 覆盖动作本身也必须走 origin。
    expect(text).toMatch(/updateCompanionStartupPreset\(base, startupPresetOrigin,/);
  });

  it('keeps the origin out of the edit handlers that clear the selection', () => {
    const text = source();
    // 编辑清的是 selectedStartupPresetId；一旦有人顺手也清 origin，覆盖按钮就又会消失。
    const clearsOrigin = text.match(/setStartupPresetOrigin\(''\)/g) || [];
    // 只有「下拉选空」和「删除预设」两处允许清空。
    expect(clearsOrigin.length).toBe(2);
  });

  it('tells the user an unsaved startup draft will not play at boot', () => {
    const text = source();
    expect(text).toContain('data-testid="companion-startup-dirty"');
    expect(text).toContain('startupDraftDirty');
  });
});
