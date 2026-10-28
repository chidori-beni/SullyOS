import { useEffect, useRef, useState } from 'react';
import { hasProfileTranslationApi, naturalProfileTranslator, profileTranslationKey, type ProfileDisplayText, type ProfileTranslationApi } from '../utils/naturalProfileTranslation';

export const useNaturalProfileDisplay = (open: boolean, locale: string, id: string, profile: ProfileDisplayText | undefined, api?: ProfileTranslationApi) => {
  const key = profile ? profileTranslationKey(id, profile) : '';
  const tag = JSON.stringify([key, api?.baseUrl, api?.model, api?.apiKey]);
  const [attempt, setAttempt] = useState(0);
  const retryTag = useRef<string | null>(null);
  const [state, setState] = useState<{ tag: string; text?: ProfileDisplayText; error?: string }>({ tag: '' });
  const active = open && locale === 'ja-JP' && !!profile;
  useEffect(() => {
    if (!active || !profile) return;
    let alive = true;
    const cached = naturalProfileTranslator.read(key);
    if (cached) { setState({ tag, text: cached }); return; }
    if (!hasProfileTranslationApi(api)) return;
    setState({ tag });
    const retry = retryTag.current === tag;
    retryTag.current = null;
    void naturalProfileTranslator.translate(id, profile, api, retry).then(
      text => { if (alive) setState({ tag, text }); },
      error => { if (alive) setState({ tag, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { alive = false; };
    // Source text and API primitives, not object identity, determine this request.
  }, [active, key, tag, attempt]);
  const cached = active ? naturalProfileTranslator.read(key) : undefined;
  const current = active && state.tag === tag ? state : undefined;
  const text = cached ?? current?.text;
  return {
    text: active && text ? text : profile,
    loading: active && !text && hasProfileTranslationApi(api) && !current?.error,
    missingApi: active && !text && !hasProfileTranslationApi(api),
    error: text ? undefined : current?.error,
    retry: () => { retryTag.current = tag; setAttempt(value => value + 1); },
  };
};
