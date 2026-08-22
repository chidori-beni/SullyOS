/**
 * 判断两个 Blob 的字节内容是否完全一致。
 *
 * 用途：语音「重新生成」（重 roll）。MiniMax / 鱼声都不提供 seed，同样的请求体
 * 大多数时候会返回一条新的演绎，但偶尔会原样返回同一段音频。这时候界面上看起来
 * "重新生成成功了"，听起来却一点没变 —— 调用方拿这个函数判出来之后，可以带一个
 * 听不出来的语速微偏移再试一次。
 *
 * 先比 size 再比字节：绝大多数「真的换了一条」的情况在第一步就返回 false，
 * 不用把几百 KB 的音频读进内存。
 */
export async function blobsAreIdentical(a: Blob | null | undefined, b: Blob | null | undefined): Promise<boolean> {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.size !== b.size) return false;
  if (a.size === 0) return true;
  try {
    const [bufA, bufB] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
    if (bufA.byteLength !== bufB.byteLength) return false;
    const viewA = new Uint8Array(bufA);
    const viewB = new Uint8Array(bufB);
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  } catch {
    // 读不出字节就当作"不一样"——重 roll 宁可放过，也不要因为读失败而多打一次 API。
    return false;
  }
}

/**
 * 重 roll 的语速微偏移序列。第 n 次「同一条音频」重试用第 n 个值，
 * 幅度控制在 ±0.04 以内 —— 人耳听不出快慢差别，但请求体（以及缓存键）不同了。
 */
const SPEED_JITTER_STEPS = [0.02, -0.02, 0.03, -0.03, 0.04, -0.04];

export const speedJitterForAttempt = (attempt: number): number =>
  SPEED_JITTER_STEPS[Math.max(0, attempt) % SPEED_JITTER_STEPS.length];
