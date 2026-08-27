// `blob:` URLs are document-scoped, but they do survive a React App switch
// inside the same PWA document.  Keep a small document-level registry so a
// suspended call can be resumed by a new CallApp instance without throwing
// away audio that is still valid.  A full page reload starts with an empty
// registry, so old persisted blob URLs remain safely rejected.
const activeCallBlobUrls = new Set<string>();

const normalizeCallAudioUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  return url || undefined;
};

/** Register a blob URL created during the current document's call session. */
export const registerCallAudioBlobUrl = (value: unknown): string | undefined => {
  const url = normalizeCallAudioUrl(value);
  if (url?.startsWith('blob:')) activeCallBlobUrls.add(url);
  return url;
};

/** Revoke and forget a blob URL when the real call session is discarded. */
export const revokeCallAudioBlobUrl = (value: unknown): void => {
  const url = normalizeCallAudioUrl(value);
  if (!url?.startsWith('blob:')) return;
  activeCallBlobUrls.delete(url);
  try { URL.revokeObjectURL(url); } catch { /* URL may be unavailable in tests */ }
};

/**
 * A call transcript may outlive the CallApp instance that created its audio.
 * `blob:` URLs are scoped to that document, so a URL restored from a previous
 * page session must never be handed to the audio element as if it were still
 * valid. Remote/data URLs can be reused; live blob URLs are the exception.
 */
export const resolveReusableCallAudioUrl = (
  value: unknown,
  liveBlobUrls?: ReadonlySet<string>,
): string | undefined => {
  const url = normalizeCallAudioUrl(value);
  if (!url) return undefined;
  if (url.startsWith('blob:') && !liveBlobUrls?.has(url) && !activeCallBlobUrls.has(url)) return undefined;
  return url;
};
