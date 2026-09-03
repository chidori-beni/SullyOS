import React from 'react';
import type { LauncherUserWidget } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';
import { launcherWidgetSpan } from '../../utils/launcherUserWidgets';

/**
 * 桌面上的一个用户图片组件。
 * 只负责画：图 / 空占位 / 整理模式下的提示角标；所有交互都由 Launcher 的拖拽状态机接管
 * （编辑模式里点击事件会被整体吞掉，见 Launcher 的 handleClickCapture）。
 */
const LauncherUserWidgetView = React.memo(({
    widget,
    editing = false,
    paper = false,
    acnh = false,
    contentColor = '#ffffff',
}: {
    widget: LauncherUserWidget;
    editing?: boolean;
    paper?: boolean;
    acnh?: boolean;
    contentColor?: string;
}) => {
    const url = useBlobRefUrl(widget.image);
    const { cols } = launcherWidgetSpan(widget.size);
    // 一格宽的竖条用小圆角，否则圆角比组件本身还抢眼。
    const radius = cols <= 1 ? '1.1rem' : '1.6rem';

    // 有图就默认「裸奔」：不画背景、描边和投影。
    // 用户传透明 PNG 的用意就是让它融进壁纸，底框和投影会把它重新框成一张卡；
    // 想要卡片观感的可以在编辑面板里把「底框」打开。空占位永远画框，否则看不见。
    const framed = !url || widget.frame === true;

    const frameStyle: React.CSSProperties = !framed ? {
        // 圆角仍然保留：cover 的照片需要它，透明 PNG 的四角本来就是透明的，切不到东西。
        color: paper ? '#6b5b47' : contentColor,
    } : paper ? {
        background: url ? 'rgba(224,221,215,0.26)' : 'rgba(224,221,215,0.38)',
        border: '1px solid rgba(91,72,51,0.07)',
        boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
        color: '#6b5b47',
    } : acnh ? {
        background: 'rgb(247,243,223)',
        border: '2px solid #e8e2d6',
        boxShadow: '0 6px 18px rgba(61,52,40,0.12)',
        color: '#725d42',
    } : {
        background: url ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.24)',
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 8px 30px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.07)',
        color: contentColor,
    };

    return (
        <div
            className="relative w-full h-full overflow-hidden select-none"
            style={{ ...frameStyle, borderRadius: radius }}
        >
            {url ? (
                // 绝对定位是必须的：网格行是 minmax(min, auto)，图片如果留在文档流里，
                // 它自己的长宽比会把行撑开——一张 1:1 的图能把 4x2 的组件顶成正方形。
                // 脱流之后组件高度只由 grid span 决定，换什么图都一样高。
                <img
                    src={url}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className={`absolute inset-0 w-full h-full ${widget.fit === 'contain' ? 'object-contain' : 'object-cover'}`}
                />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-5 h-5 opacity-60">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                    <div className="text-[8.5px] font-bold tracking-[0.14em] opacity-60 leading-tight">
                        {widget.size.replace('x', '×')}
                    </div>
                    {cols >= 2 && (
                        <div className="text-[8px] opacity-45 leading-tight">长按上传图片</div>
                    )}
                </div>
            )}

            {editing && (
                <>
                    <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.10)' }} />
                    <div
                        className="absolute left-1.5 top-1.5 w-5 h-5 rounded-full flex items-center justify-center pointer-events-none"
                        style={{ background: 'rgba(30,26,22,0.72)', color: '#fffdf8' }}
                        aria-hidden="true"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.6} stroke="currentColor" className="w-3 h-3">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                    </div>
                    {cols >= 2 && (
                        <div
                            className="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-[2px] rounded-full text-[8px] font-bold whitespace-nowrap pointer-events-none"
                            style={{ background: 'rgba(30,26,22,0.66)', color: '#fffdf8' }}
                        >
                            轻点编辑 · 拖动换位
                        </div>
                    )}
                </>
            )}
        </div>
    );
});

LauncherUserWidgetView.displayName = 'LauncherUserWidgetView';

export default LauncherUserWidgetView;
