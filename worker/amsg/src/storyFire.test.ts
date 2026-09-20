import { describe, expect, it, vi } from 'vitest';
import { packStateValue } from '../../../utils/amsgFirePack';
import {
  STORY_BACKGROUND_REPLY_KIND,
  STORY_BACKGROUND_REPLY_RESULT_KIND,
  storyBackgroundJobKey,
  type StoryBackgroundJobInput,
} from '../../../utils/amsgStoryJob';
import { AMSG_JOB_ID_KEY, AMSG_JOB_NAMESPACE, AMSG_TASK_KIND_KEY } from '../../../utils/amsgTaskKinds';
import { storyReplyHandler } from './storyFire';

const JOB_ID = 'story-s-append-42-abcd';
const THREAD_ID = 'story-theater:s';
const job: StoryBackgroundJobInput = {
  v: 1,
  kind: STORY_BACKGROUND_REPLY_KIND,
  clientJobId: JOB_ID,
  storyId: 's',
  storyTitle: '夜航',
  threadId: THREAD_ID,
  charId: THREAD_ID,
  primaryCharId: 'char-1',
  primaryCharName: '小满',
  markerMessageId: 9,
  operation: 'append',
  turnKind: 'advance',
  sourceUserMessageId: 42,
  expectedTailId: 42,
  expectedTailRole: 'user',
  expectedTailFingerprint: 'tail',
  messages: [{ role: 'user', content: '继续。' }],
  assistantPrefill: '',
  promptTokenEstimate: 123,
  mirrorTargets: [],
  createdAt: 1000,
};

describe('Worker 剧情后台 handler', () => {
  it('使用冻结 prompt，并通过结果收件箱发始终显示、前台静音的通知', async () => {
    const readState = vi.fn(async (namespace: string) => namespace === AMSG_JOB_NAMESPACE
      ? [{ key: storyBackgroundJobKey(JOB_ID), value: await packStateValue(JSON.stringify(job)) }]
      : []);
    const writeState = vi.fn(async () => ({ upserted: 0, skipped: 0, deleted: 1 }));
    const before = await storyReplyHandler.beforeFire({
      ctx: {
        task: { id: 1, uuid: 'task-1', metadata: { charId: THREAD_ID } },
        readState,
        writeState,
        now: new Date('2026-09-05T08:00:00Z'),
        scratch: {},
      },
      charId: THREAD_ID,
      taskMeta: {
        [AMSG_TASK_KIND_KEY]: STORY_BACKGROUND_REPLY_KIND,
        [AMSG_JOB_ID_KEY]: JOB_ID,
      },
    });
    expect('messages' in before && before.messages).toEqual(job.messages);

    const emitResult = vi.fn(async () => ({ messageId: 'result-1', pushed: true }));
    const result = await storyReplyHandler.llmOutput({
      ctx: {
        llmOutputText: '<think>内部</think>新的正文。',
        emitResult,
        writeState,
      },
      state: { jobId: JOB_ID, job },
    });

    expect(result.decision).toBe('skip-push');
    expect(emitResult).toHaveBeenCalledTimes(1);
    const payload = (emitResult as any).mock.calls[0][0] as any;
    expect(payload.resultKind).toBe(STORY_BACKGROUND_REPLY_RESULT_KIND);
    expect(payload.text).toBe('新的正文。');
    expect(payload.notification).toMatchObject({ show: 'always', silent: 'when-visible' });
    expect(payload.notification.data).toMatchObject({
      openApp: 'date',
      surface: 'story',
      storyId: 's',
    });
    expect(writeState).toHaveBeenCalledWith(AMSG_JOB_NAMESPACE, [{ key: storyBackgroundJobKey(JOB_ID), value: null }]);
  });
});

