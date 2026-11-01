// 彼方 · 一键复制按钮：点一下把 getText() 的文字写进剪贴板，图标变成 ✓ 一秒半。
// 放在可长按 / 可点开的卡片里也不会误触发外层：按下和点击都不往外冒泡。

import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check } from '@phosphor-icons/react';
import { copyTextToClipboard } from '../../utils/messageCopyText';

const CopyTextButton: React.FC<{
    getText: () => string;
    label?: string;          // 写了就显示成「图标 + 字」的小胶囊，不写只有图标
    size?: number;
    className?: string;
    style?: React.CSSProperties;
    onResult?: (ok: boolean) => void;
}> = ({ getText, label, size = 13, className = '', style, onResult }) => {
    const [done, setDone] = useState(false);
    const timer = useRef<number | null>(null);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const copy = async (e: React.MouseEvent) => {
        stop(e);
        const text = getText().trim();
        if (!text) { onResult?.(false); return; }
        const ok = await copyTextToClipboard(text);
        onResult?.(ok);
        if (!ok) return;
        setDone(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1500);
    };
    const Icon = done ? Check : Copy;
    return (
        <button type="button" onPointerDown={stop} onClick={copy} aria-label={done ? '已复制' : (label || '复制文字')} title="复制文字"
            className={`shrink-0 inline-flex items-center justify-center gap-1 leading-none active:opacity-60 ${className}`} style={style}>
            <Icon size={size} weight={done ? 'bold' : 'regular'} />
            {label && <span>{done ? '已复制' : label}</span>}
        </button>
    );
};

export default CopyTextButton;
