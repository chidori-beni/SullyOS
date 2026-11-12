/**
 * 通话「崩在哪一步」的现场记录（2026-11-12）。
 *
 * 用户语音通话说两句话 iPhone 就把整个页面杀掉（Safari 白页「重复出现问题」），
 * 远端手上没有 DevTools，只能靠崩之前写进 localStorage 的记录点还原现场。
 * 每一步只记「哪一步、数据有多大」，不记内容。复用主动消息那条 trace 缓冲：
 * 设置底部连点构建版本 5 下 → 「amsg2 任务观察窗」→ trace「导出全部」就能拿到。
 *
 * 记录点必须便宜：只数条数、加长度，不 JSON.stringify 大对象。
 */

import { appendInstantTraceEntry } from './instantTraceLog';

let turnSeq = 0;

export const nextCallTraceTurn = (): number => {
  turnSeq += 1;
  return turnSeq;
};

export const callTrace = (step: string, details: Record<string, unknown> = {}): void => {
  try {
    appendInstantTraceEntry({
      ts: new Date().toISOString(),
      event: `call-${step}`,
      visibility: typeof document !== 'undefined' ? document.visibilityState : 'n/a',
      ...details,
    });
  } catch { /* 记录点绝不能打断通话 */ }
};

const isDataImage = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith('data:image');

/** 数据库里的消息：多少条、多少张内联图、正文 + 图片一共多少字符。 */
export const summarizeStoredMessages = (messages: Array<{ type?: string; content?: unknown; metadata?: any }>) => {
  let images = 0;
  let chars = 0;
  for (const message of messages) {
    const content = message.content;
    if (typeof content === 'string') {
      chars += content.length;
      if (message.type === 'image' || isDataImage(content)) images += 1;
    }
  }
  return { count: messages.length, images, kchars: Math.round(chars / 1000) };
};

/** 发给模型的消息：多少条、多少个图片片段、文字 + 图片一共多少字符。 */
export const summarizeRequestMessages = (messages: Array<{ content?: unknown }>) => {
  let imageParts = 0;
  let chars = 0;
  for (const message of messages) {
    const content = message.content;
    if (typeof content === 'string') {
      chars += content.length;
    } else if (Array.isArray(content)) {
      for (const part of content as any[]) {
        if (part?.type === 'image_url') {
          imageParts += 1;
          const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
          if (typeof url === 'string') chars += url.length;
        } else if (typeof part?.text === 'string') {
          chars += part.text.length;
        }
      }
    }
  }
  return { count: messages.length, imageParts, kchars: Math.round(chars / 1000) };
};

/** localStorage 某个键当前占多少千字符（不解析）。 */
export const localStorageKchars = (key: string): number => {
  try {
    return Math.round((localStorage.getItem(key)?.length || 0) / 1000);
  } catch {
    return -1;
  }
};
