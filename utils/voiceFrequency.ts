/**
 * 语音条发送频率的「实际用量反馈」。
 *
 * 病症：一旦打开「可以发语音」，模型几乎每轮都发语音，不再按场合判断。
 * 静态提示词里那句「不是每条消息都要发语音」是软约束，模型读过就忘 ——
 * 尤其是最近几轮的历史里全是语音时，示范效应比规则强得多（它照着自己上一条写）。
 *
 * 这里的做法：把「你最近几轮里发了几条语音」算出来，作为**易变状态**注入
 * （volatileState，不是稳定段 —— 每轮都变的内容进稳定段会打断 prompt 前缀缓存）。
 * 用量正常时返回空串、什么都不注入，所以它只在跑偏时说话，不会一直唠叨。
 *
 * 计数单位是「轮」不是「气泡」：一次回复常被切成好几个气泡，语音只占其中一个，
 * 按气泡算会把真实的语音率算低一半以上。
 */
import type { Message } from '../types';

/** 一条消息是不是语音条（带 <语音> 标签）。与 MessageItem 的判定保持一致。 */
export const isVoiceMessage = (m: Pick<Message, 'role' | 'content'>): boolean =>
  m.role === 'assistant' && /<[语語]音[^>]*>/.test(m.content || '');

export interface VoiceUsageStats {
  /** 统计窗口里一共有几轮 AI 回复 */
  turns: number;
  /** 其中有几轮发了语音 */
  voiceTurns: number;
  /** 从最后一轮往回数，连续多少轮都发了语音 */
  streak: number;
}

/**
 * 统计最近 `windowTurns` 轮 AI 回复里的语音使用情况。
 * 「一轮」= 一段连续的 assistant 消息（被 user 消息隔开就算换轮）；
 * 这一轮里只要有任意一个气泡是语音条，就算这轮发了语音。
 */
export const countRecentVoiceUsage = (
  messages: readonly Message[],
  windowTurns = 10,
): VoiceUsageStats => {
  if (!messages?.length || windowTurns <= 0) return { turns: 0, voiceTurns: 0, streak: 0 };

  // 从后往前扫，遇到 user 消息就切一轮。system 消息忽略（不打断连续的 assistant 段）。
  const turnHasVoice: boolean[] = [];   // [0] 是最近一轮
  let inTurn = false;
  let currentHasVoice = false;
  for (let i = messages.length - 1; i >= 0 && turnHasVoice.length < windowTurns; i--) {
    const m = messages[i];
    if (m.role === 'user') {
      if (inTurn) {
        turnHasVoice.push(currentHasVoice);
        inTurn = false;
        currentHasVoice = false;
      }
      continue;
    }
    if (m.role !== 'assistant') continue;
    inTurn = true;
    if (isVoiceMessage(m)) currentHasVoice = true;
  }
  if (inTurn && turnHasVoice.length < windowTurns) turnHasVoice.push(currentHasVoice);

  let streak = 0;
  for (const hasVoice of turnHasVoice) {
    if (!hasVoice) break;
    streak++;
  }
  return {
    turns: turnHasVoice.length,
    voiceTurns: turnHasVoice.filter(Boolean).length,
    streak,
  };
};

/** 语音轮占比超过这个值就算偏多（约三成）。 */
export const OVERUSE_RATIO = 0.35;
/** 连着这么多轮都发语音就直接叫停。 */
export const STREAK_LIMIT = 2;
/** 样本太少时不下判断（刚开聊两轮全是语音不代表跑偏）。 */
export const MIN_TURNS_FOR_RATIO = 3;

/**
 * 按实际用量生成一段注入文本，塞进 volatileState（历史消息之后、离生成点还有
 * 一段距离的位置）。用量正常 → 返回空串（什么都不注入）。分两档：连着发太多 →
 * 硬性叫停这一轮；总体偏多 → 提醒收敛。
 *
 * 注意：streak 超限时这里的措辞只是"提醒"，真正的硬约束在 buildVoiceHardBlockTail——
 * 那条会被拼进整段 prompt 的最后一句（recencyTail），模型开口前读到的最后内容，
 * 比塞在 volatileState 中段（旁边一堆时间/心情/日程/群聊背景在抢注意力）管用得多。
 */
export const buildVoiceUsageHint = (stats: VoiceUsageStats): string => {
  if (stats.streak >= STREAK_LIMIT) {
    return `\n\n[系统提示｜语音频率: 你已经连着 ${stats.streak} 轮发语音了。真人不会这样——连着几条语音会让对方觉得被轰炸。**这一轮用打字**，除非用户明确要求听你的声音。]`;
  }
  if (stats.turns >= MIN_TURNS_FOR_RATIO && stats.voiceTurns / stats.turns > OVERUSE_RATIO) {
    return `\n\n[系统提示｜语音频率: 最近 ${stats.turns} 轮里你有 ${stats.voiceTurns} 轮发了语音，偏多了。语音是偶尔为之的表达方式，不是默认形态。这一轮优先打字，除非这句话不听语气就会被误解。]`;
  }
  return '';
};

/** 是否要在这一轮硬性禁掉语音标签——只在"连着发"这个最极端的情况下才用。 */
export const shouldHardBlockVoiceThisTurn = (stats: VoiceUsageStats): boolean =>
  stats.streak >= STREAK_LIMIT;

/**
 * 拼进 recencyTail（整段 prompt 最后一句、模型开口前读到的最后内容）的硬性禁令。
 * 用量正常时返回空串。跟 buildVoiceUsageHint 的 streak 分支说的是同一件事，
 * 但这条放在真正管用的位置——上面 volatileState 里那条更像是"背景噪音里的一句提醒"，
 * 这条才是最后拍板的那句话。
 */
export const buildVoiceHardBlockTail = (stats: VoiceUsageStats): string =>
  shouldHardBlockVoiceThisTurn(stats)
    ? `\n\n[系统提示｜语音频率（最高优先级）: 你已经连续 ${stats.streak} 轮发语音，这轮开始前必须先打字缓一缓。本轮回复禁止出现 <语音> 标签，不管内容是什么、不管有多想发——用文字说完这句话。]`
    : '';
