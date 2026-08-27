// 心声布局模板的内置默认 CSS。
//
// 这份 CSS 与糯叽机 4.64 (assets/XinshengLayoutRenderer-*.js 内嵌的那段) 逐字一致，
// 一个字节都不能改 —— 论坛上流通的心声美化全部是「只覆写自己要改的那几条」写法，
// 默认值就是它们的地基：改了 .xt-collapse-body 的 max-height、改了 --xt-accent 的
// 默认值、少了一条 @keyframes，别人的预设装进来就是塌的。
//
// 想调 Sully 自己的观感，走 XinshengCardModal 外层容器，不要动这里。
export const XINSHENG_DEFAULT_CSS = String.raw`

/* ═══ 心声布局模板默認 CSS ═══ */

/* ── CSS 變量 ── */
.xt-root {
    --xt-bg: #ffffff;
    --xt-text: #1f2937;
    --xt-text-sub: #6b7280;
    --xt-text-muted: #9ca3af;
    --xt-accent: #5b82a6;
    --xt-accent-bg: rgba(91,130,166,0.08);
    --xt-border: #e5e7eb;
    --xt-radius: 16px;
    --xt-radius-sm: 10px;
    --xt-font: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    --xt-anim-duration: 0.45s;
    --xt-anim-easing: cubic-bezier(0.34,1.56,0.64,1);
    --xt-stagger-delay: 80ms;
    --xt-glow-color: rgba(91,130,166,0.35);
    --xt-shadow-sm: 0 2px 8px rgba(0,0,0,0.06);
    --xt-shadow-md: 0 8px 24px rgba(0,0,0,0.1);
    --xt-shadow-lg: 0 16px 48px rgba(0,0,0,0.15);

    background: var(--xt-bg);
    color: var(--xt-text);
    font-family: var(--xt-font);
    border-radius: var(--xt-radius);
    padding: 20px 18px;
    box-shadow: var(--xt-shadow-lg);
    position: relative;
    /* 卡片本體永遠置中：寬度撐滿 wrapper（≤400px）並水平居中，
       APK WebView 下不依賴 flex 對齊（某些 ROM 對含 overflow 的 flex item 居中失準 → 整卡偏左） */
    width: 100%;
    box-sizing: border-box;
    margin-left: auto;
    margin-right: auto;
    max-height: 72vh;
    overflow-y: auto;
    /* 自訂 CSS 若讓內容比卡片寬（絕對定位/負邊距/固定寬），橫向溢出在 APK 上會把整體推偏；
       橫向裁切確保卡片邊界穩定，不被內部超寬元素帶歪 */
    overflow-x: hidden;
    -ms-overflow-style: none;
    scrollbar-width: none;
    /* APK WebView：父層 scale 動畫期間，含背景圖+overflow 的本卡下半部會閃爍（部分重繪）；
       固定自身合成層 + 隱藏背面，讓溢出滾動內容與父層穩定在同一 GPU 層上 */
    transform: translateZ(0);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
}
.xt-root::-webkit-scrollbar { display: none; }
/* 全局安全網：任何圖片都不得超出卡片寬度。
   頭像壓縮放寬後（avatar profile 升到 768px），自訂美化裡靠「圖片原始像素尺寸」
   撐大的 img 會突然變巨大；用 max-width 兜底（非 width，寫死尺寸的設計照常生效）。 */
.xt-root img { max-width: 100%; }

/* Toggle */
.xt-toggle { display: none !important; }

/* ── Header ── */
.xt-header { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
.xt-avatar-wrap { flex-shrink: 0; position: relative; }
.xt-avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; border: 2.5px solid var(--xt-border); }
.xt-name { font-size: 18px; font-weight: 700; }
.xt-header-sub { display: none; font-size: 12px; color: var(--xt-text-muted); }

/* ── Duo Header ── */
.xt-duo { display: flex; align-items: center; justify-content: center; gap: 18px; margin-bottom: 18px; }
.xt-duo-person { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.xt-duo-avatar { width: 56px; height: 56px; border-radius: 50%; object-fit: cover; border: 2.5px solid var(--xt-border); }
.xt-duo-name { font-size: 13px; font-weight: 600; color: var(--xt-text-sub); }
.xt-duo-heart { font-size: 20px; flex-shrink: 0; animation: xt-breathe 2s ease-in-out infinite; }

/* ── Badge ── */
.xt-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; border-radius: 20px; background: var(--xt-accent-bg); font-size: 13px; font-weight: 600; color: var(--xt-accent); margin-bottom: 14px; }
.xt-badge-suffix { font-size: 11px; color: var(--xt-text-muted); }

/* ── Section ── */
.xt-section { margin-bottom: 14px; }
.xt-section-title { font-size: 10px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; margin-bottom: 6px; }
.xt-section-body { font-size: 15px; line-height: 1.7; padding: 12px 16px; background: var(--xt-accent-bg); border-radius: var(--xt-radius-sm); border-left: 3px solid var(--xt-accent); }

/* ── Text ── */
.xt-text { font-size: 14px; line-height: 1.6; color: var(--xt-text-sub); margin-bottom: 12px; padding: 10px 14px; background: rgba(0,0,0,0.02); border-radius: var(--xt-radius-sm); }

/* ── Quote ── */
.xt-quote { position: relative; margin-bottom: 14px; padding: 18px 22px 14px 28px; background: var(--xt-accent-bg); border-radius: var(--xt-radius-sm); font-size: 15px; line-height: 1.8; font-style: italic; color: var(--xt-text); }
.xt-quote::before { content: '"'; position: absolute; top: 4px; left: 8px; font-size: 40px; font-weight: 700; color: var(--xt-accent); opacity: 0.3; font-style: normal; line-height: 1; }
.xt-quote::after { content: '"'; position: absolute; bottom: 0; right: 12px; font-size: 40px; font-weight: 700; color: var(--xt-accent); opacity: 0.3; font-style: normal; line-height: 1; }

/* ── Grid ── */
.xt-grid { display: grid; gap: 10px; margin-bottom: 14px; }
.xt-grid-2 { grid-template-columns: repeat(2, 1fr); }
.xt-grid-3 { grid-template-columns: repeat(3, 1fr); }
.xt-grid-4 { grid-template-columns: repeat(4, 1fr); }
.xt-grid-5 { grid-template-columns: repeat(5, 1fr); }
.xt-grid-6 { grid-template-columns: repeat(6, 1fr); }
.xt-grid-stat { text-align: center; padding: 12px 6px; background: rgba(0,0,0,0.02); border-radius: var(--xt-radius-sm); }
.xt-grid-stat-value { font-size: 16px; font-weight: 700; color: var(--xt-accent); }
.xt-grid-stat-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
.xt-grid-bar { padding: 10px 12px; background: rgba(0,0,0,0.02); border-radius: var(--xt-radius-sm); }
.xt-grid-bar-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.xt-grid-bar-value { font-size: 14px; font-weight: 600; color: var(--xt-accent); margin-bottom: 6px; }
.xt-grid-badge { display: flex; align-items: center; justify-content: center; padding: 10px 6px; background: var(--xt-accent-bg); border-radius: var(--xt-radius-sm); font-size: 13px; font-weight: 600; color: var(--xt-accent); }

/* ── Bar ── */
.xt-bar { margin-bottom: 14px; }
.xt-bar-label { font-size: 10px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; display: flex; justify-content: space-between; }
.xt-bar-track { height: 4px; background: var(--xt-border); border-radius: 2px; overflow: hidden; }
.xt-bar-fill { height: 100%; background: var(--xt-accent); border-radius: 2px; transition: width 0.5s ease; }

/* ── Ring (圓環進度) ── */
.xt-ring { display: flex; flex-direction: column; align-items: center; margin-bottom: 14px; position: relative; }
.xt-ring-svg { width: 84px; height: 84px; transform: rotate(-90deg); }
.xt-ring-track { fill: none; stroke: var(--xt-border); stroke-width: 6; }
.xt-ring-fill { fill: none; stroke: var(--xt-accent); stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset 0.6s ease; }
.xt-ring-value { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 16px; font-weight: 700; color: var(--xt-accent); margin-top: -10px; }
.xt-ring-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; }

/* ── List ── */
.xt-list { margin-bottom: 14px; border-radius: var(--xt-radius-sm); overflow: hidden; }
.xt-list-item { padding: 10px 14px; display: flex; align-items: center; gap: 10px; border-bottom: 1px solid rgba(0,0,0,0.04); background: rgba(0,0,0,0.02); }
.xt-list-item:last-child { border-bottom: none; }
.xt-list-check { width: 14px; height: 14px; border: 1.5px solid var(--xt-border); border-radius: 3px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 9px; }
.xt-list-item-on .xt-list-check { background: var(--xt-accent); border-color: var(--xt-accent); color: #fff; }
.xt-list-text { flex: 1; font-size: 13px; }
.xt-list-item-on .xt-list-text { text-decoration: line-through; color: var(--xt-text-muted); }

/* ── Tags (標籤雲) ── */
.xt-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.xt-tag { padding: 4px 12px; border-radius: 20px; background: var(--xt-accent-bg); color: var(--xt-accent); font-size: 12px; font-weight: 500; }

/* ── Bubbles ── */
.xt-bubbles { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.xt-bubble { display: flex; gap: 8px; max-width: 80%; }
.xt-bubble-left { align-self: flex-start; }
.xt-bubble-right { align-self: flex-end; flex-direction: row-reverse; }
.xt-bubble-body { padding: 10px 14px; border-radius: 16px; font-size: 13px; line-height: 1.5; }
.xt-bubble-left .xt-bubble-body { background: rgba(0,0,0,0.04); border-top-left-radius: 4px; }
.xt-bubble-right .xt-bubble-body { background: var(--xt-accent); color: #fff; border-top-right-radius: 4px; }

/* ── Marquee (跑馬燈) ── */
.xt-marquee { overflow: hidden; margin-bottom: 14px; padding: 8px 0; }
.xt-marquee-inner { display: flex; gap: 60px; width: max-content; animation: xt-scroll 12s linear infinite; }
.xt-marquee-inner span { white-space: nowrap; font-size: 14px; color: var(--xt-text-sub); }

/* ── Divider ── */
.xt-divider { height: 1px; background: var(--xt-border); margin: 14px 0; }

/* ── Spacer ── */
.xt-spacer { flex-shrink: 0; }

/* ── Image ── */
.xt-image { width: 100%; border-radius: var(--xt-radius-sm); margin-bottom: 14px; }
.xt-image img { width: 100%; height: auto; border-radius: inherit; display: block; }

/* ── Footer ── */
.xt-footer { text-align: center; font-size: 10px; color: var(--xt-text-muted); letter-spacing: 1px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--xt-border); }

/* ── Gauge (半圓儀表盤) ── */
.xt-gauge { display: flex; flex-direction: column; align-items: center; margin-bottom: 14px; position: relative; }
.xt-gauge-svg { width: 120px; height: 67px; overflow: visible; }
.xt-gauge-track { stroke: var(--xt-border); stroke-width: 7; stroke-linecap: round; }
.xt-gauge-fill { stroke: var(--xt-accent); stroke-width: 7; stroke-linecap: round; transition: stroke-dashoffset 0.6s ease; }
.xt-gauge-value { position: absolute; top: 40px; left: 50%; transform: translateX(-50%); font-size: 18px; font-weight: 700; color: var(--xt-accent); }
.xt-gauge-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }

/* ── Sparkline (迷你趨勢圖) ── */
.xt-sparkline { margin-bottom: 14px; padding: 10px 14px; background: rgba(0,0,0,0.02); border-radius: var(--xt-radius-sm); }
.xt-sparkline-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.xt-sparkline-svg { width: 100%; height: 36px; display: block; }
.xt-sparkline-line { stroke: var(--xt-accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
.xt-sparkline-area { fill: var(--xt-accent-bg); stroke: none; }
.xt-sparkline-dot { fill: var(--xt-accent); }

/* ── Rating (星級) ── */
.xt-rating { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.xt-rating-stars { display: inline-flex; gap: 2px; }
.xt-rating-star { font-size: 18px; color: var(--xt-border); line-height: 1; }
.xt-rating-star-on { color: var(--xt-accent); }
.xt-rating-label { font-size: 11px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; }

/* ── Timeline (時間線) ── */
.xt-timeline { margin-bottom: 14px; padding-left: 6px; }
.xt-timeline-item { position: relative; padding: 0 0 14px 20px; border-left: 2px solid var(--xt-border); }
.xt-timeline-item:last-child { border-left-color: transparent; padding-bottom: 0; }
.xt-timeline-dot { position: absolute; left: -6px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--xt-accent); box-shadow: 0 0 0 3px var(--xt-accent-bg); }
.xt-timeline-title { font-size: 14px; font-weight: 600; color: var(--xt-text); line-height: 1.4; }
.xt-timeline-sub { font-size: 12px; color: var(--xt-text-sub); margin-top: 2px; line-height: 1.5; }

/* ── Table (表格) ── */
.xt-table { margin-bottom: 14px; border-radius: var(--xt-radius-sm); overflow: hidden; border: 1px solid var(--xt-border); }
.xt-table-row { display: flex; border-bottom: 1px solid var(--xt-border); }
.xt-table-row:last-child { border-bottom: none; }
.xt-table-cell { flex: 1; min-width: 0; padding: 9px 12px; font-size: 13px; color: var(--xt-text); border-right: 1px solid var(--xt-border); overflow-wrap: break-word; }
.xt-table-cell:last-child { border-right: none; }
.xt-table-row-head { background: var(--xt-accent-bg); }
.xt-table-row-head .xt-table-cell { font-weight: 600; color: var(--xt-accent); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }

/* ── KV (鍵值對) ── */
.xt-kv { margin-bottom: 14px; }
.xt-kv-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--xt-border); }
.xt-kv-row:last-child { border-bottom: none; }
.xt-kv-key { font-size: 12px; color: var(--xt-text-muted); flex-shrink: 0; }
.xt-kv-val { font-size: 14px; color: var(--xt-text); font-weight: 600; text-align: right; overflow-wrap: break-word; }

/* ── Row (水平佈局) ── */
.xt-row { display: flex; gap: 12px; margin-bottom: 14px; }
.xt-row > * { flex: 1; min-width: 0; }

/* ── Card (嵌套卡片) ── */
.xt-card { background: rgba(0,0,0,0.02); border: 1px solid var(--xt-border); border-radius: var(--xt-radius-sm); padding: 14px 16px; margin-bottom: 14px; }
.xt-card-title { font-size: 11px; font-weight: 600; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
.xt-card > *:last-child { margin-bottom: 0; }

/* ── Collapse (折疊) ── */
.xt-collapse { margin-bottom: 10px; border: 1px solid var(--xt-border); border-radius: var(--xt-radius-sm); overflow: hidden; }
.xt-collapse-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; background: rgba(0,0,0,0.02); font-size: 13px; font-weight: 600; color: var(--xt-text); user-select: none; }
.xt-collapse-arrow { font-size: 16px; color: var(--xt-text-muted); transition: transform 0.3s ease; display: inline-block; }
.xt-collapse-body { max-height: 0; overflow: hidden; transition: max-height 0.35s cubic-bezier(0.4,0,0.2,1), padding 0.35s ease; padding: 0 16px; }

/* Collapse toggle 展開（1-8） */
#xt-t1:checked ~ .xt-content .xt-collapse-1 .xt-collapse-body,
#xt-t2:checked ~ .xt-content .xt-collapse-2 .xt-collapse-body,
#xt-t3:checked ~ .xt-content .xt-collapse-3 .xt-collapse-body,
#xt-t4:checked ~ .xt-content .xt-collapse-4 .xt-collapse-body,
#xt-t5:checked ~ .xt-content .xt-collapse-5 .xt-collapse-body,
#xt-t6:checked ~ .xt-content .xt-collapse-6 .xt-collapse-body,
#xt-t7:checked ~ .xt-content .xt-collapse-7 .xt-collapse-body,
#xt-t8:checked ~ .xt-content .xt-collapse-8 .xt-collapse-body
{ max-height: 600px; padding: 12px 16px 16px; }

#xt-t1:checked ~ .xt-content .xt-collapse-1 .xt-collapse-arrow,
#xt-t2:checked ~ .xt-content .xt-collapse-2 .xt-collapse-arrow,
#xt-t3:checked ~ .xt-content .xt-collapse-3 .xt-collapse-arrow,
#xt-t4:checked ~ .xt-content .xt-collapse-4 .xt-collapse-arrow,
#xt-t5:checked ~ .xt-content .xt-collapse-5 .xt-collapse-arrow,
#xt-t6:checked ~ .xt-content .xt-collapse-6 .xt-collapse-arrow,
#xt-t7:checked ~ .xt-content .xt-collapse-7 .xt-collapse-arrow,
#xt-t8:checked ~ .xt-content .xt-collapse-8 .xt-collapse-arrow
{ transform: rotate(90deg); }

/* Toggle action labels (默認隱藏) */
.xt-action { display: none; cursor: pointer; }

/* ════════════════════════════════════ */
/* 動畫系統                              */
/* ════════════════════════════════════ */

/* ── @keyframes 入場 ── */
@keyframes xt-fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes xt-fadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes xt-fadeInDown { from { opacity: 0; transform: translateY(-14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes xt-slideInLeft { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: translateX(0); } }
@keyframes xt-slideInRight { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: translateX(0); } }
@keyframes xt-scaleIn { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); } }
@keyframes xt-blurIn { from { opacity: 0; filter: blur(10px); } to { opacity: 1; filter: blur(0); } }

/* ── @keyframes 持續 ── */
@keyframes xt-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes xt-glow { 0%,100% { box-shadow: 0 0 4px var(--xt-glow-color); } 50% { box-shadow: 0 0 18px var(--xt-glow-color); } }
@keyframes xt-breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.03); } }
@keyframes xt-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
@keyframes xt-shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }

/* ── @keyframes 跑馬燈 ── */
@keyframes xt-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }

/* ════════════════════════════════════ */
/* 粒子特效                              */
/* ════════════════════════════════════ */

.xt-particles { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; border-radius: inherit; }
.xt-particles ~ .xt-content { position: relative; z-index: 1; }
.xt-particle { position: absolute; opacity: 0; }

/* ── 雪花 ── */
@keyframes xt-snow-fall { 0% { transform: translateY(-10%) translateX(0) rotate(0); opacity: 0; } 10% { opacity: 0.8; } 90% { opacity: 0.6; } 100% { transform: translateY(110%) translateX(30px) rotate(360deg); opacity: 0; } }
.xt-particles-snow .xt-particle { width: 6px; height: 6px; background: white; border-radius: 50%; box-shadow: 0 0 4px rgba(255,255,255,0.6); animation: xt-snow-fall linear infinite; }

/* ── 雨滴 ── */
@keyframes xt-rain-fall { 0% { transform: translateY(-10%); opacity: 0; } 10% { opacity: 0.6; } 100% { transform: translateY(110%); opacity: 0; } }
.xt-particles-rain .xt-particle { width: 2px; height: 12px; background: linear-gradient(to bottom, transparent, rgba(150,200,255,0.6)); border-radius: 0 0 2px 2px; animation: xt-rain-fall linear infinite; }

/* ── 星星 ── */
@keyframes xt-star-twinkle { 0%, 100% { opacity: 0; transform: scale(0.5); } 50% { opacity: 1; transform: scale(1); } }
.xt-particles-stars .xt-particle { width: 3px; height: 3px; background: white; border-radius: 50%; box-shadow: 0 0 6px rgba(255,255,255,0.8); animation: xt-star-twinkle ease-in-out infinite; }

/* ── 愛心 ── */
@keyframes xt-heart-float { 0% { transform: translateY(100%) scale(0); opacity: 0; } 20% { opacity: 0.8; transform: translateY(60%) scale(1); } 100% { transform: translateY(-20%) scale(0.6); opacity: 0; } }
.xt-particles-hearts .xt-particle { font-size: 14px; animation: xt-heart-float ease-out infinite; }

/* ── 櫻花 ── */
@keyframes xt-sakura-fall { 0% { transform: translateY(-10%) translateX(0) rotate(0); opacity: 0; } 10% { opacity: 0.9; } 100% { transform: translateY(110%) translateX(40px) rotate(720deg); opacity: 0; } }
.xt-particles-sakura .xt-particle { font-size: 12px; animation: xt-sakura-fall linear infinite; }

/* ── 入場動畫 class ── */
.xt-anim-fadeIn { animation: xt-fadeIn var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-fadeInUp { animation: xt-fadeInUp var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-fadeInDown { animation: xt-fadeInDown var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-slideInLeft { animation: xt-slideInLeft var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-slideInRight { animation: xt-slideInRight var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-scaleIn { animation: xt-scaleIn var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-blurIn { animation: xt-blurIn var(--xt-anim-duration) ease both; }

/* ── 持續動畫 class ── */
.xt-anim-pulse { animation: xt-pulse 2s ease-in-out infinite; }
.xt-anim-glow { animation: xt-glow 2.5s ease-in-out infinite; }
.xt-anim-breathe { animation: xt-breathe 3s ease-in-out infinite; }
.xt-anim-float { animation: xt-float 3s ease-in-out infinite; }
.xt-anim-shimmer { background: linear-gradient(90deg, transparent 0%, var(--xt-accent-bg) 50%, transparent 100%); background-size: 200% 100%; animation: xt-shimmer 3s linear infinite; }

/* ── 延遲 ── */
.xt-anim-delay100 { animation-delay: 100ms; }
.xt-anim-delay200 { animation-delay: 200ms; }
.xt-anim-delay300 { animation-delay: 300ms; }
.xt-anim-delay400 { animation-delay: 400ms; }
.xt-anim-delay500 { animation-delay: 500ms; }
.xt-anim-delay600 { animation-delay: 600ms; }
.xt-anim-delay700 { animation-delay: 700ms; }
.xt-anim-delay800 { animation-delay: 800ms; }
.xt-anim-delay900 { animation-delay: 900ms; }
.xt-anim-delay1000 { animation-delay: 1000ms; }

/* ── 速度 ── */
.xt-anim-slow { animation-duration: 0.8s; }
.xt-anim-fast { animation-duration: 0.2s; }

/* ── Stagger（子元素依次入場）── */
.xt-anim-stagger > * { opacity: 0; animation: xt-fadeInUp var(--xt-anim-duration) var(--xt-anim-easing) both; }
.xt-anim-stagger > *:nth-child(1) { animation-delay: calc(var(--xt-stagger-delay) * 0); }
.xt-anim-stagger > *:nth-child(2) { animation-delay: calc(var(--xt-stagger-delay) * 1); }
.xt-anim-stagger > *:nth-child(3) { animation-delay: calc(var(--xt-stagger-delay) * 2); }
.xt-anim-stagger > *:nth-child(4) { animation-delay: calc(var(--xt-stagger-delay) * 3); }
.xt-anim-stagger > *:nth-child(5) { animation-delay: calc(var(--xt-stagger-delay) * 4); }
.xt-anim-stagger > *:nth-child(6) { animation-delay: calc(var(--xt-stagger-delay) * 5); }
.xt-anim-stagger > *:nth-child(7) { animation-delay: calc(var(--xt-stagger-delay) * 6); }
.xt-anim-stagger > *:nth-child(8) { animation-delay: calc(var(--xt-stagger-delay) * 7); }
.xt-anim-stagger > *:nth-child(9) { animation-delay: calc(var(--xt-stagger-delay) * 8); }
.xt-anim-stagger > *:nth-child(10) { animation-delay: calc(var(--xt-stagger-delay) * 9); }
.xt-anim-stagger > *:nth-child(11) { animation-delay: calc(var(--xt-stagger-delay) * 10); }
.xt-anim-stagger > *:nth-child(12) { animation-delay: calc(var(--xt-stagger-delay) * 11); }

/* ════════════════════════════════════ */
/* 背景層（@bg）                          */
/* ════════════════════════════════════ */

.xt-bg { position: absolute; inset: 0; background-size: cover; background-position: center; border-radius: inherit; pointer-events: none; z-index: 0; }
.xt-bg-blur { filter: blur(6px); transform: scale(1.06); }
.xt-bg-dim::after { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,0.45); border-radius: inherit; }
.xt-bg-contain { background-size: contain; background-repeat: no-repeat; }
.xt-bg-tile { background-size: 120px auto; background-repeat: repeat; }
.xt-bg ~ .xt-content, .xt-bg ~ .xt-particles ~ .xt-content { position: relative; z-index: 1; }

/* ════════════════════════════════════ */
/* 水位波浪（@wave）                      */
/* ════════════════════════════════════ */

.xt-wave { display: flex; flex-direction: column; align-items: center; margin-bottom: 14px; }
.xt-wave-body { position: relative; width: 92px; height: 92px; border-radius: 50%; overflow: hidden; background: var(--xt-accent-bg); border: 2px solid var(--xt-border); }
.xt-wave-fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--xt-accent); opacity: 0.85; transition: height 0.6s ease; }
/* 波面：兩塊圓角方塊繞自身中心緩慢旋轉，中心略高於水面 → 起伏的水波 */
.xt-wave-surface { position: absolute; left: 50%; top: -6px; width: 180px; height: 180px; margin-left: -90px; background: var(--xt-accent); border-radius: 43%; animation: xt-wave-spin 7s linear infinite; }
.xt-wave-surface2 { top: -3px; opacity: 0.5; border-radius: 47%; animation-duration: 11s; animation-direction: reverse; }
.xt-wave-value { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 700; color: var(--xt-text); text-shadow: 0 1px 3px rgba(255,255,255,0.45); }
.xt-wave-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 6px; }
@keyframes xt-wave-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ════════════════════════════════════ */
/* 雙向對比條（@compare）                  */
/* ════════════════════════════════════ */

.xt-compare { margin-bottom: 14px; }
.xt-compare-labels { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.xt-compare-label { display: inline-flex; align-items: baseline; gap: 5px; font-size: 12px; }
.xt-compare-name { font-style: normal; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; font-size: 9px; }
.xt-compare-num { font-size: 14px; font-weight: 700; color: var(--xt-accent); }
.xt-compare-label-b .xt-compare-num { color: var(--xt-text-sub); }
.xt-compare-track { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: var(--xt-border); }
.xt-compare-a { background: var(--xt-accent); transition: width 0.6s ease; }
.xt-compare-b { background: var(--xt-text-muted); opacity: 0.45; transition: width 0.6s ease; }

/* ════════════════════════════════════ */
/* 熱力格（@heatmap）                      */
/* ════════════════════════════════════ */

.xt-heatmap { margin-bottom: 14px; }
.xt-heatmap-label { font-size: 9px; color: var(--xt-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
.xt-heatmap-grid { display: grid; gap: 3px; justify-content: start; }
/* 格子大小：預設 18px 方格，想撐滿寬度就把 --xt-heatmap-cell 設成 1fr */
.xt-heatmap-cell { aspect-ratio: 1 / 1; border-radius: 3px; background: var(--xt-border); }
.xt-heatmap-lv0 { background: var(--xt-border); opacity: 0.45; }
.xt-heatmap-lv1 { background: var(--xt-accent); opacity: 0.28; }
.xt-heatmap-lv2 { background: var(--xt-accent); opacity: 0.5; }
.xt-heatmap-lv3 { background: var(--xt-accent); opacity: 0.75; }
.xt-heatmap-lv4 { background: var(--xt-accent); opacity: 1; }

/* ════════════════════════════════════ */
/* 打字機 / 數字滾動                       */
/* ════════════════════════════════════ */

.xt-typing-on::after { content: "|"; margin-left: 1px; animation: xt-caret 0.8s step-end infinite; color: var(--xt-accent); }
@keyframes xt-caret { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
.xt-num { font-variant-numeric: tabular-nums; }

/* ── 翻牌入場 ── */
@keyframes xt-flipIn { from { opacity: 0; transform: perspective(600px) rotateX(-75deg); } to { opacity: 1; transform: perspective(600px) rotateX(0); } }
.xt-anim-flipIn { animation: xt-flipIn var(--xt-anim-duration) var(--xt-anim-easing) both; transform-origin: top center; }

/* ════════════════════════════════════ */
/* 粒子特效（新增）                        */
/* ════════════════════════════════════ */

/* ── 氣泡 ── */
@keyframes xt-bubble-rise { 0% { transform: translateY(110%) scale(0.6); opacity: 0; } 15% { opacity: 0.55; } 100% { transform: translateY(-15%) scale(1.1); opacity: 0; } }
.xt-particles-bubble .xt-particle { width: 10px; height: 10px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.75); background: rgba(255,255,255,0.12); animation: xt-bubble-rise linear infinite; }

/* ── 螢火蟲 ── */
@keyframes xt-firefly-drift { 0% { transform: translate(0, 0) scale(0.7); opacity: 0; } 25% { opacity: 1; } 50% { transform: translate(18px, -40px) scale(1); opacity: 0.6; } 75% { opacity: 1; } 100% { transform: translate(-12px, -85px) scale(0.7); opacity: 0; } }
.xt-particles-firefly .xt-particle { width: 4px; height: 4px; border-radius: 50%; background: #ffe27a; box-shadow: 0 0 8px 2px rgba(255,226,122,0.7); top: 70%; animation: xt-firefly-drift ease-in-out infinite; }

/* ── 落葉 ── */
@keyframes xt-leaf-fall { 0% { transform: translateY(-10%) translateX(0) rotate(0); opacity: 0; } 12% { opacity: 0.9; } 100% { transform: translateY(110%) translateX(-46px) rotate(540deg); opacity: 0; } }
.xt-particles-leaves .xt-particle { font-size: 13px; animation: xt-leaf-fall linear infinite; }

/* ── 數字雨 ── */
@keyframes xt-matrix-fall { 0% { transform: translateY(-20%); opacity: 0; } 10% { opacity: 0.85; } 90% { opacity: 0.3; } 100% { transform: translateY(120%); opacity: 0; } }
.xt-particles-matrix .xt-particle { font-family: "Courier New", monospace; font-size: 13px; font-weight: 700; color: #4ade80; text-shadow: 0 0 6px rgba(74,222,128,0.7); animation: xt-matrix-fall linear infinite; }

/* ── 自訂字元 ── */
@keyframes xt-emoji-float { 0% { transform: translateY(110%) scale(0.7) rotate(0); opacity: 0; } 18% { opacity: 0.95; } 100% { transform: translateY(-20%) scale(1) rotate(180deg); opacity: 0; } }
.xt-particles-emoji .xt-particle { font-size: 14px; animation: xt-emoji-float linear infinite; }

`;
