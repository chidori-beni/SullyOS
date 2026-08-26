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
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (!url) return undefined;
  if (url.startsWith('blob:') && !liveBlobUrls?.has(url)) return undefined;
  return url;
};
