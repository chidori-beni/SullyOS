import { describe, expect, it } from 'vitest';
import { resolveCssSlot } from './cssSlotFallback';

describe('resolveCssSlot', () => {
  it('没设置过时回填旧字段（拆槽后第一次打开，内容不丢）', () => {
    expect(resolveCssSlot(undefined, '.old{}')).toBe('.old{}');
    expect(resolveCssSlot(null, '.old{}')).toBe('.old{}');
  });

  it('设置过就用新的', () => {
    expect(resolveCssSlot('.new{}', '.old{}')).toBe('.new{}');
  });

  it('清空（空字符串）就是空 —— 绝不回退到旧字段', () => {
    // 这条是这个文件存在的理由：`||` 会在这里回退，用户就会看到
    // 「代码全清空了，美化还在」。
    expect(resolveCssSlot('', '.old{}')).toBe('');
  });

  it('两边都没有时给空串', () => {
    expect(resolveCssSlot(undefined, undefined)).toBe('');
    expect(resolveCssSlot('', undefined)).toBe('');
  });
});
