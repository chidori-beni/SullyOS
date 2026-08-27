// 心声「布局模板」渲染器。
//
// ⚠️ DOM 契约文件。类名、层级、属性顺序都和糯叽机 4.64 一致，因为论坛上的心声美化
// 全靠这套选择器活着（`.xt-content`、`.xt-collapse-N`、`.xt-text-{字段名}`、
// `#xt-t1:checked ~ .xt-content ...` 这类兄弟选择器对**结构**敏感，
// 少一层 div、把 checkbox 挪进 .xt-content 里，别人的美化立刻全塌）。
//
// 结构必须是（顺序不能换）：
//   <style>默认CSS</style>
//   <style>用户自定义CSS</style>
//   <div class="xt-root {值状态类}" style="{--xt-f-* 数值变量}">
//     <input id="xt-t1..8" class="xt-toggle xt-tN">   ← 8 个，必须是 .xt-content 的前置兄弟
//     {@bg 节点}
//     {@particles 节点}
//     <div class="xt-content">{其余全部节点}</div>
//   </div>
//
// 语法解析在 utils/xinsheng/xinshengLayout.ts。

import React, { useEffect, useMemo, useState } from 'react';
import {
    parseLayout,
    type XinshengChild,
    type XinshengCell,
    type XinshengCond,
    type XinshengNode,
} from '../../../utils/xinsheng/xinshengLayout';
import { XINSHENG_DEFAULT_CSS } from '../../../utils/xinsheng/xinshengDefaultCss';

/** 渲染器只认这两个字段，Sully 的 CharacterProfile 由调用方映射进来。 */
export interface XinshengRendererCharacter {
    name?: string;
    image?: string;
}

/** 同上：`userName` / `userImage` 两个内建字段的来源。 */
export interface XinshengRendererUser {
    name?: string;
    nickname?: string;
    avatar?: string;
}

export interface XinshengLayoutRendererProps {
    /** @指令 布局文本 */
    layout: string;
    /** 本轮 AI 吐的心声字段 */
    data: Record<string, any> | null | undefined;
    character: XinshengRendererCharacter | null | undefined;
    /** 用户自定义 CSS，原样注入（作用域靠 .xt-root 前缀，与糯叽机一致） */
    customCss?: string;
    userInfo?: XinshengRendererUser | null;
    /** 系统变量（currentDate / bondDays / todoProgress …）。AI 输出同名字段时以 AI 为准。 */
    systemData?: Record<string, any> | null;
}

// ─── 小工具 ───

/** @list 的 `{字段}Done` 判定：这几个词都算「已完成」。 */
const isDone = (v: any): boolean =>
    ['true', 'checked', 'completed', 'done', 'yes'].includes(String(v).toLowerCase());

const hasAnim = (anims: string[] | undefined, name: string): boolean =>
    Array.isArray(anims) && anims.includes(name);

/** 值 → CSS 类名片段（`有点难过` 这种非 ASCII 会被清成空串，那就不生成类）。 */
const slugify = (v: any): string =>
    String(v)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);

/** 只有合法标识符才配拿到 CSS 变量/类名，挡住带引号、中文、点号的键。 */
const isSafeKey = (k: string): boolean => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(k);

/** `.countUp`：把数字从 0 缓动到目标值，保留原字符串的小数位数。 */
const CountUp: React.FC<{ value: any; duration?: number }> = ({ value, duration = 900 }) => {
    const text = String(value ?? '');
    const target = Number(text.replace(/[^0-9.-]/g, ''));
    const decimals = (text.split('.')[1] || '').replace(/[^0-9]/g, '').length;
    const [shown, setShown] = useState(0);

    useEffect(() => {
        if (!Number.isFinite(target)) return;
        let raf: number | null = null;
        let start: number | null = null;
        const step = (ts: number) => {
            if (start == null) start = ts;
            const p = Math.min(1, (ts - start) / duration);
            setShown(target * (1 - Math.pow(1 - p, 3)));
            if (p < 1) raf = requestAnimationFrame(step);
            else setShown(target);
        };
        raf = requestAnimationFrame(step);
        return () => { if (raf) cancelAnimationFrame(raf); };
    }, [target, duration]);

    // 不是数字（或空串）就原样显示，不要把「有点难过」渲染成 NaN
    if (!Number.isFinite(target) || !text.trim()) return <>{text}</>;
    return <span className="xt-num">{shown.toFixed(decimals)}</span>;
};

/** `.typewriter`：逐字出字。按码点切，emoji 不会被劈成两半。 */
const Typewriter: React.FC<{ text: any; speed?: number }> = ({ text, speed = 28 }) => {
    const chars = useMemo(() => Array.from(String(text ?? '')), [text]);
    const [n, setN] = useState(0);

    useEffect(() => {
        setN(0);
        if (chars.length === 0) return;
        let i = 0;
        const timer = setInterval(() => {
            i += 1;
            setN(i);
            if (i >= chars.length) clearInterval(timer);
        }, speed);
        return () => clearInterval(timer);
    }, [chars, speed]);

    return (
        <span className={'xt-typing' + (n < chars.length ? ' xt-typing-on' : '')}>
            {chars.slice(0, n).join('')}
        </span>
    );
};

/** 按动画修饰符决定值怎么出场。两个都没有就直接返回原值。 */
const decorate = (anims: string[] | undefined, value: any): React.ReactNode => {
    if (hasAnim(anims, 'typewriter')) return <Typewriter text={value} />;
    if (hasAnim(anims, 'countUp')) return <CountUp value={value} />;
    return value;
};

/**
 * @bg 的 url()：只放行 http(s)/data:image/blob，其余一律不渲染。
 *
 * 转义比糯叽机严一点。原版是 `replace(/["'()\\\s]/g, encodeURIComponent)`，但
 * `encodeURIComponent` 按 RFC 3986 **不转义** `'()!*` —— 也就是说原版想挡的括号
 * 其实一个都没挡住，`;{}` 更是压根不在名单里。这里改成显式百分号编码表，
 * 把能闭合 `url(…)` 或另起一条 CSS 声明的字符全部编掉。
 *
 * （实际浏览器路径上 React 是通过 CSSOM 赋值的，非法值会被整条拒绝而不是注入；
 * 但这一层不该依赖下游怎么写，何况 `\` 在 data: URL 里被吞掉本来也是错的。）
 */
const CSS_URL_ESCAPES: Record<string, string> = {
    '"': '%22', "'": '%27', '(': '%28', ')': '%29', '\\': '%5C',
    ';': '%3B', '{': '%7B', '}': '%7D',
};
const safeBackgroundUrl = (raw: any): string => {
    const t = String(raw || '').trim();
    if (!/^(https?:\/\/|data:image\/|blob:)/i.test(t)) return '';
    return t.replace(/["'()\\;{}\s]/g, c => CSS_URL_ESCAPES[c] ?? encodeURIComponent(c));
};

/** 把 `[1,2,3]` / `1,2 3` / 真数组统一成 number[]。@heatmap / @sparkline 用。 */
const toNumberArray = (input: any): number[] => {
    let v = input;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t.startsWith('[')) {
            try { v = JSON.parse(t); } catch { v = t.split(/[,\s]+/); }
        } else {
            v = t.split(/[,\s]+/);
        }
    }
    return Array.isArray(v) ? v.map(Number).filter(n => Number.isFinite(n)) : [];
};

/** @particles 各效果的字符内容（空串 = 靠 CSS 画形状，不是漏了）。 */
const PARTICLE_CHARS: Record<string, string> = {
    snow: '', rain: '', stars: '', hearts: '❤', sakura: '🌸',
    bubble: '', firefly: '', leaves: '🍂', matrix: '',
};
const MATRIX_CHARS = '01アイウエオカキクケサシスセソナニヌネハヒフヘ';

export const XinshengLayoutRenderer: React.FC<XinshengLayoutRendererProps> = ({
    layout,
    data,
    character,
    customCss,
    userInfo,
    systemData,
}) => {
    const nodes = useMemo(() => parseLayout(layout), [layout]);
    // AI 输出覆盖系统变量：同名字段以 data 为准（教程里明确承诺过的优先级）
    const merged = useMemo(() => ({ ...(systemData || {}), ...(data || {}) }), [systemData, data]);

    // hooks 必须无条件调用，空布局的早退放在 hooks 之后
    const isEmpty = !nodes || nodes.length === 0;

    /** 取原始值（不 String 化）——@each / @heatmap / @sparkline 需要数组本体。 */
    const rawValue = (field: string | undefined, item: any): any => {
        if (item != null && field) {
            if (field === 'item' || field === '.' || field === 'this') return item;
            if (field.startsWith('item.')) return item?.[field.slice(5)];
        }
        return field ? (merged as any)?.[field] : undefined;
    };

    /** 取字符串值。内建字段（charName/charImage/userName/userImage）在这里兜底。 */
    const strValue = (field: string | undefined, item: any): string => {
        if (item != null && field) {
            if (field === 'item' || field === '.' || field === 'this') {
                return item != null && typeof item !== 'object' ? String(item) : '';
            }
            if (field.startsWith('item.')) {
                const v = item?.[field.slice(5)];
                return v != null ? String(v) : '';
            }
        }
        if (!field) return '';
        if (field === 'charName') return character?.name || '';
        if (field === 'charImage') return character?.image || '';
        if (field === 'userName') return userInfo?.name || userInfo?.nickname || '';
        if (field === 'userImage') return userInfo?.avatar || '';
        const v = (merged as any)?.[field];
        return v != null ? String(v) : '';
    };

    const renderNode = (node: XinshengNode, key: React.Key, item: any = null): React.ReactNode => {
        const anim = node.anims && node.anims.length > 0
            ? node.anims.map(a => `xt-anim-${a}`).join(' ')
            : '';
        const val = (field: string | undefined) => strValue(field, item);

        switch (node.type) {
            case 'header':
                return (
                    <div className={`xt-header ${anim}`} key={key}>
                        <div className="xt-avatar-wrap">
                            {val(node.imageField) && (
                                <img className="xt-avatar" src={val(node.imageField)} alt="" />
                            )}
                        </div>
                        <div className="xt-header-info">
                            <div className="xt-name">{val(node.nameField)}</div>
                            <div className="xt-header-sub" />
                        </div>
                        <div className="xt-header-badge" />
                    </div>
                );

            case 'duo':
                return (
                    <div className={`xt-duo ${anim}`} key={key}>
                        <div className="xt-duo-person">
                            {val(node.image1) && <img className="xt-duo-avatar" src={val(node.image1)} alt="" />}
                            <span className="xt-duo-name">{val(node.name1)}</span>
                        </div>
                        <span className="xt-duo-heart">💕</span>
                        <div className="xt-duo-person">
                            {val(node.image2) && <img className="xt-duo-avatar" src={val(node.image2)} alt="" />}
                            <span className="xt-duo-name">{val(node.name2)}</span>
                        </div>
                    </div>
                );

            case 'badge':
                return (
                    <div className={`xt-badge ${anim}`} key={key}>
                        <span className="xt-badge-value">{decorate(node.anims, val(node.field))}</span>
                        {node.suffix && <span className="xt-badge-suffix">{node.suffix}</span>}
                    </div>
                );

            case 'section':
                return (
                    <div className={`xt-section xt-section-${key} ${anim}`} key={key}>
                        {node.title && <div className="xt-section-title">{node.title}</div>}
                        {((node.children || []) as XinshengChild[]).map((c, i) => (
                            <div className="xt-section-body" key={i}>{decorate(node.anims, val(c.field))}</div>
                        ))}
                    </div>
                );

            case 'text':
                return (
                    <div className={`xt-text xt-text-${node.field} ${anim}`} key={key}>
                        <span className="xt-text-content">{decorate(node.anims, val(node.field))}</span>
                    </div>
                );

            case 'quote':
                return <div className={`xt-quote ${anim}`} key={key}>{decorate(node.anims, val(node.field))}</div>;

            case 'grid':
                return (
                    <div className={`xt-grid xt-grid-${node.columns} ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((c, i) => {
                            const v = val(c.field);
                            if (c.subtype === 'bar') {
                                const pct = Math.max(0, Math.min(100, Number(v) || 0));
                                return (
                                    <div className={`xt-grid-bar xt-grid-item-${c.field}`} key={i}>
                                        {c.label && <div className="xt-grid-bar-label">{c.label}</div>}
                                        <div className="xt-grid-bar-value">{v}</div>
                                        <div className="xt-bar-track">
                                            <div className="xt-bar-fill" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                );
                            }
                            if (c.subtype === 'badge') {
                                return (
                                    <div className={`xt-grid-badge xt-grid-item-${c.field}`} key={i}>
                                        {v}
                                        {c.label && (
                                            <span style={{ fontSize: '9px', marginLeft: '4px', opacity: 0.6 }}>{c.label}</span>
                                        )}
                                    </div>
                                );
                            }
                            return (
                                <div className={`xt-grid-stat xt-grid-item-${c.field}`} key={i}>
                                    <div className="xt-grid-stat-value">{decorate(node.anims, v)}</div>
                                    {c.label && <div className="xt-grid-stat-label">{c.label}</div>}
                                </div>
                            );
                        })}
                    </div>
                );

            case 'bar': {
                const v = val(node.field);
                const pct = Math.max(0, Math.min(100, Number(v) || 0));
                return (
                    <div className={`xt-bar xt-bar-${node.field} ${anim}`} key={key}>
                        <div className="xt-bar-label">
                            <span>{node.label || node.field}</span>
                            <span>{v}</span>
                        </div>
                        <div className="xt-bar-track">
                            <div className="xt-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                );
            }

            case 'ring': {
                const v = val(node.field);
                const pct = Math.max(0, Math.min(100, Number(v) || 0));
                const r = 36;
                const circ = 2 * Math.PI * r;
                return (
                    <div className={`xt-ring ${anim}`} key={key}>
                        <svg viewBox="0 0 84 84" className="xt-ring-svg">
                            <circle cx="42" cy="42" r={r} className="xt-ring-track" />
                            <circle
                                cx="42" cy="42" r={r} className="xt-ring-fill"
                                strokeDasharray={circ}
                                strokeDashoffset={circ * (1 - pct / 100)}
                            />
                        </svg>
                        <div className="xt-ring-value">{decorate(node.anims, v || pct)}</div>
                        {node.label && <div className="xt-ring-label">{node.label}</div>}
                    </div>
                );
            }

            case 'list':
                return (
                    <div className={`xt-list ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((c, i) => {
                            const v = val(c.field);
                            // 两种写法都支持：额外的 `{字段}Done` 布尔，或字段值本身就是 done/true
                            const done = isDone((data as any)?.[`${c.field}Done`]) || isDone(v);
                            const text = done && isDone(v) ? c.field : v;
                            return (
                                <div className={`xt-list-item xt-list-item-${c.field}${done ? ' xt-list-item-on' : ''}`} key={i}>
                                    <span className="xt-list-check">{done ? '✓' : ''}</span>
                                    <span className="xt-list-text">{text || c.field}</span>
                                </div>
                            );
                        })}
                    </div>
                );

            case 'tags':
                return (
                    <div className={`xt-tags ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((c, i) => (
                            <span className={'xt-tag ' + (c.field ? `xt-tag-${c.field}` : '')} key={i}>
                                {c.literal || val(c.field)}
                            </span>
                        ))}
                    </div>
                );

            case 'bubbles':
                return (
                    <div className={`xt-bubbles ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((c, i) => (
                            <div className={`xt-bubble xt-bubble-${c.side} xt-bubble-${c.field}`} key={i}>
                                <div className="xt-bubble-body">{val(c.field)}</div>
                            </div>
                        ))}
                    </div>
                );

            case 'marquee': {
                const v = val(node.field);
                return (
                    <div className={`xt-marquee ${anim}`} key={key}>
                        {/* 两份内容首尾相接，配合 translateX(-50%) 做无缝循环 */}
                        <div className="xt-marquee-inner"><span>{v}</span><span>{v}</span></div>
                    </div>
                );
            }

            case 'divider':
                return <div className={`xt-divider ${anim}`} key={key} />;

            case 'spacer':
                return <div className={`xt-spacer ${anim}`} style={{ height: `${node.height}px` }} key={key} />;

            case 'image': {
                const v = val(node.field);
                if (!v) return null;
                return (
                    <div className={`xt-image xt-image-${node.field} ${anim}`} key={key}>
                        <img src={v} alt="" />
                    </div>
                );
            }

            case 'footer':
                return <div className={`xt-footer ${anim}`} key={key}>{node.text}</div>;

            case 'particles': {
                const ch = node.effect === 'emoji' ? (node.char || '✦') : (PARTICLE_CHARS[node.effect || ''] || '');
                return (
                    <div className={`xt-particles xt-particles-${node.effect}`} key={key}>
                        {Array.from({ length: node.count || 0 }, (_, i) => {
                            // 伪随机但确定：同一份布局每次渲染粒子位置一致，不会每轮重排闪一下
                            const left = (37 * i + 13) % 100;
                            const delay = ((53 * i + 7) % 100) / 10;
                            const dur = 3 + ((29 * i + 3) % 50) / 10;
                            const size = node.effect === 'snow' ? 3 + (i % 5) : undefined;
                            return (
                                <span
                                    className="xt-particle"
                                    key={i}
                                    style={{
                                        left: `${left}%`,
                                        animationDelay: `${delay}s`,
                                        animationDuration: `${dur}s`,
                                        ...(size ? { width: `${size}px`, height: `${size}px` } : {}),
                                    }}
                                >
                                    {node.effect === 'matrix' ? MATRIX_CHARS[(7 * i + 3) % MATRIX_CHARS.length] : ch}
                                </span>
                            );
                        })}
                    </div>
                );
            }

            case 'toggle':
                // label[for] 指向前面那 8 个 checkbox —— checkbox hack 的按钮端
                return <label htmlFor={`xt-t${node.index}`} className={`xt-action xt-action-${node.index} ${anim}`} key={key} />;

            case 'bg': {
                const url = safeBackgroundUrl(val(node.field));
                if (!url) return null;
                return (
                    <div
                        className={`xt-bg${node.mode ? ` xt-bg-${node.mode}` : ''} ${anim}`}
                        style={{ backgroundImage: `url("${url}")` }}
                        key={key}
                    />
                );
            }

            case 'wave': {
                const v = val(node.field);
                const pct = Math.max(0, Math.min(100, Number(v) || 0));
                return (
                    <div className={`xt-wave xt-wave-${node.field} ${anim}`} key={key}>
                        <div className="xt-wave-body">
                            <div className="xt-wave-fill" style={{ height: `${pct}%` }}>
                                <span className="xt-wave-surface" />
                                <span className="xt-wave-surface xt-wave-surface2" />
                            </div>
                            <div className="xt-wave-value">{decorate(node.anims, v || pct)}</div>
                        </div>
                        {node.label && <div className="xt-wave-label">{node.label}</div>}
                    </div>
                );
            }

            case 'compare': {
                const va = val(node.fieldA);
                const vb = val(node.fieldB);
                const a = Math.max(0, Number(va) || 0);
                const b = Math.max(0, Number(vb) || 0);
                const total = a + b;
                // 两边都是 0 时对半分，不要出现 NaN% 宽度
                const pctA = total > 0 ? (a / total) * 100 : 50;
                return (
                    <div className={`xt-compare xt-compare-${node.fieldA} ${anim}`} key={key}>
                        <div className="xt-compare-labels">
                            <span className="xt-compare-label xt-compare-label-a">
                                {node.labelA && <em className="xt-compare-name">{node.labelA}</em>}
                                <b className="xt-compare-num">{va || a}</b>
                            </span>
                            <span className="xt-compare-label xt-compare-label-b">
                                <b className="xt-compare-num">{vb || b}</b>
                                {node.labelB && <em className="xt-compare-name">{node.labelB}</em>}
                            </span>
                        </div>
                        <div className="xt-compare-track">
                            <div className="xt-compare-a" style={{ width: `${pctA}%` }} />
                            <div className="xt-compare-b" style={{ width: `${100 - pctA}%` }} />
                        </div>
                    </div>
                );
            }

            case 'heatmap': {
                const nums = toNumberArray(rawValue(node.field, item) ?? val(node.field)).slice(0, 84);
                if (nums.length === 0) return null;
                const max = Math.max(...nums, 1);
                return (
                    <div className={`xt-heatmap xt-heatmap-${node.field} ${anim}`} key={key}>
                        {node.label && <div className="xt-heatmap-label">{node.label}</div>}
                        <div
                            className="xt-heatmap-grid"
                            style={{ gridTemplateColumns: `repeat(${node.columns}, minmax(0, var(--xt-heatmap-cell, 18px)))` }}
                        >
                            {nums.map((n, i) => {
                                const lv = n <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((n / max) * 4)));
                                return <span className={`xt-heatmap-cell xt-heatmap-lv${lv}`} key={i} />;
                            })}
                        </div>
                    </div>
                );
            }

            case 'gauge': {
                const v = val(node.field);
                const pct = Math.max(0, Math.min(100, Number(v) || 0));
                // 半圆弧长 = π × r（r=40，与 path 的 A 42 42 略有出入是原版行为，保持一致）
                const len = Math.PI * 40;
                return (
                    <div className={`xt-gauge xt-gauge-${node.field} ${anim}`} key={key}>
                        <svg viewBox="0 0 100 56" className="xt-gauge-svg">
                            <path className="xt-gauge-track" d="M 8 50 A 42 42 0 0 1 92 50" fill="none" />
                            <path
                                className="xt-gauge-fill"
                                d="M 8 50 A 42 42 0 0 1 92 50"
                                fill="none"
                                strokeDasharray={len}
                                strokeDashoffset={len * (1 - pct / 100)}
                            />
                        </svg>
                        <div className="xt-gauge-value">{decorate(node.anims, v || pct)}</div>
                        {node.label && <div className="xt-gauge-label">{node.label}</div>}
                    </div>
                );
            }

            case 'sparkline': {
                const raw = rawValue(node.field, item);
                let nums: number[] = [];
                if (Array.isArray(raw)) nums = raw.map(Number).filter(n => !isNaN(n));
                else if (raw != null) nums = String(raw).split(/[,\s]+/).map(Number).filter(n => !isNaN(n));
                if (nums.length < 2) return null;
                const min = Math.min(...nums);
                const span = Math.max(...nums) - min || 1;
                const W = 100;
                const H = 28;
                const pts = nums.map((n, i) => {
                    const x = (i / (nums.length - 1)) * W;
                    const y = H - ((n - min) / span) * (H - 4) - 2;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                });
                const lastY = H - ((nums[nums.length - 1] - min) / span) * (H - 4) - 2;
                return (
                    <div className={`xt-sparkline xt-sparkline-${node.field} ${anim}`} key={key}>
                        {node.label && <div className="xt-sparkline-label">{node.label}</div>}
                        <svg viewBox={`0 0 ${W} ${H}`} className="xt-sparkline-svg" preserveAspectRatio="none">
                            <polyline className="xt-sparkline-area" points={`0,${H} ${pts.join(' ')} ${W},${H}`} />
                            <polyline className="xt-sparkline-line" points={pts.join(' ')} fill="none" />
                            <circle className="xt-sparkline-dot" cx={W} cy={lastY} r="2" />
                        </svg>
                    </div>
                );
            }

            case 'rating': {
                const v = Number(val(node.field)) || 0;
                const max = node.max || 5;
                const on = Math.round(Math.max(0, Math.min(max, v)));
                return (
                    <div className={`xt-rating xt-rating-${node.field} ${anim}`} key={key}>
                        <div className="xt-rating-stars">
                            {Array.from({ length: max }, (_, i) => (
                                <span className={'xt-rating-star' + (i < on ? ' xt-rating-star-on' : '')} key={i}>★</span>
                            ))}
                        </div>
                        {node.label && <span className="xt-rating-label">{node.label}</span>}
                    </div>
                );
            }

            case 'timeline': {
                const cellText = (c: XinshengCell | undefined) =>
                    c ? (c.literal != null ? c.literal : val(c.field)) : '';
                return (
                    <div className={`xt-timeline ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((row, i) => {
                            const segs = row.segs || [];
                            return (
                                <div className="xt-timeline-item" key={i}>
                                    <span className="xt-timeline-dot" />
                                    <div className="xt-timeline-content">
                                        <div className="xt-timeline-title">{cellText(segs[0])}</div>
                                        {segs.slice(1).map((s, j) => (
                                            <div className="xt-timeline-sub" key={j}>{cellText(s)}</div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            }

            case 'table':
                return (
                    <div className={`xt-table ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((row, i) => (
                            <div className={'xt-table-row' + (i === 0 ? ' xt-table-row-head' : '')} key={i}>
                                {(row.cells || []).map((c, j) => (
                                    <span className="xt-table-cell" key={j}>
                                        {c.literal != null ? c.literal : val(c.field)}
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                );

            case 'kv':
                return (
                    <div className={`xt-kv ${anim}`} key={key}>
                        {((node.children || []) as XinshengChild[]).map((c, i) => (
                            <div className={`xt-kv-row xt-kv-${c.field}`} key={i}>
                                <span className="xt-kv-key">{c.key}</span>
                                <span className="xt-kv-val">{val(c.field)}</span>
                            </div>
                        ))}
                    </div>
                );

            case 'row':
                return (
                    <div className={`xt-row ${anim}`} key={key}>
                        {((node.children || []) as XinshengNode[]).map((c, i) => renderNode(c, `${key}-${i}`, item))}
                    </div>
                );

            case 'card':
                return (
                    <div className={`xt-card ${anim}`} key={key}>
                        {node.title && <div className="xt-card-title">{node.title}</div>}
                        {((node.children || []) as XinshengNode[]).map((c, i) => renderNode(c, `${key}-${i}`, item))}
                    </div>
                );

            case 'collapse':
                return (
                    <div className={`xt-collapse xt-collapse-${node.toggleIndex} ${anim}`} key={key}>
                        <label htmlFor={`xt-t${node.toggleIndex}`} className="xt-collapse-header">
                            <span>{node.title}</span>
                            <span className="xt-collapse-arrow">›</span>
                        </label>
                        <div className="xt-collapse-body">
                            {((node.children || []) as XinshengNode[]).map((c, i) => renderNode(c, `${key}-${i}`, item))}
                        </div>
                    </div>
                );

            case 'each': {
                let arr = rawValue(node.field, item);
                if (arr == null) return null;
                if (typeof arr === 'string') {
                    const t = arr.trim();
                    if (t.startsWith('[')) { try { arr = JSON.parse(t); } catch { /* 不是合法 JSON 就当它不是数组 */ } }
                }
                if (!Array.isArray(arr)) return null;
                return (
                    <React.Fragment key={key}>
                        {arr.slice(0, 50).map((it, i) => (
                            <React.Fragment key={i}>
                                {((node.children || []) as XinshengNode[]).map((c, j) => renderNode(c, `${key}-${i}-${j}`, it))}
                            </React.Fragment>
                        ))}
                    </React.Fragment>
                );
            }

            case 'conditional': {
                const test = (c: XinshengCond): boolean => {
                    const left = val(c.field);
                    const right = c.value;
                    switch ((c.op || '').toLowerCase()) {
                        case '>': return Number(left) > Number(right);
                        case '<': return Number(left) < Number(right);
                        case '>=': return Number(left) >= Number(right);
                        case '<=': return Number(left) <= Number(right);
                        case '=':
                        case '==': return left === right;
                        case '!=': return left !== right;
                        case 'contains': return String(left).includes(right);
                        case 'between': {
                            const n = Number(left);
                            const lo = Number(right);
                            const hi = Number(c.value2);
                            return Number.isFinite(n) && n >= Math.min(lo, hi) && n <= Math.max(lo, hi);
                        }
                        // 省略运算符 = 判断字段是否有值
                        default: return !!left;
                    }
                };
                const conds = node.conds && node.conds.length > 0
                    ? node.conds
                    : [{ field: node.field || '', op: node.op || '', value: node.value || '' }];
                const pass = node.joiner === 'or' ? conds.some(test) : conds.every(test);
                const branch = (pass ? node.children : node.elseChildren || []) as XinshengNode[];
                if (!branch || branch.length === 0) return null;
                return (
                    <React.Fragment key={key}>
                        {branch.map((c, i) => renderNode(c, `${key}-${i}`, item))}
                    </React.Fragment>
                );
            }

            default:
                return null;
        }
    };

    // ── 数据驱动的 CSS 钩子 ──
    // 数字字段 → `--xt-f-<字段>` 变量（美化可以拿它算宽度、色相）
    // 文本字段 → `xt-v-<字段>-<值>` 类挂在 .xt-root 上（美化靠它做「mood=angry 就变红」）
    // 上限（扫 120 个键 / 最多 30 个类）照抄糯叽机，防止 AI 吐出巨大 JSON 时把 class 撑爆。
    const { cssVars, valueClasses } = useMemo(() => {
        const vars: Record<string, string> = {};
        const classes: string[] = [];
        let scanned = 0;
        for (const k of Object.keys(merged || {})) {
            if (scanned >= 120) break;
            scanned += 1;
            if (!isSafeKey(k)) continue;
            const v = (merged as any)[k];
            if (v == null || typeof v === 'object' || typeof v === 'function') continue;
            const s = String(v).trim();
            if (!s) continue;
            if (Number.isFinite(Number(s))) {
                vars[`--xt-f-${k}`] = String(Number(s));
            } else if (classes.length < 30) {
                const slug = slugify(s);
                if (slug) classes.push(`xt-v-${k}-${slug}`);
            }
        }
        return { cssVars: vars, valueClasses: classes };
    }, [merged]);

    if (isEmpty) return null;

    // @bg / @particles 必须在 .xt-content 之外（它们是绝对定位的背景层）
    const bgNodes = nodes.filter(n => n.type === 'bg');
    const particleNodes = nodes.filter(n => n.type === 'particles');
    const contentNodes = nodes.filter(n => n.type !== 'bg' && n.type !== 'particles');

    return (
        <>
            <style>{XINSHENG_DEFAULT_CSS}</style>
            {customCss && <style>{customCss}</style>}
            <div className={`xt-root ${valueClasses.join(' ')}`.trim()} style={cssVars as React.CSSProperties}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                    <input
                        type="checkbox"
                        id={`xt-t${i}`}
                        className={`xt-toggle xt-t${i}`}
                        style={{ display: 'none' }}
                        key={i}
                    />
                ))}
                {bgNodes.map((n, i) => renderNode(n, `b${i}`))}
                {particleNodes.map((n, i) => renderNode(n, `p${i}`))}
                <div className="xt-content">
                    {contentNodes.map((n, i) => renderNode(n, i))}
                </div>
            </div>
        </>
    );
};

export default XinshengLayoutRenderer;
