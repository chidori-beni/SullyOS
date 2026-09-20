/**
 * Worker 端的【见面·剧情】后台回复。
 *
 * 这条 handler 不写聊天正文，也不依赖浏览器仍然开着；它只读取浏览器提交的完整
 * prompt 快照，调用 AMSG2 当前配置的 LLM，再把纯正文放进 result outbox。
 */

import { stripReasoningTags } from '@rei-standard/amsg-shared';
import { AMSG_JOB_ID_KEY, AMSG_JOB_NAMESPACE } from '../../../utils/amsgTaskKinds';
import {
  STORY_BACKGROUND_REPLY_KIND,
  buildStoryBackgroundJobResult,
  parseStoryBackgroundJobInput,
  storyBackgroundJobKey,
  type StoryBackgroundJobInput,
} from '../../../utils/amsgStoryJob';
import { unpackStateValue } from '../../../utils/amsgFirePack';
import type { FireKindHandler, KindFireCtx, KindSessionCtx, KindWriteState } from './fireKinds';

const BACKGROUND_STORY_TIMEOUT_MS = 180_000;

export interface StoryFireState {
  jobId: string;
  job: StoryBackgroundJobInput;
}

const discardJob = async (writeState: KindWriteState | undefined, jobId: string): Promise<void> => {
  if (!writeState) return;
  try {
    await writeState(AMSG_JOB_NAMESPACE, [{ key: storyBackgroundJobKey(jobId), value: null }]);
  } catch (error) {
    // TTL 会兜底；不要因为已经生成好的结果清理失败而重跑模型。
    console.warn('[amsg:story] job 行没删掉（等 TTL 兜底）', jobId, error);
  }
};

const readStoryJob = async (ctx: KindFireCtx, jobId: string): Promise<StoryBackgroundJobInput | null> => {
  const rows = await ctx.readState(AMSG_JOB_NAMESPACE);
  const row = rows.find(entry => entry.key === storyBackgroundJobKey(jobId));
  if (!row?.value) return null;
  let json: string;
  try {
    json = await unpackStateValue(row.value);
  } catch (error) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`剧情后台 job ${jobId} 的输入解压失败（数据损坏）：${String(error)}`);
  }
  const job = parseStoryBackgroundJobInput(json);
  if (!job) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`剧情后台 job ${jobId} 的输入解析失败（数据损坏）`);
  }
  if (job.charId !== ctx.task.metadata?.charId) {
    await discardJob(ctx.writeState, jobId);
    throw new Error(`剧情后台 job ${jobId} 的 charId 与任务对不上`);
  }
  return job;
};

const previewText = (text: string): string => {
  const singleLine = text
    .replace(/<think(?:ing|ought)?\b[^>]*>[\s\S]*?<\/think(?:ing|ought)?\s*>/gi, '')
    .replace(/\[\[.*?\]\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return singleLine.length > 88 ? `${singleLine.slice(0, 88)}…` : singleLine;
};

export const storyReplyHandler: FireKindHandler = {
  async beforeFire({ ctx, taskMeta }) {
    const jobId = taskMeta[AMSG_JOB_ID_KEY];
    if (typeof jobId !== 'string' || !jobId) {
      throw new Error(`剧情后台任务的 metadata 里没有 ${AMSG_JOB_ID_KEY}`);
    }
    const job = await readStoryJob(ctx, jobId);
    if (!job) return { skip: true, reason: `剧情后台 job ${jobId} 的输入已不在（过期或已撤销）` };
    if (job.kind !== STORY_BACKGROUND_REPLY_KIND) {
      await discardJob(ctx.writeState, jobId);
      throw new Error(`剧情后台 job ${jobId} 的任务种类不一致`);
    }
    return {
      messages: job.messages,
      totalTimeoutMs: BACKGROUND_STORY_TIMEOUT_MS,
      state: { jobId, job } satisfies StoryFireState,
    };
  },

  async llmOutput({ ctx, state }) {
    const { jobId, job } = state as StoryFireState;
    const text = stripReasoningTags(ctx.llmOutputText || '').trim();
    if (!text) {
      await discardJob(ctx.writeState, jobId);
      return { decision: 'skip-push', reason: 'story-empty-generation' };
    }
    if (typeof ctx.emitResult !== 'function') {
      console.warn('[amsg:story] 当前 Worker 没有 emitResult，剧情后台结果无法送回客户端', jobId);
      await discardJob(ctx.writeState, jobId);
      return { decision: 'skip-push', reason: 'story-emit-result-unsupported' };
    }

    const result = buildStoryBackgroundJobResult({ job, text, generatedAt: Date.now() });
    try {
      await ctx.emitResult({
        ...result,
        notification: {
          // 剧情后台生成完成是用户明确等待的结果：无论 PWA 当前是否在前台，
          // 都要进系统通知栏；前台时静音，避免用户正盯着剧情页却被自己吓一跳。
          show: 'always',
          silent: 'when-visible',
          title: '剧情回复已生成',
          body: previewText(text) || '剧情里有了新的回应。',
          tag: `amsg-story-${job.storyId}-${jobId}`,
          data: {
            openApp: 'date',
            surface: 'story',
            storyId: job.storyId,
            resultKind: result.resultKind,
            jobId,
          },
        },
      });
    } catch (error) {
      console.warn('[amsg:story] 结果没能写进收件箱，本轮让上游重试', jobId, error);
      throw error;
    }
    await discardJob(ctx.writeState, jobId);
    console.log('[amsg:story] 后台剧情结果已送进收件箱', {
      jobId,
      storyId: job.storyId,
    });
    return { decision: 'skip-push', reason: 'story-result-emitted' };
  },
};

