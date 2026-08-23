/**
 * 角色主动来电 · **纯解析叶子**（零依赖，连 type import 都没有）。
 *
 * 单独拆出来的理由跟 utils/scheduleChangeParse.ts 之于 scheduleChange.ts 一模一样：
 * worker classifier 必须认得出这个标签——它留在正文里的话会被 sanitizeIntoSegments 的
 * stripBusinessTagsForNotification（正则含 ACTION）整块剥掉，连 raw 都不留，客户端永远
 * 收不到，角色嘴上说"我打给你了"而电话根本没响。走 directive 通道才到得了。
 *
 * 而 incomingCall.ts 那半边拖着 localStorage / window / 进程内单例，worker 引不动。
 * 两边各写一份解析的话，前台聊天里打得通的电话、云端生成时打不通——这正是 8/23
 * 第一批上线后实际发生的事。
 *
 * ── 标签形态 ─────────────────────────────────────────────────────────────
 *   [[ACTION:CALL|video|想看看你现在在干嘛]]
 *   [[ACTION:CALL|voice|睡了吗]]
 * 容错：全角竖线/冒号、中文别名（视频/语音）、模式缺省（缺省按语音）、
 *      `[[ACTION:CALL:video|…]]` 这种冒号写法。
 */

export type CallInviteMode = 'voice' | 'video';

export interface CallInvite {
  mode: CallInviteMode;
  /** 接通后角色的第一句话；空串代表让它到时候自己现编。 */
  opening: string;
}

export interface ExtractedCallInvite {
  cleanedText: string;
  invite: CallInvite | null;
  /** 认出了 CALL 标签但内容废掉的条数，只用来打日志，不影响正文。 */
  malformedCount: number;
}

/**
 * 一整条 `[[ACTION:CALL …]]`。
 *
 * 用 `[\s\S]` 是有意的：开场白里模型经常自己换行。非贪婪 + 先到的 `]]` 收尾，
 * 跟 sanitize.ts 里那条 `\[\[(?:ACTION|…)[:\s][\s\S]*?\]\]` 的边界口径保持一致，
 * 免得两边对"这条标签到哪儿为止"的看法不同、剥完还剩半截。
 */
const CALL_TAG_RE = /\[\[\s*ACTION\s*[:：]\s*CALL\s*(?:[:：|｜]\s*)?([\s\S]*?)\]\]/gu;

const VIDEO_WORDS = /^(?:video|视频|視頻|视讯|視訊|影片|v)$/iu;
const VOICE_WORDS = /^(?:voice|audio|语音|語音|电话|電話|通话|通話|a)$/iu;

/** 把首字段判成模式；判不出来就说明模型没写模式，整段都是开场白。 */
const readMode = (field: string): CallInviteMode | null => {
  const word = field.trim().replace(/[。．.!！?？，,]+$/u, '');
  if (VIDEO_WORDS.test(word)) return 'video';
  if (VOICE_WORDS.test(word)) return 'voice';
  return null;
};

const parseBody = (body: string): CallInvite | null => {
  // 竖线（半角/全角）是规范分隔符；模型偶尔写成逗号，只在首段恰好是模式词时才认，
  // 否则"喂，在吗"这种开场白会被从逗号处劈成两半。
  const parts = body.split(/[|｜]/u);
  const head = parts.length > 1 ? readMode(parts[0]) : null;
  if (head) {
    return { mode: head, opening: parts.slice(1).join('|').trim() };
  }
  const whole = body.trim();
  if (!whole) return null;
  // 没写分隔符但整段就是一个模式词：`[[ACTION:CALL|video]]`，开场白留空让它现编。
  const soloMode = readMode(whole);
  if (soloMode) return { mode: soloMode, opening: '' };
  // 缺省按语音。视频要开摄像头、要渲染立绘，是更重的打扰；模型没明确说要视频时
  // 不该替它选重的那个。
  return { mode: 'voice', opening: whole };
};

export const extractCallInvite = (text: string): ExtractedCallInvite => {
  if (!text || !text.includes('[[')) {
    return { cleanedText: text ?? '', invite: null, malformedCount: 0 };
  }
  let invite: CallInvite | null = null;
  let malformedCount = 0;
  const cleanedText = text.replace(CALL_TAG_RE, (_full, body: string) => {
    const parsed = parseBody(String(body ?? ''));
    // 一轮里吐了好几个只认第一个。多打几通电话没有任何语义，后面那些一律当噪音。
    if (parsed && !invite) invite = parsed;
    else if (!parsed) malformedCount += 1;
    return '';
  });
  return { cleanedText, invite, malformedCount };
};

/** 反向拼回标签 —— 给 worker directive 通道重放用（对齐 reconstructDirectiveTags 的写法）。 */
export const formatCallInviteTag = (invite: CallInvite): string =>
  `[[ACTION:CALL|${invite.mode}|${invite.opening}]]`;

