import type { ChatCardCssPreset } from '../types';

/**
 * 「装扮 → 所有聊天 → 卡片 · CSS」的数据层：卡片名录、给外部 AI 的提示词、内置预设，
 * 以及预设的保存 / 重命名 / 删除 / 套用。
 *
 * 预设整套存在 osTheme 里（跟着备份导出一起走），和日程卡皮肤预设同一套做法
 * （utils/scheduleAppearance.ts），行为刻意保持一致：同名视为覆盖、重命名查重、有上限。
 */

/** 卡片名录：一行一种卡，用于 AI 提示词和编辑器里的「有哪些卡」清单。 */
export interface ChatCardCatalogEntry {
  /** data-card 的值 */
  card: string;
  /** data-card-sub 的值（该卡有子类时） */
  sub?: string;
  label: string;
  /** 这张卡是深色底还是浅色底——决定要不要被「浅色卡片」预设拉浅 */
  tone: 'dark' | 'light';
  from: string;
}

export const CHAT_CARD_CATALOG: ReadonlyArray<ChatCardCatalogEntry> = [
  { card: 'vr_card', label: '彼方 · 动态', tone: 'dark', from: '彼方（VRWorld）' },
  { card: 'sim_card', label: '人生模拟', tone: 'dark', from: '人生模拟 PersonaSim' },
  { card: 'phone_card', label: '查岗偷看', tone: 'dark', from: '查岗 CheckPhone' },
  { card: 'trpg_card', label: '跑团战报', tone: 'dark', from: '跑团 GameApp' },
  { card: 'novel_card', label: '小说进度', tone: 'light', from: '小说写作' },
  { card: 'world_card', label: '世界动态', tone: 'light', from: '世界主页' },
  { card: 'room_card', label: '房间氛围', tone: 'light', from: '房间' },
  { card: 'news_card', label: '新闻', tone: 'light', from: 'AI 对话内发送' },
  { card: 'theater_card', label: '梦剧场', tone: 'light', from: '梦剧场' },
  { card: 'music_card', label: '音乐 / 一起听', tone: 'light', from: 'AI 对话内发送' },
  { card: 'xhs_card', label: '小红书笔记', tone: 'light', from: 'AI 对话内发送' },
  { card: 'webpage_card', label: '网页', tone: 'light', from: 'AI 对话内发送' },
  { card: 'social_card', label: '朋友圈动态', tone: 'light', from: '朋友圈 SocialApp' },
  { card: 'life_card', label: '生活记录', tone: 'light', from: '生活记录' },
  { card: 'group_topic_card', label: '群话题', tone: 'light', from: '群聊' },
  { card: 'mcd_card', label: '麦当劳订单', tone: 'light', from: '麦当劳小程序' },
  { card: 'luckin_card', label: '瑞幸订单', tone: 'light', from: '瑞幸小程序' },
  { card: 'html_card', label: 'HTML 模块', tone: 'light', from: 'AI 生成的网页模块' },
  { card: 'transfer', label: '转账', tone: 'light', from: '聊天内转账' },
  { card: 'interaction', label: '戳一戳', tone: 'light', from: '互动动作' },
  { card: 'schedule_invite', label: '日程邀约', tone: 'light', from: '共享日历' },
  { card: 'schedule_invite_reply', label: '邀约回复', tone: 'light', from: '共享日历' },
  { card: 'score_card', sub: 'diary_card', label: '日记', tone: 'light', from: '日记本' },
  { card: 'score_card', sub: 'guidebook_card', label: '攻略小结', tone: 'light', from: '攻略本' },
  { card: 'score_card', sub: 'lifesim_reset_card', label: '人生重开', tone: 'light', from: '人生模拟' },
  { card: 'score_card', sub: 'quiz_card', label: '答题', tone: 'light', from: '答题' },
  { card: 'score_card', sub: 'qixi_event_card', label: '七夕事件', tone: 'light', from: '节日活动' },
  { card: 'score_card', sub: 'whiteday_card', label: '白色情人节', tone: 'light', from: '节日活动' },
  { card: 'score_card', sub: 'like520_card', label: '520 事件', tone: 'light', from: '节日活动' },
  { card: 'system', sub: 'call-end-popup', label: '通话结束小结', tone: 'light', from: '通话' },
  { card: 'system', sub: 'incoming-call-missed', label: '未接 / 拒接来电', tone: 'light', from: '来电' },
  { card: 'system', sub: 'date-end-popup', label: '见面完结', tone: 'light', from: '见面' },
  { card: 'system', sub: 'date-meeting-invite', label: '见面邀请', tone: 'light', from: '见面' },
  { card: 'system', sub: 'system-log', label: '系统日志小胶囊', tone: 'light', from: '系统提示' },
];

/** 深色卡片的 `data-card` 值——「浅色卡片」内置预设就是冲它们去的。 */
export const DARK_CARD_KINDS: ReadonlyArray<string> = CHAT_CARD_CATALOG
  .filter(entry => entry.tone === 'dark')
  .map(entry => entry.card);

/**
 * 卡片外壳的通用选择器。
 *
 * 每张卡的结构都是「定宽外框 → 一个 rounded + overflow-hidden 的壳 → 内容」，
 * 壳上同时带这两个 class 是卡片渲染里稳定的写法；装饰用的光晕/星点层没有 overflow-hidden，
 * 所以不会被误伤。
 */
export const CARD_SHELL_SELECTOR = 'div[class*="overflow-hidden"][class*="rounded-"]';

const darkShellSelector = (property: string): string =>
  DARK_CARD_KINDS.map(kind => `.sully-chat-card[data-card="${kind}"] ${property}`).join(',\n');

/**
 * 内置预设「浅色卡片」：把四张深色卡（彼方 / 人生模拟 / 查岗 / 跑团）整体拉浅，
 * 让它们不再从浅色主题的聊天里跳出来。其余卡片本来就是浅底，一个字都不动。
 */
export const LIGHT_CARDS_PRESET_CSS = `/* 浅色卡片 —— 把深色卡拉到和浅色聊天同一个亮度 */
${darkShellSelector(CARD_SHELL_SELECTOR)}{
  background:linear-gradient(160deg,#faf8ff 0%,#f3effb 55%,#ece7f7 100%)!important;
  border-color:rgba(122,104,178,.22)!important;
  box-shadow:0 4px 16px rgba(112,96,166,.12)!important;
}
/* 深底上的浅色文字要反过来，否则浅底浅字看不见 */
${darkShellSelector(`${CARD_SHELL_SELECTOR} *`)}{
  color:#4b4270!important;
}
/* 强调色（角色名、标签）保留一点暖调，不然整张卡糊成一片紫 */
${darkShellSelector(`${CARD_SHELL_SELECTOR} [class*="text-amber"]`)}{
  color:#b07d3a!important;
}
/* 卡内分隔线 */
${darkShellSelector(`${CARD_SHELL_SELECTOR} [class*="border-white/10"]`)},
${darkShellSelector(`${CARD_SHELL_SELECTOR} [class*="border-b"]`)},
${darkShellSelector(`${CARD_SHELL_SELECTOR} [class*="border-t"]`)}{
  border-color:rgba(122,104,178,.16)!important;
}
/* 为深底画的光晕和星点，铺到浅底上只会发灰，收掉 */
${darkShellSelector(`${CARD_SHELL_SELECTOR} div[class*="pointer-events-none"]`)}{
  opacity:.18!important;
}`;

export interface ChatCardCssBuiltinPreset {
  name: string;
  desc: string;
  css: string;
}

export const BUILTIN_CARD_CSS_PRESETS: ReadonlyArray<ChatCardCssBuiltinPreset> = [
  {
    name: '浅色卡片',
    desc: '把彼方 / 人生模拟 / 查岗 / 跑团这几张深色卡拉浅，配浅色主题',
    css: LIGHT_CARDS_PRESET_CSS,
  },
];

/** 丢给别的 AI 让它整段生成卡片 CSS 的提示词。 */
export const CHAT_CARD_CSS_AI_PROMPT = `你是一个 CSS 设计师。我在用一个叫 SullyOS 的「浏览器里的虚拟手机」聊天 App。
聊天里会出现各种卡片（彼方动态、通话小结、日程邀约、音乐、小红书……），
它允许我用一段自定义 CSS 统一重新设计这些卡片。请帮我写一整段可以直接粘贴的 CSS。

【卡片的选择器结构】
每张卡片最外层都有 class \`.sully-chat-card\`，并带两个属性：
- \`data-card\`      卡片种类
- \`data-card-sub\`  子类（只有部分卡片有）

所以选中某一张卡片写：
  .sully-chat-card[data-card="vr_card"] { ... }
  .sully-chat-card[data-card="score_card"][data-card-sub="diary_card"] { ... }
选中全部卡片写：
  .sully-chat-card { ... }

卡片内部是「定宽外框 → 一个带 rounded 和 overflow-hidden 的壳 → 内容」。
真正要改背景/描边/阴影的是那个壳，用这个选择器命中它：
  .sully-chat-card[data-card="vr_card"] ${CARD_SHELL_SELECTOR} { ... }

【卡片名录（data-card / data-card-sub → 是什么）】
${CHAT_CARD_CATALOG.map(entry =>
  `- ${entry.card}${entry.sub ? ` / ${entry.sub}` : ''}  ${entry.label}（${entry.from}）${entry.tone === 'dark' ? ' ← 深色底' : ''}`,
).join('\n')}

【必须遵守的规范】
1. 卡片的颜色大多写在内联 style 上，**所有覆盖都必须加 !important**，否则完全无效。
2. 只允许用 \`.sully-chat-card\` 开头的选择器及其后代 / 伪元素。
   禁止 body、*、div、html 这类全局选择器（会污染整个 App 的其它界面）。
3. 这是移动端窄屏（宽约 390px），卡片本身宽 256–288px，尺寸请克制。
4. 深色卡改成浅底时，记得同时把里面的浅色文字改深，否则浅底浅字看不见：
   \`.sully-chat-card[data-card="xxx"] ${CARD_SHELL_SELECTOR} *{color:#444!important;}\`
5. 深色卡里常有为深底画的光晕 / 星点装饰层（\`div[class*="pointer-events-none"]\`），
   铺到浅底上会发灰，改浅时把它 opacity 调低或收掉。
6. 不要 \`display:none\` 整张卡片（用户会以为消息丢了）。
7. 性能：静态 blur / backdrop-filter 可以，不要对它们做持续动画。

【可以自由发挥的部分】
背景（纯色 / 渐变 / 图案 / 图片直链 / 多层叠加）、圆角与 clip-path、描边与阴影、
字色字重字间距、::before/::after 加角标和装饰、适度的 @keyframes 动画。

【输出要求】
直接输出一整段可用的 CSS（可带少量注释），不要长篇解释。
我现在想要的风格是：______（例如「全部卡片改成奶油白 + 圆润」「轻松熊配色」「统一浅紫玻璃感」）`;

/** 预设最多存这么多套，避免主题记录无限膨胀。 */
export const CHAT_CARD_CSS_PRESET_LIMIT = 24;

export function makeChatCardCssPresetId(): string {
  return `card_css_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 保存 / 覆盖一套预设。同名视为覆盖，避免列表里堆出一排「浅色卡片」。
 * 名称为空、CSS 为空或超出上限时返回 error，由调用方 toast。
 */
export function upsertChatCardCssPreset(
  presets: ChatCardCssPreset[] | undefined,
  name: string,
  css: string,
): { presets: ChatCardCssPreset[]; preset: ChatCardCssPreset } | { error: string } {
  const trimmedName = (name || '').trim();
  if (!trimmedName) return { error: '先给这套卡片样式起个名字。' };
  if (!(css || '').trim()) return { error: '当前没有 CSS，先写点内容再保存预设。' };
  const list = presets || [];
  const existing = list.find(item => item.name === trimmedName);
  if (!existing && list.length >= CHAT_CARD_CSS_PRESET_LIMIT) {
    return { error: `预设最多保存 ${CHAT_CARD_CSS_PRESET_LIMIT} 套，先删掉几套再存。` };
  }
  const preset: ChatCardCssPreset = {
    id: existing?.id || makeChatCardCssPresetId(),
    name: trimmedName,
    css,
    updatedAt: Date.now(),
  };
  return {
    presets: existing ? list.map(item => (item.id === existing.id ? preset : item)) : [...list, preset],
    preset,
  };
}

/** 重命名一套预设。空名字或撞上别的预设名都会被拦下，交给调用方 toast。 */
export function renameChatCardCssPreset(
  presets: ChatCardCssPreset[] | undefined,
  id: string,
  name: string,
): { presets: ChatCardCssPreset[] } | { error: string } {
  const trimmed = (name || '').trim();
  if (!trimmed) return { error: '预设名字不能是空的。' };
  const list = presets || [];
  const target = list.find(item => item.id === id);
  if (!target) return { error: '这套预设已经不在了。' };
  if (list.some(item => item.id !== id && item.name === trimmed)) {
    return { error: `已经有一套叫「${trimmed}」了，换个名字。` };
  }
  return {
    presets: list.map(item => (item.id === id ? { ...item, name: trimmed, updatedAt: Date.now() } : item)),
  };
}

export function removeChatCardCssPreset(
  presets: ChatCardCssPreset[] | undefined,
  id: string,
): ChatCardCssPreset[] {
  return (presets || []).filter(item => item.id !== id);
}
