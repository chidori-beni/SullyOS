/**
 * Worker 端的通话/陪睡后台生成。
 *
 * 任务输入是浏览器提交时冻结的通话上下文；这里不依赖浏览器，也不把结果当普通聊天
 * push，而是写进 AMSG2 的 result outbox。客户端随后把结果落进本地 messages 表。
 */

import { AMSG_JOB_ID_KEY, AMSG_JOB_NAMESPACE } from '../../../utils/amsgTaskKinds';
import {
  CALL_BACKGROUND_REPLY_KIND,
  CALL_BACKGROUND_REPLY_RESULT_KIND,
  SLEEP_DREAM_KIND,
  SLEEP_DREAM_RESULT_KIND,
  buildCallJobMessages,
  buildCallJobResult,
  callJobKey,
  parseCallJobInput,
  type CallJobInput,
} from '../../../utils/amsgCallJob';
import { unpackStateValue } from '../../../utils/amsgFirePack';
import { parseCallAssistantMessage, stripCallTextFormatting } from '../../../utils/callReplyFormat';
import type { FireKindHandler, KindFireCtx, KindSessionCtx, KindWriteState } from './fireKinds';

const BACKGROUND_CALL_TIMEOUT_MS = 120_000;

export interface CallFireState {
  jobId: string;
  job: CallJobInput;
}

const discardJob = async (writeState: KindWriteState | undefined, jobId: string): Promise<void> => {
  if (!writeState) return;
  try {
    await writeState(AMSG_JOB_NAMESPACE, [{ key: callJobKey(jobId), value: null }]);
  } catch (error) {
    // TTL 会兜底；不要因为清理失败让已经生成好的结果重新烧一遍模型。
    console.warn('[amsg:call] job 行没删掉（等 TTL 兜底）', jobId, error);
  }
};

const hash32 = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const cleanGeneratedText = (raw: string): string => raw
  .replace(/<think(?:ing|ought)?\b[^>]*>[\s\S]*?<\/think(?:ing|ought)?\s*>/gi, '')
  .replace(/<think(?:ing|ought)?\b[^>]*>[\s\S]*$/gi, '')
  .replace(/```(?:text|markdown)?/gi, '')
  .replace(/```/g, '')
  .trim();

const previewText = (text: string): string => {
  const parsed = parseCallAssistantMessage({ content: text }, false);
  const readable = stripCallTextFormatting(parsed.text || text);
  const singleLine = readable.replace(/\s+/g, ' ').trim();
  return singleLine.length > 72 ? `${singleLine.slice(0, 72)}…` : singleLine;
};

const readCallJob = async (ctx: KindFireCtx, jobId: string): Promise<CallJobInput | null> => {
  const rows = await ctx.readState(AMSG_JOB_NAMESPACE);
  const row = rows.find((entry) => entry.key === callJobKey(jobId));
  if (!row?.value) return null;
  let json: string;
  try {
    json = await unpackStateValue(row.value);
  } catch (error) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`通话后台 job ${jobId} 的输入解压失败（数据损坏）：${String(error)}`);
  }
  const job = parseCallJobInput(json);
  if (!job) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`通话后台 job ${jobId} 的输入解析失败（数据损坏）`);
  }
  if (job.charId !== ctx.task.metadata?.charId) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`通话后台 job ${jobId} 的 charId 与任务对不上`);
  }
  return job;
};

const buildHandler = (kind: typeof CALL_BACKGROUND_REPLY_KIND | typeof SLEEP_DREAM_KIND): FireKindHandler => ({
  async beforeFire({ ctx, taskMeta }) {
    const jobId = taskMeta[AMSG_JOB_ID_KEY];
    if (typeof jobId !== 'string' || !jobId) {
      throw new Error(`通话后台任务的 metadata 里没有 ${AMSG_JOB_ID_KEY}`);
    }
    const job = await readCallJob(ctx, jobId);
    if (!job) return { skip: true, reason: `通话后台 job ${jobId} 的输入已不在（过期或已撤销）` };
    if ((kind === CALL_BACKGROUND_REPLY_KIND && job.phase !== 'reply')
      || (kind === SLEEP_DREAM_KIND && job.phase !== 'dream')) {
      await discardJob(ctx.writeState, jobId);
      throw new Error(`通话后台 job ${jobId} 的任务种类与 phase 不一致`);
    }
    if (job.phase === 'dream' && job.autoHangupAt && job.autoHangupAt <= ctx.now.getTime()) {
      await discardJob(ctx.writeState, jobId);
      return { skip: true, reason: 'sleep-auto-hangup-reached' };
    }
    // 陪睡梦话沿用前台 25% 的机会，但在 Worker 决定，页面锁屏也不会因为 setTimeout
    // 停摆而把“是否说梦话”变成永远不触发。jobId 固定，所以重试不会重新抽到另一面。
    if (job.phase === 'dream' && (hash32(`${jobId}|${job.dreamIndex ?? 0}`) % 100) >= 25) {
      await discardJob(ctx.writeState, jobId);
      return { skip: true, reason: 'sleep-dream-chance-missed' };
    }
    return {
      messages: buildCallJobMessages(job),
      totalTimeoutMs: BACKGROUND_CALL_TIMEOUT_MS,
      state: { jobId, job } satisfies CallFireState,
    };
  },

  async llmOutput({ ctx, state }) {
    const { jobId, job } = state as CallFireState;
    const text = cleanGeneratedText(ctx.llmOutputText || '');
    if (!text) {
      await discardJob(ctx.writeState, jobId);
      return { decision: 'skip-push', reason: 'call-empty-generation' };
    }
    if (typeof ctx.emitResult !== 'function') {
      console.warn('[amsg:call] 当前 Worker 没有 emitResult，后台通话结果无法送回客户端', jobId);
      await discardJob(ctx.writeState, jobId);
      return { decision: 'skip-push', reason: 'call-emit-result-unsupported' };
    }
    const result = buildCallJobResult({ jobId, job, text, generatedAt: Date.now() });
    try {
      await ctx.emitResult({
        ...result,
        // 页面不可见时显示通知；页面仍在前台则由 active-msg-result 直接落库，不额外打扰。
        notification: {
          show: 'when-hidden',
          title: job.phase === 'dream' ? `${job.charName}说了梦话` : `${job.charName}的通话回复已生成`,
          body: previewText(text),
          // 每个梦话/回复各留一张提醒；只按 session+phase 会让第二句梦话把第一句通知
          // 静默替换掉，用户醒来后只知道“有过一次”，不知道有几条可以回听。
          tag: `amsg-call-${job.sessionId}-${job.phase}-${jobId}`,
          data: {
            openApp: 'call',
            charId: job.charId,
            sessionId: job.sessionId,
            resultKind: result.resultKind,
            jobId,
          },
        },
      });
    } catch (error) {
      // 结果写不进 outbox 时重试是有意义的；这条 job 输入保留给上游重试梯子。
      console.warn('[amsg:call] 结果没能写进收件箱，本轮让上游重试', jobId, error);
      throw error;
    }
    await discardJob(ctx.writeState, jobId);
    console.log('[amsg:call] 后台通话结果已送进收件箱', {
      jobId,
      charId: job.charId,
      sessionId: job.sessionId,
      resultKind: result.resultKind,
    });
    return { decision: 'skip-push', reason: 'call-result-emitted' };
  },
});

export const callReplyHandler = buildHandler(CALL_BACKGROUND_REPLY_KIND);
export const sleepDreamHandler = buildHandler(SLEEP_DREAM_KIND);

export type { KindFireCtx, KindSessionCtx };
