import React from 'react';
import { createPortal } from 'react-dom';

interface SuspendedCallBarProps {
  charName: string;
  onResume: () => void;
}

/**
 * The suspended-call affordance must sit above portal-based message previews.
 * Keeping it in PhoneShell's z-10 stacking context made it possible for a
 * notification card to visually cover the button while another chat was open.
 */
const SuspendedCallBar: React.FC<SuspendedCallBarProps> = ({ charName, onResume }) => {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onResume();
  };

  const content = (
    <div
      className="fixed inset-x-0 z-[1400] flex justify-center pointer-events-none"
      style={{ top: 'max(1.75rem, calc(var(--safe-top, 0px) + 0.25rem))' }}
    >
      <button
        type="button"
        onClick={handleClick}
        data-testid="suspended-call-return"
        aria-label={`返回与${charName}的通话`}
        className="pointer-events-auto flex w-full items-center justify-center gap-2 bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-md cursor-pointer animate-pulse transition-colors active:bg-emerald-600"
        style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
      >
        <span className="h-2 w-2 rounded-full bg-white animate-ping" aria-hidden="true" />
        <span>通话中 · {charName}</span>
        <span className="opacity-70">点击返回</span>
      </button>
    </div>
  );

  if (typeof document === 'undefined' || !document.body) return content;
  return createPortal(content, document.body);
};

export default SuspendedCallBar;
