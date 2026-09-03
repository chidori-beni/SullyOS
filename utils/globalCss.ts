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
  { hook: 'sully-ui-tab', label: '页签 / 分段控件的每一项', wave: 1 },
  { hook: 'sully-ui-tab-on', label: '页签当前选中项（和上一条同时存在）', wave: 1 },
  // ── 常驻浮层 ──
  { hook: 'sully-ui-toast', label: '顶部的一句话提示（Toast）', wave: 1 },
  { hook: 'sully-ui-layer', label: '弹窗最外层定位容器（一般不用改）', wave: 1 },
];

export const uiHooksOfWave = (wave: 1 | 2 | 3): UiHookEntry[] =>
  UI_HOOK_CATALOG.filter(entry => entry.wave === wave);

/** 丢给别的 AI、让它整段生成全局 CSS 的提示词。 */
export const GLOBAL_CSS_AI_PROMPT = `你是一个 CSS 设计师。我在用一个叫 SullyOS 的「浏览器里的虚拟手机」App。
它允许我用一段全局自定义 CSS，统一重新设计整机的弹窗、抽屉和设置框。
请帮我写一整段可以直接粘贴的 CSS。

【可用的类名（只能用这些）】
${UI_HOOK_CATALOG.map(e => `- .${e.hook}   ${e.label}`).join('\n')}

典型结构长这样，照着套就行：

  .sully-ui-overlay            ← 半透明遮罩，弹窗背后那层
    .sully-ui-sheet            ← 抽屉外壳（或 .sully-ui-modal 居中弹窗）
      .sully-ui-head           ← 标题区
        .sully-ui-title        ← 标题
        .sully-ui-hint         ← 小字说明
        .sully-ui-close        ← 关闭键
      .sully-ui-body           ← 内容区
        .sully-ui-card         ← 里面的设置分组框
          .sully-ui-label      ← 分组小标题
          .sully-ui-btn        ← 按钮

【必须遵守的规范】
1. 只允许用上面这些 .sully-ui-* 类及其后代 / 伪元素。
   禁止 body、*、div、html 这类全局选择器 —— 这段 CSS 是**整机生效**的，
   写错一条能把所有界面搞坏。
2. 覆盖默认样式基本都要加 !important。
3. 这是移动端窄屏（宽约 390px），尺寸克制。
4. **不要用 backdrop-filter / filter: blur()**：它们每帧都要重算，手机会发烫。
   要「玻璃感」请改用半透明纯色 + 描边。
5. **不要写无限循环的动画**（呼吸光、常驻脉冲）。开场动画可以，但要能停。
6. 不要 display:none 掉 .sully-ui-close（关不掉弹窗）。
7. 装饰优先用渐变和内嵌 SVG（data:image/svg+xml），它们光栅化一次就存成位图，很便宜。

【可以自由发挥的部分】
背景（纯色 / 渐变 / 图案 / 图片直链 / 多层叠加）、圆角与 clip-path、描边与阴影、
字色字重字间距、::before/::after 加角标和装饰。

【输出要求】
直接输出一整段可用的 CSS（可带少量注释），不要长篇解释。
我现在想要的风格是：______（例如「奶油可可 + 灰褐点点，和我的聊天界面一套」）`;

/** 内置：可可点点（和聊天界面同一套语言的弹窗皮肤）。 */
export const COCOA_DOTS_UI_CSS = `/* 可可点点 · 弹窗与设置框 —— 和聊天白框同一套语言 */
.sully-ui-overlay{
  background:rgba(48,44,41,.34)!important;
  backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
}
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
/* 兜底：还没挂 .sully-ui-body 的弹窗（第二/三波没做到的那些），
   直接把壳本身垫成奶油，否则内容会直接压在炭黑波点上看不清。
   挂了 body 的走上面那套「黑框 + 奶油内胆」。 */
.sully-ui-sheet:not(:has(.sully-ui-body)),
.sully-ui-modal:not(:has(.sully-ui-body)){
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
  border:5px solid #302C29!important;
  padding:13px!important;
}
/* 奶油内胆：整块内容坐在上面 */
.sully-ui-head,.sully-ui-body{
  background-color:#FCFBF9!important;
  background-image:radial-gradient(rgba(167,156,147,.26) 1px,transparent 1.1px)!important;
  background-size:8px 8px!important;
}
.sully-ui-head{border-radius:15px 15px 0 0!important;padding:13px 15px 10px!important;}
.sully-ui-body{padding:13px 15px!important;}
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
  border-radius:16px!important;
  box-shadow:none!important;
}
/* 按钮区：和内容区无缝接上。
   padding-top 给足，按钮才在「分隔线和外框之间」居中，不会紧贴上面那条线；
   顺手清掉组件自带的 border-top（那条细线就是它）。 */
.sully-ui-foot{
  background-color:#FCFBF9!important;
  border-top:0!important;
  border-radius:0 0 15px 15px!important;
  padding:14px 15px 15px!important;
}
/* 内容区和按钮区之间的接缝：body 自己的下边框也一并去掉 */
.sully-ui-body{border-bottom:0!important;}
.sully-ui-btn{
  background:#A9866A!important;color:#fff!important;
  border:0!important;border-radius:99px!important;box-shadow:none!important;
}
.sully-ui-btn-ghost{
  background:#F7F5F2!important;color:#6E6259!important;
  border:1.5px dotted #A79C93!important;border-radius:99px!important;box-shadow:none!important;
}
.sully-ui-tab{
  background:transparent!important;color:#8E837A!important;
  border-radius:99px!important;box-shadow:none!important;
}
.sully-ui-tab.sully-ui-tab-on{
  background:#E6DED3!important;color:#4A3B31!important;
  border:1.5px dotted #A79C93!important;
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

export const BUILTIN_GLOBAL_CSS_PRESETS: ReadonlyArray<GlobalCssBuiltinPreset> = [
  {
    name: '可可点点',
    desc: '炭黑点点外框 + 奶油内胆，和聊天界面同一套',
    css: COCOA_DOTS_UI_CSS,
  },
];
