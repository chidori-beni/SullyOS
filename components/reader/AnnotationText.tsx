import React, { useEffect, useRef, useState } from 'react';
import type { VRNovelAnnotation } from '../../types';
import { useUiLocale } from '../../context/UiLocaleContext';
import { useOS } from '../../context/OSContext';
import { hasProfileTranslationApi } from '../../utils/naturalProfileTranslation';
import { annotationKey, annotationTranslator, isCharacterAnnotation, subscribeAnnotationTranslation } from '../../utils/vrWorld/annotationLocale';
import { stripLeakedAttrs } from '../../utils/vrWorld/prompts';

/** Presentation only. Never save a translated note or send it into character memory. */
export const AnnotationText: React.FC<{ annotation: VRNovelAnnotation }> = ({ annotation }) => {
  const { locale, t } = useUiLocale();
  const { apiConfig } = useOS();
  const host = useRef<HTMLSpanElement>(null);
  const [visibility, setVisibility] = useState({ key: '', visible: false });
  const [manual, setManual] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = useRef(false);
  const [state, setState] = useState<{ tag: string; text?: string; error?: string }>({ tag: '' });
  const key = annotationKey(annotation);
  const visible = visibility.key === key && visibility.visible;
  const tag = JSON.stringify([key, apiConfig.baseUrl, apiConfig.model, apiConfig.apiKey]);
  const eligible = locale === 'ja-JP' && isCharacterAnnotation(annotation);
  const automatic = eligible && annotation.contentLocale !== 'ja-JP';
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisibility({ key, visible: entries.some(entry => entry.isIntersecting) }));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [key]);
  useEffect(() => {
    if (!eligible || (!(automatic && visible) && manual !== tag)) return;
    const cached = annotationTranslator.read(key);
    if (cached) { setState({ tag, text: cached.summary }); return; }
    if (!hasProfileTranslationApi(apiConfig)) return;
    setState({ tag });
    const force = retry.current; retry.current = false;
    return subscribeAnnotationTranslation(annotation, apiConfig,
      text => setState({ tag, text }), error => setState({ tag, error }), force);
  }, [eligible, automatic, visible, key, tag, manual, attempt]);
  const cached = eligible ? annotationTranslator.read(key)?.summary : undefined;
  const current = eligible && state.tag === tag ? state : undefined;
  const text = cached ?? current?.text;
  const requested = eligible && ((automatic && visible) || manual === tag);
  const error = text ? undefined : current?.error;
  const click = () => { retry.current = true; setManual(tag); setAttempt(value => value + 1); };
  return <span ref={host}>
    {stripLeakedAttrs(text ?? annotation.content)}
    {eligible && !text && <span style={{ display: 'block', fontSize: '0.8em', opacity: 0.8 }}>
      {error ? <span role="status">{t('annotation.failed', { message: error })} </span>
        : requested ? <span role="status">{t(hasProfileTranslationApi(apiConfig) ? 'annotation.loading' : 'annotation.api')} </span> : null}
      {(!requested || error) && <button type="button" onClick={click} style={{ textDecoration: 'underline' }}>{t(error ? 'annotation.retry' : 'annotation.translate')}</button>}
    </span>}
  </span>;
};
