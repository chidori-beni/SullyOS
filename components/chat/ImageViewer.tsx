/**
 * ImageViewer.tsx —— 聊天里点开图片的大图页
 *
 * 解决两件事（都是实机反馈）：
 *
 * 1. **消息界面的图点不开、也存不下来**。气泡外壳为了长按菜单和侧滑回复，整块加了
 *    `user-select:none` + `-webkit-touch-callout:none`，顺带把 iOS 自带的
 *    「长按图片 → 存储到照片」也一起摁死了，于是只能绕去相册 App 里存。
 *    这里的大图页把这两个属性放开，长按仍然能走系统菜单；另外给一个
 *    「存到手机」按钮（走 Web Share 的分享面板，iOS 上最稳，见 utils/imageSave.ts）。
 *
 * 2. **生成出来的图不满意没法重画**。原来只有「正在画 / 没画出来」两种坏状态才给重画入口，
 *    画成功了反而没有。参考糯叽机 4.3 的看图页做法（`RerollEditModal` + 变体切换器）：
 *    同提示词重画、改词重画，画出来的每一张都留着可以来回翻，挑定了才落库。
 *
 * **跟糯叽机不一样的一处**：糯叽机是「关掉看图页 = 采用当前显示的那张」。这里改成必须
 * 点「用这张」才会覆盖原图，直接关掉一律保留原图。少一个「只是想看看结果，结果原图被换掉」
 * 的坑，代价是多点一下。
 *
 * 变体只活在这一次打开期间，不落库、不占空间；关掉就没了。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsClockwise, Check, DownloadSimple, Images, PencilSimple, X } from '@phosphor-icons/react';
import type { Message } from '../../types';
import { DB } from '../../utils/db';
import { saveImageToDevice, saveImageToGallery } from '../../utils/imageSave';
import {
    applyGeneratedImage,
    getImageGenConfig,
    isImageGenReady,
    notifyImageGenUpdated,
    readImageGenMeta,
    rerollImageOnce,
    type AppearanceSelectionApi,
    type ImageGenMeta,
} from '../../utils/novelaiImage';

interface Variant {
    url: string;
    prompt: string;
    /** 第一张（进来时那张）不是重画出来的，采用它等于什么都不做。 */
    original: boolean;
}

export interface ImageViewerProps {
    message: Message;
    onClose: () => void;
    /** 图片真的被换掉之后调用，聊天页据此重读一次库。 */
    onApplied?: () => void;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    /** 角色自拍重画时，重新按当前场景选择衣橱。 */
    imageSelectionApi?: AppearanceSelectionApi | null;
    imageSelectionTimeZone?: string;
}

const ImageViewer: React.FC<ImageViewerProps> = ({
    message,
    onClose,
    onApplied,
    addToast,
    imageSelectionApi,
    imageSelectionTimeZone,
}) => {
    const meta: ImageGenMeta | null = readImageGenMeta(message.metadata);
    const basePrompt = (meta?.prompt || '').trim();

    const [variants, setVariants] = useState<Variant[]>(() => [
        { url: message.content, prompt: basePrompt, original: true },
    ]);
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [zoomed, setZoomed] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(basePrompt);
    const [inGallery, setInGallery] = useState<boolean>(Boolean(meta?.galleryImageId));
    const busyRef = useRef(false);

    const current = variants[index] || variants[0];
    const cfg = useMemo(() => getImageGenConfig(), []);
    const canReroll = Boolean(basePrompt) && isImageGenReady(cfg);

    // 送 API 的正文长什么样：角色写的提示词 + 设置里的画质词，跟 buildNovelAiBody 一致。
    // 糯叽机的「实际 HTTP 请求」预览很有用，但那边要现拼外观 / 世界书；我们这边提示词
    // 落库时就已经是最终版了，所以只需要把额外追加的画质词摊开给人看。
    const previewPositive = useMemo(
        () => [draft.trim(), cfg.qualityTags.trim()].filter(Boolean).join(', '),
        [draft, cfg.qualityTags],
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const runReroll = useCallback(async (prompt: string) => {
        if (busyRef.current) return;
        const clean = prompt.trim();
        if (!clean) { setError('提示词是空的，画不了'); return; }
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            const reroll = await rerollImageOnce(clean, {
                charId: message.charId,
                imageIntent: meta?.imageIntent,
                selfieScene: meta?.selfieScene,
                api: imageSelectionApi,
                timeZone: imageSelectionTimeZone,
                reselectWardrobe: !editing,
            });
            setVariants(prev => {
                const next = [...prev, { url: reroll.url, prompt: reroll.prompt, original: false }];
                setIndex(next.length - 1);
                return next;
            });
            setZoomed(false);
            setEditing(false);
        } catch (e: any) {
            // NovelAI 的原话原样显示，别改写成「生成失败」——那是排错唯一的线索。
            setError(e?.message || String(e));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [editing, imageSelectionApi, imageSelectionTimeZone, message.charId, meta?.imageIntent, meta?.selfieScene]);

    const applyCurrent = useCallback(async () => {
        if (!current || current.original || busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        try {
            await applyGeneratedImage(message.id, current.url, current.prompt, message.charId);
            notifyImageGenUpdated();
            onApplied?.();
            addToast('已换成这一张', 'success');
            onClose();
        } catch (e: any) {
            setError(`保存失败：${e?.message || e}`);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [current, message.id, message.charId, onApplied, onClose, addToast]);

    const handleClose = useCallback(() => {
        if (busyRef.current) return;
        if (variants.length > 1 && current && !current.original) {
            addToast('已放弃这次重画，原来那张没有动', 'info');
        }
        onClose();
    }, [variants.length, current, onClose, addToast]);

    const handleSaveToDevice = useCallback(() => {
        // 同步进 saveImageToDevice，中间不 await——iOS 的分享手势只认这一拍。
        void saveImageToDevice(current?.url || '', 'sullyos-image').then(result => {
            if (result.message) addToast(result.message, result.ok ? 'success' : 'error');
        });
    }, [current, addToast]);

    const handleSaveToGallery = useCallback(async () => {
        if (!message.charId || !current?.url) return;
        try {
            const galleryImageId = await saveImageToGallery(message.charId, current.url, {
                chatContext: current.prompt ? [current.prompt] : undefined,
            });
            // 记在消息上，下次打开这张图按钮直接变灰，不会越存越多张一样的。
            await DB.updateMessageMetadata(message.id, (prev: any) => ({
                ...(prev || {}),
                imageGen: { ...(prev?.imageGen || { status: 'generated', prompt: current.prompt }), galleryImageId },
            }));
            setInGallery(true);
            addToast('已存进相册', 'success');
        } catch (e: any) {
            addToast(`存进相册失败：${e?.message || e}`, 'error');
        }
    }, [message.charId, message.id, current, addToast]);

    const step = (delta: number) => {
        if (variants.length <= 1) return;
        setIndex(prev => (prev + delta + variants.length) % variants.length);
        setZoomed(false);
    };

    const iconButton = 'w-11 h-11 shrink-0 grid place-items-center rounded-full text-white bg-white/15 backdrop-blur-md active:scale-90 transition-transform disabled:opacity-35 disabled:active:scale-100';

    const portal = (
        <div className="sully-image-viewer" onClick={handleClose}>
            <style>{`
                .sully-image-viewer {
                    position: fixed; inset: 0; z-index: 1700;
                    background: rgba(0,0,0,0.94);
                    display: flex; flex-direction: column;
                    animation: sullyImageViewerIn .18s ease-out both;
                }
                @keyframes sullyImageViewerIn { from { opacity: 0; } to { opacity: 1; } }
                /* 大图这里要把气泡外壳压着的两个属性放回来：
                   iOS 长按图片弹「存储到照片」全靠它们。 */
                .sully-image-viewer img.sully-image-viewer-img {
                    -webkit-touch-callout: default;
                    -webkit-user-select: auto;
                    user-select: auto;
                }
                @media (prefers-reduced-motion: reduce) { .sully-image-viewer { animation: none; } }
            `}</style>

            <div
                className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-3"
                style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
            >
                <img
                    src={current?.url}
                    alt="查看大图"
                    onClick={e => { e.stopPropagation(); setZoomed(v => !v); }}
                    className="sully-image-viewer-img rounded-md shadow-2xl"
                    style={zoomed
                        ? { width: '200%', maxWidth: 'none', height: 'auto' }
                        : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
            </div>

            {busy && (
                <div className="pointer-events-none absolute inset-x-0 top-[max(20px,env(safe-area-inset-top))] flex items-center justify-center gap-2.5">
                    <span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span className="text-white text-[13px] font-bold tracking-wide">重画中…</span>
                </div>
            )}

            <div
                className="shrink-0 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2 space-y-3"
                onClick={e => e.stopPropagation()}
            >
                {error && (
                    <div className="max-h-28 overflow-y-auto rounded-xl bg-rose-500/15 border border-rose-400/40 px-3 py-2 text-[11px] leading-relaxed text-rose-200 break-words">
                        {error}
                    </div>
                )}

                {variants.length > 1 && (
                    <div className="flex items-center justify-center gap-3">
                        <button type="button" onClick={() => step(-1)} className={iconButton} aria-label="上一张">‹</button>
                        <span className="min-w-[92px] text-center text-[12px] font-bold text-white/90 tabular-nums bg-white/10 backdrop-blur-md rounded-full px-3 py-2">
                            {current?.original ? '原图' : `重画 ${index}`} · {index + 1}/{variants.length}
                        </span>
                        <button type="button" onClick={() => step(1)} className={iconButton} aria-label="下一张">›</button>
                        <button
                            type="button"
                            onClick={() => void applyCurrent()}
                            disabled={busy || !current || current.original}
                            className="h-11 px-4 shrink-0 flex items-center gap-1.5 rounded-full text-[13px] font-bold text-white bg-emerald-500/80 backdrop-blur-md active:scale-95 transition-transform disabled:opacity-30 disabled:active:scale-100"
                        >
                            <Check size={17} weight="bold" /> 用这张
                        </button>
                    </div>
                )}

                {editing ? (
                    <div className="rounded-2xl bg-white/10 backdrop-blur-md p-3 space-y-2">
                        <div className="text-[11px] font-bold text-white/70">改一下提示词再画</div>
                        <textarea
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            rows={4}
                            className="w-full rounded-xl bg-black/40 border border-white/15 px-3 py-2 text-[13px] leading-relaxed text-white/95 outline-none focus:border-white/40"
                            placeholder="英文 Danbooru tag，逗号分隔"
                        />
                        <div className="text-[10px] leading-relaxed text-white/45 break-words">
                            实际送 NovelAI 的正向提示词：{previewPositive || '（空）'}
                            {cfg.negativePrompt.trim() ? <><br />负面：{cfg.negativePrompt.trim()}</> : null}
                            <br />{cfg.model} · {cfg.size} · steps {cfg.steps} · scale {cfg.scale} · 种子每次重画都换
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => { setEditing(false); setDraft(basePrompt); }}
                                className="flex-1 h-10 rounded-xl text-[13px] font-bold text-white/70 bg-white/10 active:scale-95 transition-transform"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={() => void runReroll(draft)}
                                disabled={busy || !draft.trim()}
                                className="flex-1 h-10 rounded-xl text-[13px] font-bold text-white bg-violet-500/85 active:scale-95 transition-transform disabled:opacity-35"
                            >
                                按这个画
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2.5">
                        <button type="button" onClick={handleSaveToDevice} className={iconButton} aria-label="存到手机" title="存到手机">
                            <DownloadSimple size={20} weight="bold" />
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleSaveToGallery()}
                            disabled={!message.charId || inGallery}
                            className={iconButton}
                            aria-label={inGallery ? '已经在相册里' : '存到相册'}
                            title={inGallery ? '已经在相册里' : '存到相册'}
                        >
                            <Images size={20} weight={inGallery ? 'fill' : 'bold'} />
                        </button>
                        {canReroll && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => void runReroll(basePrompt)}
                                    disabled={busy}
                                    className={iconButton}
                                    aria-label="同提示词重画"
                                    title="同提示词重画"
                                >
                                    <ArrowsClockwise size={20} weight="bold" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setDraft(basePrompt); setEditing(true); }}
                                    disabled={busy}
                                    className={iconButton}
                                    aria-label="改词重画"
                                    title="改词重画"
                                >
                                    <PencilSimple size={20} weight="bold" />
                                </button>
                            </>
                        )}
                        <button type="button" onClick={handleClose} className={iconButton} aria-label="关闭">
                            <X size={21} weight="bold" />
                        </button>
                    </div>
                )}

                {!editing && (
                    <div className="text-center text-[10px] leading-relaxed text-white/35">
                        {canReroll
                            ? '点图放大 · 长按图片可直接存到相册 · 重画满意后要点「用这张」才会替换'
                            : '点图放大 · 长按图片可直接存到相册'}
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(portal, document.body);
};

export default ImageViewer;
