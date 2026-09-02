import React, { useEffect, useRef, useState } from 'react';
import type { LauncherUserWidget, LauncherWidgetSize } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';
import {
    LAUNCHER_WIDGET_SIZES,
    LAUNCHER_WIDGET_SIZE_LABELS,
    launcherWidgetSpan,
} from '../../utils/launcherUserWidgets';

/** 尺寸卡片里的缩略比例——照 4 列网格的实际长宽比画，选之前就能看出多大。 */
const SizeSwatch: React.FC<{ size: LauncherWidgetSize; active: boolean; tint: string }> = ({ size, active, tint }) => {
    const { cols, rows } = launcherWidgetSpan(size);
    return (
        <div className="h-11 flex items-end justify-center">
            <div
                className="rounded-[4px] transition-all"
                style={{
                    width: `${cols * 9}px`,
                    height: `${rows * 9}px`,
                    background: active ? tint : 'currentColor',
                    opacity: active ? 1 : 0.28,
                }}
            />
        </div>
    );
};

const WidgetPreview: React.FC<{ widget: LauncherUserWidget }> = ({ widget }) => {
    const url = useBlobRefUrl(widget.image);
    const { cols, rows } = launcherWidgetSpan(widget.size);
    return (
        <div
            className="rounded-2xl overflow-hidden shrink-0 flex items-center justify-center"
            style={{
                width: `${cols * 22}px`,
                height: `${rows * 22}px`,
                background: 'rgba(120,110,95,0.14)',
                border: '1px solid rgba(120,110,95,0.18)',
            }}
        >
            {url && (
                <img
                    src={url}
                    alt=""
                    className={`w-full h-full ${widget.fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                />
            )}
        </div>
    );
};

export interface LauncherWidgetSheetProps {
    mode: 'add' | 'edit';
    widget?: LauncherUserWidget;
    paper?: boolean;
    busy?: boolean;
    onCreate: (size: LauncherWidgetSize) => void;
    onChangeSize: (size: LauncherWidgetSize) => void;
    onPickFile: (file: File) => void;
    onApplyUrl: (url: string) => void;
    onToggleFit: () => void;
    onRemove: () => void;
    onClose: () => void;
}

/**
 * 桌面组件的添加 / 编辑面板。
 * 添加模式只让选尺寸（选完由 Launcher 建好组件再以编辑模式重开）；
 * 编辑模式给「换尺寸 / 相册上传 / 图床链接 / 填充方式 / 移除」。
 */
const LauncherWidgetSheet: React.FC<LauncherWidgetSheetProps> = ({
    mode,
    widget,
    paper = false,
    busy = false,
    onCreate,
    onChangeSize,
    onPickFile,
    onApplyUrl,
    onToggleFit,
    onRemove,
    onClose,
}) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [url, setUrl] = useState('');
    const [confirmRemove, setConfirmRemove] = useState(false);

    useEffect(() => { setConfirmRemove(false); }, [widget?.id, mode]);

    const surface = paper ? '#fbf8f2' : '#1e1b26';
    const text = paper ? '#5b4d42' : '#f6f3ee';
    const subtle = paper ? 'rgba(91,77,66,0.55)' : 'rgba(246,243,238,0.55)';
    const chip = paper ? 'rgba(120,131,105,0.12)' : 'rgba(255,255,255,0.08)';
    const chipActive = paper ? 'rgba(120,131,105,0.28)' : 'rgba(255,255,255,0.22)';
    const accent = paper ? '#78836a' : '#a5b1ff';

    const applyUrl = () => {
        const value = url.trim();
        if (!value) return;
        onApplyUrl(value);
        setUrl('');
    };

    return (
        <div
            className="absolute inset-0 z-[70] flex flex-col justify-end"
            // 面板自成一套交互层，绝不让 pointer 事件冒回桌面的拖拽状态机。
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
        >
            <div className="absolute inset-0" style={{ background: 'rgba(20,17,14,0.42)' }} onClick={onClose} />

            <div
                className="relative rounded-t-[1.75rem] px-5 pt-4 max-h-[78%] overflow-y-auto no-scrollbar"
                style={{
                    background: surface,
                    color: text,
                    paddingBottom: 'calc(1.25rem + var(--safe-bottom, 0px))',
                    boxShadow: '0 -12px 40px rgba(30,24,18,0.28)',
                }}
            >
                <div className="w-9 h-1 rounded-full mx-auto mb-3" style={{ background: subtle, opacity: 0.4 }} />

                <div className="flex items-center justify-between gap-3 mb-4">
                    <div className="min-w-0">
                        <div className="text-[15px] font-bold">{mode === 'add' ? '添加桌面组件' : '编辑组件'}</div>
                        <div className="text-[10px] mt-0.5 leading-relaxed" style={{ color: subtle }}>
                            {mode === 'add'
                                ? '选一个尺寸，组件会加到当前这一页的末尾'
                                : '换图、换尺寸都会立刻生效；拖动组件可以换位置'}
                        </div>
                    </div>
                    {widget && <WidgetPreview widget={widget} />}
                </div>

                <div className="text-[10px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: subtle }}>
                    尺寸（列 × 行）
                </div>
                <div className="grid grid-cols-4 gap-2 mb-5">
                    {LAUNCHER_WIDGET_SIZES.map(size => {
                        const active = mode === 'edit' && widget?.size === size;
                        return (
                            <button
                                key={size}
                                type="button"
                                onClick={() => (mode === 'add' ? onCreate(size) : onChangeSize(size))}
                                className="rounded-2xl px-1 pt-2 pb-2 flex flex-col items-center gap-1 active:scale-95 transition-transform"
                                style={{
                                    background: active ? chipActive : chip,
                                    color: text,
                                    border: active ? `1.5px solid ${accent}` : '1.5px solid transparent',
                                }}
                            >
                                <SizeSwatch size={size} active={active} tint={accent} />
                                <span className="text-[9px] font-bold whitespace-nowrap">
                                    {LAUNCHER_WIDGET_SIZE_LABELS[size]}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {mode === 'edit' && widget && (
                    <>
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] mb-2" style={{ color: subtle }}>
                            图片
                        </div>
                        <input
                            type="file"
                            ref={fileRef}
                            className="hidden"
                            accept="image/*"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) onPickFile(file);
                                e.target.value = '';
                            }}
                        />
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => fileRef.current?.click()}
                            className="w-full py-3 rounded-2xl text-xs font-bold active:scale-95 transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
                            style={{ background: chipActive, color: text }}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 7.5 7.5 12M12 7.5v12" />
                            </svg>
                            {busy ? '正在处理…' : (widget.image ? '从相册更换图片' : '从相册上传图片')}
                        </button>

                        <div className="mt-2 flex gap-2">
                            <input
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') applyUrl(); }}
                                placeholder="或粘贴图床直链 https://…"
                                inputMode="url"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                                className="flex-1 min-w-0 px-3 py-2.5 rounded-2xl text-[11px] outline-none"
                                style={{ background: chip, color: text, border: '1px solid transparent' }}
                            />
                            <button
                                type="button"
                                onClick={applyUrl}
                                className="px-4 rounded-2xl text-[11px] font-bold active:scale-95 transition-transform shrink-0"
                                style={{ background: chipActive, color: text }}
                            >
                                应用
                            </button>
                        </div>

                        <div className="mt-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-xs font-bold">完整显示图片</div>
                                <div className="text-[10px] mt-0.5" style={{ color: subtle }}>
                                    关掉是铺满裁切，打开是整张塞进框里不裁
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onToggleFit}
                                className="w-12 h-7 rounded-full transition-colors relative shrink-0"
                                style={{ background: widget.fit === 'contain' ? accent : chip }}
                            >
                                <div
                                    className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                                    style={{ transform: `translateX(${widget.fit === 'contain' ? '1.5rem' : '0.25rem'})` }}
                                />
                            </button>
                        </div>

                        <div className="mt-5 flex gap-2">
                            {confirmRemove ? (
                                <>
                                    <button
                                        type="button"
                                        onClick={onRemove}
                                        className="flex-1 py-3 rounded-2xl text-xs font-bold active:scale-95 transition-transform"
                                        style={{ background: '#e4634f', color: '#fff' }}
                                    >
                                        确认移除
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmRemove(false)}
                                        className="flex-1 py-3 rounded-2xl text-xs font-bold active:scale-95 transition-transform"
                                        style={{ background: chip, color: text }}
                                    >
                                        取消
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmRemove(true)}
                                        className="flex-1 py-3 rounded-2xl text-xs font-bold active:scale-95 transition-transform"
                                        style={{ background: chip, color: '#e4634f' }}
                                    >
                                        移除组件
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="flex-1 py-3 rounded-2xl text-xs font-bold active:scale-95 transition-transform"
                                        style={{ background: chipActive, color: text }}
                                    >
                                        完成
                                    </button>
                                </>
                            )}
                        </div>
                    </>
                )}

                {mode === 'add' && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-full py-3 rounded-2xl text-xs font-bold active:scale-95 transition-transform"
                        style={{ background: chip, color: text }}
                    >
                        取消
                    </button>
                )}
            </div>
        </div>
    );
};

export default LauncherWidgetSheet;
