import { describe, expect, it, vi } from 'vitest';
import { packStateValue } from '../../../utils/amsgFirePack';
import {
  DATE_BACKGROUND_REPLY_KIND,
  DATE_BACKGROUND_REPLY_RESULT_KIND,
  dateBackgroundJobKey,
  type DateBackgroundJobInput,
} from '../../../utils/amsgDateJob';
import { AMSG_JOB_ID_KEY, AMSG_JOB_NAMESPACE, AMSG_TASK_KIND_KEY } from '../../../utils/amsgTaskKinds';
import { dateReplyHandler } from './dateFire';

const JOB_ID = 'date-encounter-1-42';
const CHAR_ID = 'char-1';
const ENCOUNTER_ID = 'encounter-1';
const job: DateBackgroundJobInput = {
  v: 1,
  kind: DATE_BACKGROUND_REPLY_KIND,
  turnKind: 'reply',
  clientJobId: JOB_ID,
  charId: CHAR_ID,
  charName: '小鹿',
  encounterId: ENCOUNTER_ID,
  encounterStartedAt: 1_000,
  sourceUserMessageId: 42,
  sceneClockAt: 2_000,
  sceneClockAdvancedMs: 0,
  sceneClockRevision: 3,
  messages: [{ role: 'user', content: '我回来了。' }],
  createdAt: 1_500,
};

describe('Worker 见面后台 handler', () => {
  it('使用冻结 prompt，并通过结果收件箱发 when-hidden 通知', async () => {
    const readState = vi.fn(async (namespace: string) => namespace === AMSG_JOB_NAMESPACE
      ? [{ key: dateBackgroundJobKey(JOB_ID), value: await packStateValue(JSON.stringify(job)) }]
      : []);
    const writeState = vi.fn(async () => ({ upserted: 0, skipped: 0, deleted: 1 }));
    const before = await dateReplyHandler.beforeFire({
      ctx: {
        task: {
          id: 1,
          uuid: 'task-1',
          metadata: { charId: CHAR_ID },
        },
        readState,
        writeState,
        now: new Date('2026-09-05T08:00:00Z'),
        scratch: {},
      },
      charId: CHAR_ID,
      taskMeta: {
        [AMSG_TASK_KIND_KEY]: DATE_BACKGROUND_REPLY_KIND,
        [AMSG_JOB_ID_KEY]: JOB_ID,
      },
    });
    expect('messages' in before && before.messages).toEqual(job.messages);

    const emitResult = vi.fn(async () => ({ messageId: 'result-1', pushed: true }));
    const result = await dateReplyHandler.llmOutput({
      ctx: {
        llmOutputText: '<think>内部</think>我在，听见了。',
        emitResult,
        writeState,
      },
      state: { jobId: JOB_ID, job },
    });

    expect(result.decision).toBe('skip-push');
    expect(emitResult).toHaveBeenCalledTimes(1);
    const payload = (emitResult as any).mock.calls[0][0] as any;
    expect(payload.resultKind).toBe(DATE_BACKGROUND_REPLY_RESULT_KIND);
    expect(payload.text).toContain('我在');
    expect(payload.notification).toMatchObject({ show: 'when-hidden' });
    expect(payload.notification.data).toMatchObject({
      openApp: 'date',
      charId: CHAR_ID,
      encounterId: ENCOUNTER_ID,
    });
    expect(writeState).toHaveBeenCalledWith(AMSG_JOB_NAMESPACE, [{ key: dateBackgroundJobKey(JOB_ID), value: null }]);
  });
});
