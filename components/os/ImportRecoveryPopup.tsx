import React from 'react';
import { useUiLocale } from '../../context/UiLocaleContext';
import { formatBytes } from '../../utils/format';
import type { UiMessageKey } from '../../utils/uiLocale';

export type ImportRecoveryMarker = {
  startedAt?: number;
  updatedAt?: number;
  phase?: string;
  source?: string;
  sourceSize?: number;
  current?: string;
  currentFile?: string;
  currentFileSize?: number;
  assetDone?: number;
  assetTotal?: number;
  itemDone?: number;
  itemTotal?: number;
  error?: string;
};

const getImportPhaseKey = (phase?: string): UiMessageKey => {
  switch (phase) {
    case 'parsing': return 'shell.import.phase.parsing';
    case 'assets': return 'shell.import.phase.assets';
    case 'database': return 'shell.import.phase.database';
    case 'settings': return 'shell.import.phase.settings';
    case 'error': return 'shell.import.phase.error';
    default: return 'shell.import.phase.other';
  }
};

export const ImportRecoveryPopup: React.FC<{
  marker: ImportRecoveryMarker | null;
  onLater: () => void;
  onReimport: () => void;
}> = ({ marker, onLater, onReimport }) => {
  const { locale, t } = useUiLocale();
  if (!marker) return null;

  const phaseLabel = t(getImportPhaseKey(marker.phase));
  const startedAt = marker.startedAt
    ? new Date(marker.startedAt).toLocaleString(locale)
    : '';
  const updatedAt = marker.updatedAt
    ? new Date(marker.updatedAt).toLocaleString(locale)
    : '';
  const sourceSize = formatBytes(marker.sourceSize);
  const currentFileSize = formatBytes(marker.currentFileSize);
  const hasAssetProgress = typeof marker.assetTotal === 'number' && marker.assetTotal > 0;
  const hasItemProgress = typeof marker.itemTotal === 'number' && marker.itemTotal > 0;
  const hasError = !!marker.error;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5 animate-fade-in">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div className="relative w-full max-w-sm bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border border-white/30 overflow-hidden animate-slide-up">
        <div className="pt-7 pb-3 px-6 text-center">
          <h2 className="text-lg font-extrabold text-slate-800">{t(hasError ? 'shell.import.failed' : 'shell.import.interrupted')}</h2>
          <p className="text-[11px] text-slate-400 mt-1">{t(hasError ? 'shell.import.errorSaved' : 'shell.import.incomplete')}</p>
        </div>

        <div className="px-6 pb-4 space-y-3 max-h-[58vh] overflow-y-auto no-scrollbar">
          <p className="text-[13px] text-slate-600 leading-relaxed">
            {t(hasError ? 'shell.import.failedHelp' : 'shell.import.interruptedHelp')}
          </p>
          {hasError && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-[12px] text-red-700 leading-relaxed whitespace-pre-wrap break-words select-text">
              {marker.error}
            </div>
          )}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-[12px] text-amber-700 leading-relaxed">
            <div>{t('shell.import.stage', { phase: phaseLabel })}</div>
            {marker.current && <div>{t('shell.import.current', { current: marker.current })}</div>}
            {hasItemProgress && <div>{t('shell.import.items', { done: marker.itemDone || 0, total: marker.itemTotal! })}</div>}
            {hasAssetProgress && <div>{t('shell.import.assets', { done: marker.assetDone || 0, total: marker.assetTotal! })}</div>}
            {marker.currentFile && (
              <div className="break-all">{t('shell.import.file', { file: marker.currentFile, size: currentFileSize ? ` · ${currentFileSize}` : '' })}</div>
            )}
            {startedAt && <div>{t('shell.import.started', { time: startedAt })}</div>}
            {updatedAt && <div>{t('shell.import.updated', { time: updatedAt })}</div>}
            {marker.source && <div className="break-all">{t('shell.import.source', { file: marker.source, size: sourceSize ? ` · ${sourceSize}` : '' })}</div>}
          </div>
        </div>

        <div className="px-6 pb-7 pt-2 grid grid-cols-2 gap-3">
          <button
            onClick={onLater}
            className="py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-transform text-sm"
          >
            {t('shell.import.later')}
          </button>
          <button
            onClick={onReimport}
            className="py-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold rounded-2xl shadow-lg shadow-emerald-200 active:scale-95 transition-transform text-sm"
          >
            {t('shell.import.reimport')}
          </button>
        </div>
      </div>
    </div>
  );
};

