import type { CloudBackupFile } from '../types';
import { translateUi, type UiLocale } from './uiLocale';

export const formatCloudBackupStatus = (locale: UiLocale, file: CloudBackupFile): string | undefined => {
  if (file.statusUiMessage) return translateUi(locale, file.statusUiMessage.key, file.statusUiMessage.params);
  if (file.statusUiReasons?.length) return translateUi(locale, 'settings.cloudStatus.incomplete', {
    reasons: file.statusUiReasons.map(reason => translateUi(locale, reason.key, reason.params)).join('；'),
  });
  return file.statusMessage;
};
