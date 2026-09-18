import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  UI_LOCALE_STORAGE_KEY,
  loadUiLocale,
  normalizeUiLocale,
  saveUiLocale,
  translateUi,
  type UiLocale,
  type UiMessageKey,
  type UiMessageParams,
} from '../utils/uiLocale';

interface UiLocaleContextValue {
  locale: UiLocale;
  setLocale: (next: UiLocale | string) => void;
  t: (key: UiMessageKey, params?: UiMessageParams) => string;
}

const UiLocaleContext = createContext<UiLocaleContextValue | undefined>(undefined);

export const UiLocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<UiLocale>(() => loadUiLocale());

  const setLocale = useCallback((next: UiLocale | string) => {
    const normalized = saveUiLocale(normalizeUiLocale(next));
    setLocaleState(normalized);
  }, []);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== UI_LOCALE_STORAGE_KEY) return;
      setLocaleState(loadUiLocale());
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const t = useCallback((key: UiMessageKey, params?: UiMessageParams) => (
    translateUi(locale, key, params)
  ), [locale]);

  const value = useMemo<UiLocaleContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
};

export const useUiLocale = (): UiLocaleContextValue => {
  const context = useContext(UiLocaleContext);
  if (!context) throw new Error('useUiLocale must be used within UiLocaleProvider');
  return context;
};
