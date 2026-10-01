// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UiLocaleProvider, useUiLocale } from '../context/UiLocaleContext';
import { ImportRecoveryPopup, type ImportRecoveryMarker } from '../components/os/ImportRecoveryPopup';
import Modal from '../components/os/Modal';
import ConfirmDialog from '../components/os/ConfirmDialog';
import CompanionLockChrome from '../components/os/CompanionLockChrome';
import type { CompanionFrameStyleId } from '../components/os/companionFrameStyles';
import { BackupReminderPopup } from '../components/BackupReminderEvent';
import { translateUi } from './uiLocale';
import type { CharacterProfile } from '../types';

const backup = vi.hoisted(() => ({ days: null as number | null, interval: 7 }));
vi.mock('./backupReminder', () => ({ daysSinceLastBackup: () => backup.days, getBackupReminderState: () => ({ intervalDays: backup.interval }) }));
let root: Root;
let container: HTMLDivElement;
let setLocale: ReturnType<typeof useUiLocale>['setLocale'];
const Controls = () => { setLocale = useUiLocale().setLocale; return null; };
const mount = (child: React.ReactNode) => act(() => root.render(React.createElement(UiLocaleProvider, null, React.createElement(Controls), child)));
const japanese = () => act(() => setLocale('ja-JP'));
const click = (text: string) => {
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent === text);
  expect(button, text).toBeTruthy();
  act(() => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  backup.days = null;
  backup.interval = 7;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('localized recovery and shared shell controls', () => {
  it('uses localized Modal defaults without translating dynamic content', () => {
    const close = vi.fn();
    mount(React.createElement(Modal, { isOpen: true, title: '原始标题', children: '用户正文 {name}', onClose: close }));
    expect(container.textContent).toContain('关闭');
    japanese();
    expect(container.textContent).toContain('原始标题用户正文 {name}閉じる');
    click('閉じる');
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves custom Modal footer instead of adding a translated close button', () => {
    mount(React.createElement(Modal, { isOpen: true, title: '', children: '', onClose: () => {}, footer: React.createElement('button', null, '自定义按钮') }));
    japanese();
    expect(container.textContent).toBe('自定义按钮');
  });

  it('translates confirmation defaults and preserves callbacks', () => {
    const confirm = vi.fn();
    const cancel = vi.fn();
    mount(React.createElement(ConfirmDialog, { isOpen: true, title: '原标题', message: '原消息', onConfirm: confirm, onCancel: cancel }));
    expect(container.textContent).toContain('取消确认');
    japanese();
    expect(container.textContent).toContain('原标题原消息');
    click('確認');
    click('キャンセル');
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not guess translations of explicit confirmation labels', () => {
    mount(React.createElement(ConfirmDialog, { isOpen: true, title: '', message: '', confirmText: '删除原记录', cancelText: '', onConfirm: () => {}, onCancel: () => {} }));
    japanese();
    expect(container.textContent).toBe('删除原记录');
    expect(container.querySelectorAll('button')[0].textContent).toBe('');
  });

  it('renders nothing for an absent recovery marker', () => {
    mount(React.createElement(ImportRecoveryPopup, { marker: null, onLater: () => {}, onReimport: () => {} }));
    japanese();
    expect(container.textContent).toBe('');
  });

  it('changes failed recovery copy without mutating progress, filenames or error text', () => {
    const marker: ImportRecoveryMarker = Object.freeze({ phase: 'assets', error: 'RAW_ERROR 原文 {name}', source: '原备份.zip', sourceSize: 2048, current: '原分组', currentFile: '原文件.png', currentFileSize: 1024, itemDone: 0, itemTotal: 3, assetDone: 1, assetTotal: 5, startedAt: 1790812800000, updatedAt: 1790812800000 });
    const original = JSON.stringify(marker);
    const later = vi.fn();
    const reimport = vi.fn();
    mount(React.createElement(ImportRecoveryPopup, { marker, onLater: later, onReimport: reimport }));
    expect(container.textContent).toContain('上次导入失败了');
    expect(container.textContent).toContain('条目进度：0/3');
    japanese();
    for (const text of ['前回のインポートに失敗しました', 'バックアップ素材を復元', 'RAW_ERROR 原文 {name}', '原分组', '原文件.png', '0/3', '1/5']) {
      expect(container.textContent).toContain(text);
    }
    expect(container.textContent).toContain('原备份.zip · 2.0 KB');
    expect(container.textContent).toContain(new Date(marker.startedAt!).toLocaleString('ja-JP'));
    click('後で');
    click('再インポートへ');
    expect(later).toHaveBeenCalledOnce();
    expect(reimport).toHaveBeenCalledOnce();
    expect(JSON.stringify(marker)).toBe(original);
  });

  it.each([
    ['parsing', 'バックアップファイルを解析'], ['database', 'データベースに書き込み'],
    ['settings', 'システム設定を復元'], ['error', 'インポートエラー'],
    ['unknown-private-phase', 'インポート処理'],
  ])('handles interrupted recovery phase %s with a safe display fallback', (phase, expected) => {
    mount(React.createElement(ImportRecoveryPopup, { marker: { phase, itemTotal: 0, assetTotal: 0 }, onLater: () => {}, onReimport: () => {} }));
    japanese();
    expect(container.textContent).toContain('前回のインポートが中断されました');
    expect(container.textContent).toContain(expected);
    expect(container.textContent).not.toContain('項目の進捗');
    expect(container.textContent).not.toContain('素材の進捗');
    expect(container.textContent).not.toContain('unknown-private-phase');
  });

  it.each(['tech', 'otome', 'cat', 'magazine', 'archive', 'idol'] as CompanionFrameStyleId[])('updates %s lockscreen without translating character names', variant => {
    const char = { name: '萧逸 {name}' } as CharacterProfile;
    const props = { variant, hours: 9, minutes: 5, activeCharacter: char, unreadCharacter: char, unreadCount: 0 };
    mount(React.createElement(CompanionLockChrome, props));
    expect(container.querySelector('.companion-lock-notice')).toBeNull();
    mount(React.createElement(CompanionLockChrome, { ...props, unreadCount: 1 }));
    expect(container.textContent).toContain('发来了一条新消息');
    japanese();
    expect(container.textContent).toContain('萧逸 {name}');
    expect(container.textContent).toContain('新しいメッセージが届きました');
    expect(container.textContent).toContain('09:05');
    mount(React.createElement(CompanionLockChrome, { ...props, unreadCount: 4 }));
    expect(container.textContent).toContain('新しいメッセージ 4 件');
    expect(container.textContent).toContain('たった今');
    act(() => setLocale('zh-CN'));
    expect(container.textContent).toContain('4 条新消息');
  });

  it.each([null, 0, 1, 9])('renders backup gap %s and retains navigation callbacks', days => {
    backup.days = days;
    const dismiss = vi.fn();
    const go = vi.fn();
    mount(React.createElement(BackupReminderPopup, { onDismiss: dismiss, onGoBackup: go }));
    expect(container.textContent).toContain('该备份啦');
    japanese();
    expect(container.textContent).toContain(days == null ? 'まだバックアップをエクスポートしていません' : `前回のバックアップから ${days} 日が経過しました`);
    expect(container.textContent).toContain('現在の確認間隔は 7 日');
    click('今すぐバックアップ');
    click('了解（バックアップするまでホームに表示が残ります）');
    expect(go).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('wires original lockscreen copy to locale while leaving analytics and raw toasts unchanged', () => {
    const shell = readFileSync(resolve(process.cwd(), 'components/PhoneShell.tsx'), 'utf8');
    expect(shell).toContain("t('shell.lock.unlock')");
    expect(shell).toContain("t(unreadCount > 1 ? 'shell.lock.many' : 'shell.lock.one', { count: unreadCount })");
    expect(shell).toContain("case 'parsing': return '解析备份文件'");
    expect(shell).toContain('getImportPhaseLabel(importRecoveryMarker?.phase)');
    expect(shell).toContain('{toast.message}');
    for (const count of [0, 1, 8]) expect(translateUi('ja-JP', 'shell.lock.many', { count })).toContain(String(count));
  });
});
