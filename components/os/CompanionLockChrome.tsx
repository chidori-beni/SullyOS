import React from 'react';
import { useUiLocale } from '../../context/UiLocaleContext';
import type { UiMessageKey } from '../../utils/uiLocale';
import {
  Broadcast,
  Cat,
  ChatCircleDots,
  Diamond,
  LockSimple,
  PawPrint,
  Sparkle,
  TerminalWindow,
} from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import type { CompanionFrameStyleId } from './companionFrameStyles';
import './CompanionLockChrome.css';

type CompanionLockChromeProps = {
  variant: CompanionFrameStyleId;
  hours: number;
  minutes: number;
  activeCharacter?: CharacterProfile | null;
  unreadCharacter?: CharacterProfile | null;
  unreadCount: number;
  preserveWallpaper?: boolean;
};

const LOCK_COPY: Record<CompanionFrameStyleId, { eyebrow: string; line?: UiMessageKey; unlock: UiMessageKey }> = {
  tech: { eyebrow: 'ORBITAL COMPANION OS', line: 'shell.lock.tech.line', unlock: 'shell.lock.tech.unlock' },
  otome: { eyebrow: 'DAYBOOK · LOCK', line: 'shell.lock.otome.line', unlock: 'shell.lock.otome.unlock' },
  cat: { eyebrow: 'NIGHT COMPANION', line: 'shell.lock.cat.line', unlock: 'shell.lock.cat.unlock' },
  magazine: { eyebrow: 'PRIVATE HOURS · LOCK ISSUE', line: 'shell.lock.magazine.line', unlock: 'shell.lock.magazine.unlock' },
  archive: { eyebrow: 'LUMINA CARD ARCHIVE', line: 'shell.lock.archive.line', unlock: 'shell.lock.archive.unlock' },
  idol: { eyebrow: '', unlock: 'shell.lock.idol.unlock' },
};

const CompanionLockChrome: React.FC<CompanionLockChromeProps> = ({
  variant,
  hours,
  minutes,
  activeCharacter,
  unreadCharacter,
  unreadCount,
  preserveWallpaper = false,
}) => {
  const { locale, t } = useUiLocale();
  const date = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  const numericDate = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .replaceAll('/', '.');
  const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  const characterName = activeCharacter?.name || 'Sully';
  const definition = LOCK_COPY[variant];
  const copy = { eyebrow: definition.eyebrow, line: definition.line ? t(definition.line) : '', unlock: t(definition.unlock) };

  return (
    <div
      className={`companion-themed-lock companion-themed-lock--${variant}`}
      style={{ '--lock-theme-opacity': preserveWallpaper ? 0.58 : 1 } as React.CSSProperties}
      data-testid={`companion-${variant}-lockscreen`}
    >
      <div className="companion-lock-wallpaper" aria-hidden><i /><i /><i /><i /></div>

      {variant === 'otome' && (
        <>
          <header className="companion-lock-daybook"><span>{copy.eyebrow}</span><strong>{characterName}</strong><small>{date}</small></header>
          <div className="companion-lock-time companion-lock-time--otome"><strong>{time}</strong><span>{copy.line}</span></div>
        </>
      )}

      {variant === 'cat' && (
        <>
          <header className="companion-lock-cat-mark"><Cat weight="fill" /><span>{copy.eyebrow}</span></header>
          <div className="companion-lock-time companion-lock-time--cat"><span className="companion-lock-cat-ears" aria-hidden /><strong>{time}</strong><span>{date} · {characterName} {copy.line}</span></div>
        </>
      )}

      {variant === 'tech' && (
        <>
          <header className="companion-lock-tech-head"><TerminalWindow weight="duotone" /><span>{copy.eyebrow}</span><i>SYS / 08</i></header>
          <div className="companion-lock-time companion-lock-time--tech"><small>{numericDate}</small><strong>{time}</strong><span>{characterName} · {copy.line}</span></div>
          <div className="companion-lock-tech-readout" aria-hidden><span>LINK</span><i /><strong>STABLE</strong><em>09 / AXIS</em></div>
        </>
      )}

      {variant === 'magazine' && (
        <>
          <header className="companion-lock-mag-head"><span>{copy.eyebrow}</span><strong>08</strong><small>{numericDate}</small></header>
          <div className="companion-lock-mag-name">{characterName}</div>
          <div className="companion-lock-time companion-lock-time--magazine"><strong>{time}</strong><span>{copy.line}</span></div>
          <div className="companion-lock-mag-caption" aria-hidden><span>PERSONA<br />IN MOTION</span><small>VISUAL CHARACTER JOURNAL</small></div>
        </>
      )}

      {variant === 'archive' && (
        <>
          <header className="companion-lock-archive-head"><span>{copy.eyebrow}</span><i /><small>COLLECTOR · {numericDate}</small></header>
          <div className="companion-lock-archive-seal" aria-hidden><Diamond weight="duotone" /><span>CARD</span><strong>08</strong></div>
          <div className="companion-lock-time companion-lock-time--archive"><small>{characterName} · STAR WISH</small><strong>{time}</strong><span>{copy.line}</span></div>
        </>
      )}

      {variant === 'idol' && (
        <div className="companion-lock-time companion-lock-time--idol"><strong>{time}</strong><span>{date}</span></div>
      )}

      {unreadCount > 0 && (
        <section className="companion-lock-notice">
          <span className="companion-lock-notice-icon">
            {variant === 'cat' ? <PawPrint weight="fill" /> : variant === 'idol' ? <Broadcast weight="fill" /> : variant === 'archive' ? <Sparkle weight="fill" /> : <ChatCircleDots weight="fill" />}
          </span>
          <span><strong>{unreadCharacter?.name || 'Message'}</strong><small>{t(unreadCount > 1 ? 'shell.lock.companionMany' : 'shell.lock.one', { count: unreadCount })}</small></span>
          <em>{t('shell.lock.now')}</em>
        </section>
      )}

      <div className="companion-lock-unlock">
        <LockSimple weight="bold" /><span>{copy.unlock}</span><i aria-hidden />
      </div>
    </div>
  );
};

export default CompanionLockChrome;
