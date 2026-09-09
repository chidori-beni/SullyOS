import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');

const verticalScrollFiles = [
  'apps/Settings.tsx',
  'apps/Appearance.tsx',
  'apps/Character.tsx',
  'components/os/Modal.tsx',
  'components/appearance/ChatAppearanceEditor.tsx',
  'components/chat/ChatDecorSheet.tsx',
  'components/chat/ChatInputArea.tsx',
  'components/chat/ThinkingChainSettingsModal.tsx',
  'components/chat/xinsheng/XinshengSettingsModal.tsx',
  'components/chat/xinsheng/XinshengCardModal.tsx',
  'components/call/Live2DActionSettings.tsx',
  'components/date/DateSettings.tsx',
  'components/os/CompanionHome.tsx',
  'components/os/LauncherWidgetSheet.tsx',
] as const;

describe('设置纵向滚动区横向漂移护栏', () => {
  it.each(verticalScrollFiles)('%s 的纵向滚动区明确关闭横向溢出', (relativePath) => {
    const hasLockedVerticalScroll = readSource(relativePath)
      .split(/\r?\n/)
      .some(line => line.includes('overflow-y-auto') && line.includes('overflow-x-hidden'));
    expect(hasLockedVerticalScroll).toBe(true);
  });

  it('通话偏好和陪睡设置的 inline 滚动区也关闭横向溢出', () => {
    expect(readSource('components/call/CallPreferencesSheet.tsx')).toContain("overflowX: 'hidden'");
    expect(readSource('components/call/SleepCompanionSheet.tsx')).toContain("overflowX: 'hidden'");
  });

  it('消息主题设置的 CSS 滚动区也关闭横向溢出', () => {
    expect(readSource('components/messaging/MessagingApp.css')).toContain('overflow-y: auto; overflow-x: hidden;');
  });
});
