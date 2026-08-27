/**
 * The call player is deliberately document-scoped instead of component-scoped.
 * Switching to another in-phone app (or suspending a call) unmounts CallApp,
 * but the current role audio should be allowed to finish.  A full page reload
 * naturally drops this reference and the next call creates a fresh element.
 */
let sharedCallAudio: HTMLAudioElement | null = null;
let callAudioResumeIntent = false;

const createCallAudio = (): HTMLAudioElement | null => {
  try {
    if (typeof Audio === 'function') return new Audio();
    if (typeof document !== 'undefined') return document.createElement('audio');
  } catch {
    // Some test/WebView environments expose Audio but do not allow creating it.
  }
  return null;
};

/** Return the one audio element used by every CallApp instance in this page. */
export const getCallAudioElement = (): HTMLAudioElement | null => {
  if (!sharedCallAudio) {
    sharedCallAudio = createCallAudio();
    if (sharedCallAudio) {
      sharedCallAudio.preload = 'auto';
      // Keep iOS/WebKit in the inline media path; it is still controlled by the
      // Audio Session route selected by the caller.
      sharedCallAudio.setAttribute('playsinline', 'true');
      sharedCallAudio.setAttribute('webkit-playsinline', 'true');
    }
  }
  return sharedCallAudio;
};

/** Whether the current turn should be resumed after an OS/background pause. */
export const setCallAudioResumeIntent = (shouldResume: boolean): void => {
  callAudioResumeIntent = shouldResume;
};

export const getCallAudioResumeIntent = (): boolean => callAudioResumeIntent;

/**
 * Stop and clear the player only when a call really ends or a new call starts.
 * CallApp unmount cleanup must not call this: unmounting is also how the
 * in-phone “先忙别的” suspend flow changes apps.
 */
export const resetCallAudioElement = (): void => {
  const audio = sharedCallAudio;
  callAudioResumeIntent = false;
  if (!audio) return;
  try { audio.pause(); } catch { /* ignore */ }
  try { audio.currentTime = 0; } catch { /* ignore */ }
  try { audio.removeAttribute('src'); } catch { /* ignore */ }
  try { audio.load(); } catch { /* ignore */ }
};
