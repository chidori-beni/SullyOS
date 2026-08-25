import React, { useRef } from 'react';
import { normalizeReactionEmoji, parseReactionShortcutInput } from '../../utils/messageReactions';

interface MessageReactionBarProps {
    shortcuts: string[];
    activeEmojis?: string[];
    onReact: (emoji: string) => void;
    onChange: (emojis: string[]) => void;
}

const MessageReactionBar: React.FC<MessageReactionBarProps> = ({ shortcuts, activeEmojis = [], onReact, onChange }) => {
    const timerRef = useRef<number | null>(null);
    const longPressedRef = useRef(false);

    const replaceShortcut = (index: number) => {
        const answer = window.prompt('把这个快捷 emoji 换成：', shortcuts[index]);
        if (answer == null) return;
        const emoji = normalizeReactionEmoji(answer);
        if (!emoji) return;
        const next = [...shortcuts];
        next[index] = emoji;
        onChange(Array.from(new Set(next)));
    };

    const startPress = (index: number) => {
        longPressedRef.current = false;
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            longPressedRef.current = true;
            replaceShortcut(index);
        }, 550);
    };

    const cancelPress = () => {
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
    };

    const editAll = () => {
        const answer = window.prompt('设置常用 emoji（用空格分隔，最多 12 个）：', shortcuts.join(' '));
        if (answer == null) return;
        const next = parseReactionShortcutInput(answer);
        if (next.length) onChange(next);
    };

    return (
        <div className="mb-3 rounded-2xl border border-slate-100 bg-white/95 p-2 shadow-sm">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar" aria-label="消息 emoji 反应">
                {shortcuts.map((emoji, index) => (
                    <button
                        key={`${emoji}-${index}`}
                        type="button"
                        aria-label={`用 ${emoji} 回应`}
                        title="点击回应；长按可替换这个快捷 emoji"
                        onPointerDown={() => startPress(index)}
                        onPointerUp={cancelPress}
                        onPointerCancel={cancelPress}
                        onPointerLeave={cancelPress}
                        onContextMenu={(event) => { event.preventDefault(); cancelPress(); replaceShortcut(index); }}
                        onClick={() => { if (!longPressedRef.current) onReact(emoji); longPressedRef.current = false; }}
                        className={`shrink-0 w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-transform active:scale-90 ${activeEmojis.includes(emoji) ? 'bg-primary/15 ring-1 ring-primary/30' : 'bg-slate-50 hover:bg-slate-100'}`}
                    >
                        {emoji}
                    </button>
                ))}
                <button type="button" onClick={editAll} className="shrink-0 w-10 h-10 rounded-xl bg-slate-100 text-slate-500 text-lg font-medium active:scale-90" aria-label="编辑常用 emoji" title="编辑常用 emoji">＋</button>
            </div>
            <div className="mt-1.5 px-1 text-[10px] text-slate-400">点击回应 · 长按替换 · ＋ 可编辑整排</div>
        </div>
    );
};

export default MessageReactionBar;
