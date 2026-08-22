/**
 * 上屏耗时探针 —— 「推送横幅弹了、聊天界面还在转」的自报家门。
 *
 * 为什么要有：这段耗时全花在客户端（读角色档案 / 表情包 / 近史，然后逐条落库），
 * 而它发生在 iOS PWA 里，接不了调试器、看不了 console。与其靠猜去优化，不如让它
 * 慢的时候自己把分段耗时摆到用户眼前。
 *
 * 自动闭嘴：只有总耗时超过 SLOW_FLUSH_TOAST_MS 才报。真优化到位之后一条都不会再出现，
 * 不需要再发一版把这东西摘掉。
 *
 * 单独成文件的原因：事件名要被 activeMsgRuntime（发）和 OSContext（收）两边用，
 * 放在任何一边都会让另一边反向依赖——OSContext 现在压根不 import activeMsgRuntime，
 * 为一个字符串常量把它俩绑上是得不偿失的。
 */

/** 慢到这个程度才值得打扰用户报数（毫秒）。 */
export const SLOW_FLUSH_TOAST_MS = 1500;

/** 单段短于这个值不进文案——只留真正占时间的那几段，方便一眼看懂 / 截图。 */
export const SLOW_FLUSH_SEGMENT_FLOOR_MS = 150;

/** 探针事件名。OSContext 监听它弹 toast；没人听的时候什么也不会发生。 */
export const SLOW_FLUSH_TIMING_EVENT = 'sullyos-slow-flush-timing';

/** 一段耗时：[这一步叫什么, 花了多少毫秒]。 */
export type FlushSegment = [label: string, ms: number];

/**
 * 把分段耗时拼成一句人能读的话；不够慢就返回 null（= 不报）。
 *
 * 纯函数，方便单测钉住「不慢不报」「只留大头」这两条。
 */
export const buildSlowFlushText = (segments: FlushSegment[]): string | null => {
  const totalMs = segments.reduce((sum, [, ms]) => sum + ms, 0);
  if (totalMs < SLOW_FLUSH_TOAST_MS) return null;
  const parts = segments
    .filter(([, ms]) => ms >= SLOW_FLUSH_SEGMENT_FLOOR_MS)
    .map(([label, ms]) => `${label} ${(ms / 1000).toFixed(1)}`);
  return `⏱ 上屏 ${(totalMs / 1000).toFixed(1)}s${parts.length ? '｜' + parts.join('、') : ''}`;
};

/**
 * 报一次（只在慢的时候）。
 *
 * 纯诊断，不参与任何业务判断——所以整段包 try，探针自己坏掉也绝不能连累消息落库。
 */
export const reportSlowFlush = (segments: FlushSegment[]): void => {
  try {
    const text = buildSlowFlushText(segments);
    if (!text) return;
    console.log('[amsg:flush-timing]', text, segments);
    window.dispatchEvent(new CustomEvent(SLOW_FLUSH_TIMING_EVENT, { detail: { text } }));
  } catch { /* 诊断而已，坏了就算 */ }
};

/** 起一个计时器：调 mark(标签) 记下「离上一次 mark 过了多久」。 */
export const startFlushTimer = (): { mark: (label: string) => void; segments: FlushSegment[] } => {
  const segments: FlushSegment[] = [];
  let at = Date.now();
  return {
    segments,
    mark: (label: string) => {
      const now = Date.now();
      segments.push([label, now - at]);
      at = now;
    },
  };
};
