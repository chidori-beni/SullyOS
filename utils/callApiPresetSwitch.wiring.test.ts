// 通话中快捷切换 API 预设的接线守卫（源码级断言，理由同 apiPresetSwitch.wiring.test.ts）。
//
// 防三种回归，全都不报错、界面上也看不出来：
//   1. 通话里切预设绕开 commitApiConfig → 后台哄睡 / 已排程任务还拿旧 Key 打请求
//   2. 入口按钮或面板被合并上游时弄丢
//   3. 沉默搭话 / 梦话定时器又直接调函数本体 → 定时器攥着挂上那一刻的旧 apiConfig，
//      切完 API 后这两类台词仍走旧配置
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const callApp = readFileSync(fileURLToPath(new URL('../apps/CallApp.tsx', import.meta.url)), 'utf8');
const sheet = readFileSync(fileURLToPath(new URL('../components/call/CallApiPresetSheet.tsx', import.meta.url)), 'utf8');

describe('通话中切换 API 预设', () => {
  it('入口和面板都挂上了', () => {
    expect(callApp).toContain('data-testid="call-api-preset-entry"');
    expect(callApp).toContain('<CallApiPresetSheet');
  });

  it('走 commitApiConfig + configFromPreset，和设置页同一条路', () => {
    expect(callApp).toContain('commitApiConfig(configFromPreset(preset))');
  });

  it('面板按当前 apiConfig 反查「使用中」', () => {
    expect(sheet).toContain('findActivePresetId(apiPresets, apiConfig)');
  });

  it('定时器里调的是最新一版函数', () => {
    expect(callApp).toContain('void fireIdleNudgeRef.current()');
    expect(callApp).toContain("await fireSleepLineRef.current('dream')");
    expect(callApp).toContain('fireIdleNudgeRef.current = fireIdleNudge;');
    expect(callApp).toContain('fireSleepLineRef.current = fireSleepLine;');
    expect(callApp).not.toMatch(/setTimeout\(\(\) => \{ void fireIdleNudge\(\); \}/);
  });
});
