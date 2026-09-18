import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_UI_LOCALE,
  UI_LOCALE_STORAGE_KEY,
  type UiTranslationCatalog,
  loadUiLocale,
  normalizeUiLocale,
  resolveUiMessage,
  saveUiLocale,
  translateUi,
} from './uiLocale';

describe('ui locale infrastructure', () => {
  beforeEach(() => localStorage.clear());

  it('normalizes supported locale spellings and falls back to Chinese', () => {
    expect(normalizeUiLocale('ja')).toBe('ja-JP');
    expect(normalizeUiLocale('JA_jp')).toBe('ja-JP');
    expect(normalizeUiLocale('zh')).toBe('zh-CN');
    expect(normalizeUiLocale('en-US')).toBe(DEFAULT_UI_LOCALE);
    expect(normalizeUiLocale(null)).toBe(DEFAULT_UI_LOCALE);
  });

  it('stores only the normalized locale under its independent key', () => {
    expect(loadUiLocale()).toBe(DEFAULT_UI_LOCALE);
    expect(saveUiLocale('ja-JP')).toBe('ja-JP');
    expect(localStorage.getItem(UI_LOCALE_STORAGE_KEY)).toBe('ja-JP');
    expect(loadUiLocale()).toBe('ja-JP');

    localStorage.setItem(UI_LOCALE_STORAGE_KEY, 'invalid');
    expect(loadUiLocale()).toBe(DEFAULT_UI_LOCALE);
  });

  it('translates parameters and falls back to Chinese when a locale key is missing', () => {
    expect(translateUi('ja-JP', 'shell.backup.days', { days: 3 })).toContain('3');

    const catalog: UiTranslationCatalog = {
      'zh-CN': { 'settings.title': '中文标题' },
      'ja-JP': {},
    };
    expect(resolveUiMessage('ja-JP', 'settings.title', catalog)).toBe('中文标题');
  });
});
