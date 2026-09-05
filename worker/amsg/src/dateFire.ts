/**
 * Worker 端的见面普通回复后台生成。
 *
 * 输入是浏览器提交的完整 prompt 快照，结果进入 AMSG2 result outbox；不走聊天正文
 * push，也不依赖浏览器仍然存活。
 */

import { stripReasoningTags } from '@rei-standard/amsg-shared';
import { AMSG_JOB_ID_KEY, AMSG_JOB_NAMESPACE } from '../../../utils/amsgTaskKinds';
import {
  DATE_BACKGROUND_REPLY_KIND,
  buildDateBackgroundJobResult,
  dateBackgroundJobKey,
  parseDateBackgroundJobInput,
  type DateBackgroundJobInput,
} from '../../../utils/amsgDateJob';
import { unpackStateValue } from '../../../utils/amsgFirePack';
import type { FireKindHandler, KindFireCtx, KindSessionCtx, KindWriteState } from './fireKinds';

const BACKGROUND_DATE_TIMEOUT_MS = 180_000;

export interface DateFireState {
  jobId: string;
  job: DateBackgroundJobInput;
}

const discardJob = async (writeState: KindWriteState | undefined, jobId: string): Promise<void> => {
  if (!writeState) return;
  try {
    await writeState(AMSG_JOB_NAMESPACE, [{ key: dateBackgroundJobKey(jobId), value: null }]);
  } catch (error) {
    // TTL 会兜底；不要因为清理失败让已经生成好的结果重新烧一遍模型。
    console.warn('[amsg:date] job 行没删掉（等 TTL 兜底）', jobId, error);
  }
};

const readDateJob = async (ctx: KindFireCtx, jobId: string): Promise<DateBackgroundJobInput | null> => {
  const rows = await ctx.readState(AMSG_JOB_NAMESPACE);
  const row = rows.find((entry) => entry.key === dateBackgroundJobKey(jobId));
  if (!row?.value) return null;
  let json: string;
  try {
    json = await unpackStateValue(row.value);
  } catch (error) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`见面后台 job ${jobId} 的输入解压失败（数据损坏）：${String(error)}`);
  }
  const job = parseDateBackgroundJobInput(json);
  if (!job) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`见面后台 job ${jobId} 的输入解析失败（数据损坏）`);
  }
  if (job.charId !== ctx.task.metadata?.charId) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`见面后台 job ${jobId} 的 charId 与任务对不上`);
  }
  return job;
};

const previewText = (text: string): string => {
  const singleLine = text
    .replace(/\[\[END_MEETING:[^\]]*\]\]/gi, '')
    .replace(/\[\[.*?\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return singleLine.length > 88 ? `${singleLine.slice(0, 88)}…` : singleLine;
};

export const dateReplyHandler: FireKindHandler = {
  async beforeFire({ ctx, taskMeta }) {
    const jobId = taskMeta[AMSG_JOB_ID_KEY];
    if (typeof jobId !== 'string' || !jobId) {
      throw new Error(`见面后台任务的 metadata 里没有 ${AMSG_JOB_ID_KEY}`);
    }
    const job = await readDateJob(ctx, jobId);
    if (!job) return { skip: true, reason: `见面后台 job ${jobId} 的输入已不在（过期或已撤销）` };
    if (job.kind !== DATE_BACKGROUND_REPLY_KIND || job.turnKind !== 'reply') {
      await discardJob(ctx.writeState, jobId);
      throw new Error(`见面后台 job ${jobId} 的任务种类或 turnKind 不一致`);
    }
    return {
      messages: job.messages,
      totalTimeoutMs: BACKGROUND_DATE_TIMEOUT_MS,
      state: { jobId, job } satisfies DateFireState,
    };
  },

  async llmOutput({ ctx, state }) {
    const { jobId, job } = state as DateFireState;
    const text = stripReasoningTags(ctx.llmOutputText || '').trim();
    if (!text) {
      await discardJob(ctx.writeState, jobId);
      return { decision: 'skip-push', reason: 'date-empty-generation' };
    }
    if (typeof ctx.emitResult !== 'function') {
      console.warn('[amsg:date] 当前 Worker 没有 emitResult，见面后台结果无法送回客户端', jobId);
      await discardJob(ctx.writeState, jobId);
      return { decision: 'skip-push', reason: 'date-emit-result-unsupported' };
    }

    const result = buildDateBackgroundJobResult({ job, text, generatedAt: Date.now() });
    try {
      await ctx.emitResult({
        ...result,
        notification: {
          show: 'when-hidden',
          title: `${job.charName}的见面回复已生成`,
          body: previewText(text) || '见面里有了新的回应。',
          tag: `amsg-date-${job.encounterId}-${jobId}`,
          data: {
            openApp: 'date',
            charId: job.charId,
            encounterId: job.encounterId,
            resultKind: result.resultKind,
            jobId,
          },
        },
      });
    } catch (error) {
      console.warn('[amsg:date] 结果没能写进收件箱，本轮让上游重试', jobId, error);
      throw error;
    }
    await discardJob(ctx.writeState, jobId);
    console.log('[amsg:date] 后台见面结果已送进收件箱', {
      jobId,
      charId: job.charId,
      encounterId: job.encounterId,
    });
    return { decision: 'skip-push', reason: 'date-result-emitted' };
  },
};

export type { KindFireCtx, KindSessionCtx };
