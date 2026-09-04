/**
 * 全局自定义 CSS：整机通用的弹窗 / 抽屉 / 设置框美化。
 *
 * 背景：聊天白框那份 CSS 只活在 `.sully-chat-root` 里，退出聊天就卸载；
 * 卡片那份也只管消息里的卡片。整个 App 还有 120 多处手搓的弹窗遮罩，
 * 分散在 27 个 Modal/Sheet 文件里，各写各的 Tailwind，一个共用钩子都没有 ——
 * 想统一上妆，先得有两样东西：一个全局注入点（这个文件配套的 theme 字段），
 * 和一套约定好的钩子类名（下面的名录）。
 *
 * 注入位置：components/PhoneShell.tsx（整机外壳，常驻）。
 *
 * 钩子按「批次」推进：登记在下面 UI_HOOK_CATALOG 里的才是真的挂上了，
 * 没登记的就是还没做。守卫测试会拿这份名录去源码里逐个搜，写了却不存在的会红。
 */

/** 一条 UI 钩子。 */
export interface UiHookEntry {
  /** 类名（不带点） */
  hook: string;
  label: string;
  /** 第几波挂上的，方便按批验收 */
  wave: 1 | 2 | 3;
}

/**
 * ══ 命名规范 ══
 * 前缀统一 `sully-ui-`，和已有的 `sully-chat-*` / `sully-schedule-*` 分开。
 * 结构名一律用「壳 / 头 / 身 / 脚」四段，不按具体功能命名 ——
 * 这样以后新弹窗照着挂就行，用户那份 CSS 不用跟着改。
 */
export const UI_HOOK_CATALOG: ReadonlyArray<UiHookEntry> = [
  // ── 结构 ──
  { hook: 'sully-ui-overlay', label: '弹窗背后的遮罩层', wave: 1 },
  { hook: 'sully-ui-sheet', label: '底部抽屉外壳（从下方滑出）', wave: 1 },
  { hook: 'sully-ui-modal', label: '居中弹窗外壳', wave: 1 },
  { hook: 'sully-ui-head', label: '弹窗/抽屉的标题区', wave: 1 },
  { hook: 'sully-ui-title', label: '标题文字', wave: 1 },
  { hook: 'sully-ui-hint', label: '标题下的小字说明', wave: 1 },
  { hook: 'sully-ui-body', label: '内容区（可滚动的那块）', wave: 1 },
  { hook: 'sully-ui-foot', label: '底部按钮区', wave: 1 },
  { hook: 'sully-ui-close', label: '右上角关闭键', wave: 1 },
  // ── 零件 ──
  { hook: 'sully-ui-card', label: '内容区里的小卡 / 设置分组框', wave: 1 },
  { hook: 'sully-ui-label', label: '分组小标题（大写字母那种）', wave: 1 },
  { hook: 'sully-ui-btn', label: '主按钮', wave: 1 },
  { hook: 'sully-ui-btn-ghost', label: '次按钮 / 取消', wave: 1 },
  { hook: 'sully-ui-btn-danger', label: '危险按钮（停止 / 清空 / 删除）', wave: 1 },
  { hook: 'sully-ui-plain', label: '壳里没有独立内容区时加在壳上：整壳按内容区上妆', wave: 1 },
  { hook: 'sully-ui-tab', label: '页签 / 分段控件的每一项', wave: 1 },
  { hook: 'sully-ui-tab-on', label: '页签当前选中项（和上一条同时存在）', wave: 1 },
  // ── 常驻浮层（属于「通知栏」那一份，不在弹窗这份里）──
  { hook: 'sully-ui-toast', label: '顶部的一句话提示（Toast）', wave: 1 },
  { hook: 'sully-ui-broadcast', label: '顶部的胶囊通知（正在回应 / 正在感受、世界与彼方广播、人格模拟、梦境、该备份啦）', wave: 1 },
  { hook: 'sully-ui-broadcast-warn', label: '上面那类里的提醒款（「该备份啦」），和 -broadcast 同时存在', wave: 1 },
  { hook: 'sully-ui-callbar', label: '通话挂起时顶部那条返回通话的横幅', wave: 1 },
  { hook: 'sully-ui-miniplayer', label: '后台放歌时的悬浮小圆播放器', wave: 1 },
  { hook: 'sully-ui-event', label: '整机级的事件弹窗（版本更新 / 该备份了 / Worker 更新 / 报错详情）', wave: 1 },
  { hook: 'sully-ui-layer', label: '弹窗最外层定位容器（一般不用改）', wave: 1 },
];

export const uiHooksOfWave = (wave: 1 | 2 | 3): UiHookEntry[] =>
  UI_HOOK_CATALOG.filter(entry => entry.wave === wave);

/**
 * 两份 CSS 的分工（2026-09-04 拆开）：
 *
 * · **聊天弹窗**（DIALOG_HOOKS）—— 注入点在 apps/Chat.tsx，**只在聊天页挂载**。
 *   于是它只作用于「加号菜单点开的那些设置框」，离开聊天页就卸载，
 *   外观 App、设置页里的同款弹窗不受影响。入口在「装扮」里。
 *
 * · **通知栏**（NOTIFY_HOOKS）—— 注入点在 components/PhoneShell.tsx，整机常驻。
 *   Toast 这类浮层不属于任何一个 App，入口放在「外观」里。
 *
 * 之前是一份 globalCustomCss 注在 PhoneShell，整机生效 ——
 * 结果外观 App 里的设置框也被顺带美化了，不是想要的。
 */
const NOTIFY_ONLY = new Set([
  'sully-ui-toast', 'sully-ui-broadcast', 'sully-ui-broadcast-warn',
  'sully-ui-callbar', 'sully-ui-miniplayer', 'sully-ui-event',
]);
export const DIALOG_HOOKS: ReadonlyArray<UiHookEntry> =
  UI_HOOK_CATALOG.filter(e => !NOTIFY_ONLY.has(e.hook));
export const NOTIFY_HOOKS: ReadonlyArray<UiHookEntry> =
  UI_HOOK_CATALOG.filter(e => NOTIFY_ONLY.has(e.hook));

/** 按名录生成「丢给别的 AI」的提示词。两个槽各生成一份，规矩共用。 */
const buildPrompt = (
  what: string, scope: string, hooks: ReadonlyArray<UiHookEntry>, structure: string,
): string => `你是一个 CSS 设计师。我在用一个叫 SullyOS 的「浏览器里的虚拟手机」App。
它允许我用一段自定义 CSS 重新设计${what}。请帮我写一整段可以直接粘贴的 CSS。

【生效范围】${scope}

【可用的类名（只能用这些）】
${hooks.map(e => `- .${e.hook}   ${e.label}`).join(String.fromCharCode(10))}
${structure}
【必须遵守的规范】
1. 只允许用上面这些 .sully-ui-* 类及其后代 / 伪元素。
   禁止 body、*、div、html 这类全局选择器。
2. 覆盖默认样式基本都要加 !important。
3. 这是移动端窄屏（宽约 390px），尺寸克制。
4. **不要用 backdrop-filter / filter: blur()**：它们每帧都要重算，手机会发烫。
   要「玻璃感」请改用半透明纯色 + 描边。
5. **不要写无限循环的动画**（呼吸光、常驻脉冲）。
6. 不要 display:none 掉关闭键（会关不掉弹窗）。
7. 装饰优先用渐变和内嵌 SVG（data:image/svg+xml），光栅化一次就存成位图，很便宜。

【输出要求】
直接输出一整段可用的 CSS（可带少量注释），不要长篇解释。
我现在想要的风格是：______（例如「奶油可可 + 灰褐点点，和我的聊天界面一套」）`;

export const DIALOG_CSS_AI_PROMPT = buildPrompt(
  '聊天里「＋」菜单点开的那些设置框和抽屉',
  '只作用于聊天页里弹出的框。外观 App、设置页里的同款弹窗不受影响。',
  DIALOG_HOOKS,
  `
典型结构长这样，照着套就行：

  .sully-ui-overlay            ← 半透明遮罩，弹窗背后那层
    .sully-ui-sheet            ← 抽屉外壳（或 .sully-ui-modal 居中弹窗）
      .sully-ui-head           ← 标题区（.sully-ui-title 标题 / .sully-ui-hint 小字 / .sully-ui-close 关闭键）
      .sully-ui-body           ← 内容区（.sully-ui-card 设置分组框 / .sully-ui-label 分组小标题）
      .sully-ui-foot           ← 底部按钮区（里面每个 button 都可以直接选中）

有些壳没有独立的内容区，它们在壳上多带一个 .sully-ui-plain，
这种要把「壳本身」当内容区上妆，别只给它深色外框，否则文字压在深底上看不清。
`);

export const NOTIFY_CSS_AI_PROMPT = buildPrompt(
  '整机顶部弹出的通知条',
  '整机生效：在任何 App 里弹出的提示都吃这份。',
  NOTIFY_HOOKS,
  String.fromCharCode(10));

/** 内置：可可点点（和聊天界面同一套语言的弹窗皮肤）。 */
export const COCOA_DOTS_DIALOG_CSS = `/* 可可点点 · 弹窗与设置框 —— 和聊天白框同一套语言 */
.sully-ui-overlay{
  background:rgba(48,44,41,.34)!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}
/* 外框：炭黑 + 白波点。内容区（head / body / foot）自己垫奶油。 */
.sully-ui-sheet,.sully-ui-modal{
  background-color:#302C29!important;
  background-image:radial-gradient(rgba(255,255,255,.30) 1px,transparent 1.1px)!important;
  background-size:7px 7px!important;
  border:0!important;
  padding:9px!important;
  box-shadow:0 -6px 22px rgba(48,44,41,.22)!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}
.sully-ui-sheet{border-radius:22px 22px 0 0!important;}
.sully-ui-modal{border-radius:22px!important;}

/* 壳里没有独立内容区的（装扮抽屉、心象设置这种）：整壳直接按内容区上妆，
   否则文字会压在炭黑波点上看不清。padding 不动，用组件自己的。 */
.sully-ui-sheet.sully-ui-plain,.sully-ui-modal.sully-ui-plain{
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
  border:5px solid #302C29!important;
  padding:9px!important;
}
/* 兜底：还没挂钩子的弹窗也不会变成深底浅字（第二/三波的安全网） */
.sully-ui-sheet:not(:has(.sully-ui-body)):not(.sully-ui-plain),
.sully-ui-modal:not(:has(.sully-ui-body)):not(.sully-ui-plain){
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
  border:5px solid #302C29!important;
}

/* 奶油内胆。三段共用同一张底纹，接缝处看不出分界 —— 
   之前 foot 用纯色、body 带波点，交界就成了一条线。 */
.sully-ui-head,.sully-ui-body,.sully-ui-foot{
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
  border-top:0!important;border-bottom:0!important;
  box-shadow:none!important;
}
.sully-ui-head{border-radius:15px 15px 0 0!important;}
.sully-ui-foot{border-radius:0 0 15px 15px!important;padding-top:16px!important;}
/* body 的 padding 不覆盖：组件自己的宽度是按它算的，
   动了会把里面的横排卡片挤成竖排。 */

.sully-ui-title{color:#4A3B31!important;font-weight:700!important;letter-spacing:.04em!important;}
.sully-ui-hint{color:#8E837A!important;}
.sully-ui-label{color:#A79C93!important;letter-spacing:.16em!important;}
.sully-ui-close{
  width:30px!important;height:30px!important;border-radius:99px!important;
  background:#F7F5F2!important;border:1.5px dotted #A79C93!important;color:#6E6259!important;
}
.sully-ui-card{
  background:#FFFFFF!important;
  border:1.5px dotted #A79C93!important;
  border-radius:16px!important;box-shadow:none!important;
}

/* ── 按钮 ──
   底部按钮区里的**每一个** button 都收编，包括各弹窗自带的红色 / 紫色 / 主题色，
   不用逐个去源码里挂钩子。最后一个默认当主按钮。 */
.sully-ui-foot button{
  background-color:#F7F5F2!important;background-image:none!important;
  color:#6E6259!important;
  border:1.5px dotted #A79C93!important;border-radius:99px!important;
  box-shadow:none!important;
}
.sully-ui-foot button:last-child,
.sully-ui-btn{
  background-color:#A9866A!important;background-image:none!important;
  color:#FFFFFF!important;
  border:1.5px solid #A9866A!important;border-radius:99px!important;box-shadow:none!important;
}
.sully-ui-btn-ghost{
  background-color:#F7F5F2!important;background-image:none!important;color:#6E6259!important;
  border:1.5px dotted #A79C93!important;border-radius:99px!important;box-shadow:none!important;
}
/* 危险按钮：保留警示，但换成本主题的藕粉描边，不要那块正红 */
.sully-ui-btn-danger,.sully-ui-foot .sully-ui-btn-danger{
  background-color:#FBF1EF!important;background-image:none!important;
  color:#A85D4C!important;
  border:1.5px solid #DCB6AC!important;border-radius:99px!important;box-shadow:none!important;
}

.sully-ui-tab{
  background:transparent!important;color:#8E837A!important;
  border-radius:99px!important;box-shadow:none!important;
}
.sully-ui-tab.sully-ui-tab-on{
  background:#E6DED3!important;color:#4A3B31!important;
  border:1.5px dotted #A79C93!important;
}`;



export const COCOA_DOTS_NOTIFY_CSS = `/* 可可点点 · 顶部通知条 */
.sully-ui-broadcast{
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
  border:2px solid #302C29!important;border-radius:99px!important;
  color:#4A3B31!important;
  box-shadow:0 4px 14px rgba(48,44,41,.18)!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}
.sully-ui-broadcast *{color:#4A3B31!important;}
/* 提醒款（该备份啦）：留一点警示，换成本主题的奶茶棕 */
.sully-ui-broadcast-warn{
  border-color:#A9866A!important;background-color:#FBF5EC!important;
}
.sully-ui-broadcast-warn *{color:#8A6B4A!important;}
/* 通话挂起横幅：绿条太跳，换成炭黑底奶油字，并停掉它的常驻脉冲动画（省电） */
.sully-ui-callbar{
  background-color:#302C29!important;background-image:none!important;
  color:#FCFBF9!important;
  animation:none!important;
  border-bottom:2px solid #A9866A!important;
}
.sully-ui-callbar *{color:#FCFBF9!important;}
/* 后台放歌的小圆播放器 */
.sully-ui-miniplayer{
  box-shadow:0 0 0 2.5px #302C29,0 3px 10px rgba(48,44,41,.28)!important;
}
/* 整机事件弹窗：只收编遮罩底色，卡片本体各有各的插画/排版，不硬套 */
.sully-ui-event{
  background-color:rgba(48,44,41,.42)!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}
.sully-ui-toast{
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
  border:2px solid #302C29!important;border-radius:16px!important;
  color:#4A3B31!important;
  box-shadow:0 4px 14px rgba(48,44,41,.18)!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}`;

export interface GlobalCssBuiltinPreset {
  name: string;
  desc: string;
  css: string;
}

export const BUILTIN_DIALOG_CSS_PRESETS: ReadonlyArray<GlobalCssBuiltinPreset> = [
  { name: '可可点点', desc: '炭黑点点外框 + 奶油内胆，和聊天界面同一套', css: COCOA_DOTS_DIALOG_CSS },
];

export const BUILTIN_NOTIFY_CSS_PRESETS: ReadonlyArray<GlobalCssBuiltinPreset> = [
  { name: '可可点点', desc: '奶油底 + 炭黑描边，和顶栏同一套', css: COCOA_DOTS_NOTIFY_CSS },
];
