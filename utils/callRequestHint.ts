/**
 * 「该打电话时真的去打」的运行时反馈。
 * 只在角色上一轮承诺打电话却没打，或用户这一轮明确要电话时注入提示；正常时返回空串。
 */
import type { Message } from '../types';

const CALL_REQUEST_RE = /(打\s*(个)?\s*电话|打给我|拨\s*(过来|给我)|来\s*(个)?\s*电话|接\s*(个)?\s*电话|连麦|语音通话|视频通话|call\s*me)/iu;
const CALL_NEGATION_RE = /(别|不要|不用|别再|甭|先不)[^。！？!?\n]{0,6}(打\s*(个)?\s*电话|打给我|拨|连麦|来\s*(个)?\s*电话)/u;
const CALL_PROMISE_RE = /(给你(拨|打)|这就(拨|打)|马上(拨|打)|拨过去|打过去|打给你|拨给你|电话(打|拨)过去|接电话|接驾|等我电话|听我电话)/u;

const isCallEvidence = (m: Message): boolean => {
  const source = m.metadata?.source;
  return source === 'incoming-call-missed'
    || source === 'call'
    || source === 'call-end-popup'
    || !!m.metadata?.callSessionId;
};

export interface CallHintInput {
  userTurnText: string;
  lastAssistantTurnText: string;
  hasCallEvidenceAfterPromise: boolean;
}

export const readCallTurnContext = (messages: readonly Message[]): CallHintInput => {
  const userParts: string[] = [];
  const assistantParts: string[] = [];
  let sawAssistant = false;
  let hasCallEvidenceAfterPromise = false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!sawAssistant && isCallEvidence(m)) hasCallEvidenceAfterPromise = true;
    if (m.role === 'user') {
      if (sawAssistant) break;
      userParts.unshift(m.content || '');
      continue;
    }
    if (m.role !== 'assistant') continue;
    sawAssistant = true;
    assistantParts.unshift(m.content || '');
  }

  return {
    userTurnText: userParts.join('\n'),
    lastAssistantTurnText: assistantParts.join('\n'),
    hasCallEvidenceAfterPromise,
  };
};

export const userAskedForCall = (userTurnText: string): boolean => {
  if (!userTurnText) return false;
  if (CALL_NEGATION_RE.test(userTurnText)) return false;
  return CALL_REQUEST_RE.test(userTurnText);
};

export const characterPromisedCall = (assistantTurnText: string): boolean =>
  !!assistantTurnText && CALL_PROMISE_RE.test(assistantTurnText);

export const buildCallHint = (input: CallHintInput): string => {
  const { userTurnText, lastAssistantTurnText, hasCallEvidenceAfterPromise } = input;

  if (characterPromisedCall(lastAssistantTurnText) && !hasCallEvidenceAfterPromise) {
    return '\n\n[系统提示｜电话: 你上一轮说了要给对方打电话，但那通电话**并没有真的打出去**——聊天记录里找不到任何通话痕迹，对方还在等。'
      + '打电话是一个真实动作，要靠单独起一行输出 `[[ACTION:CALL | voice | 接通后你想说的第一句]]` 才会发生（视频写 video），'
      + '光在台词里说「这就给你拨过去」不会让对方的手机响一下。这一轮要么真的打，要么直说你现在不方便打，别再演一遍。]';
  }

  if (userAskedForCall(userTurnText)) {
    return '\n\n[系统提示｜电话: 对方这一轮明确点名要你打电话。'
      + '想打就真的打——单独起一行输出 `[[ACTION:CALL | voice | 接通后你想说的第一句]]`（视频写 video），ta 的手机会真的响。'
      + '不想打、或者这会儿不方便，就照人设直说，也完全可以。**唯独不要用「这就给你拨过去」之类的台词代替真的动作**——那样对方等来的是一片安静。]';
  }

  return '';
};

export const buildCallHintFromMessages = (messages: readonly Message[]): string =>
  buildCallHint(readCallTurnContext(messages));
