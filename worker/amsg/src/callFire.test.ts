import { describe, expect, it, vi } from 'vitest';
import { packStateValue } from '../../../utils/amsgFirePack';
import {
  CALL_BACKGROUND_REPLY_KIND,
  CALL_BACKGROUND_REPLY_RESULT_KIND,
  callJobKey,
  type CallJobInput,
} from '../../../utils/amsgCallJob';
import { AMSG_JOB_ID_KEY, AMSG_JOB_NAMESPACE, AMSG_TASK_KIND_KEY } from '../../../utils/amsgTaskKinds';
import { callReplyHandler } from './callFire';

const JOB_ID = 'call-job-1';
const CHAR_ID = 'char-1';
const job: CallJobInput = {
  v: 1,
  charId: CHAR_ID,
  charName: '小鹿',
  sessionId: 'call-1',
  callMode: 'voice',
  phase: 'reply',
  systemPrompt: '你正在通话。',
  messages: [{ role: 'user', content: '我回来了。' }],
  sourceUserMessageId: 12,
  createdAt: Date.now(),
};

describe('Worker 通话后台 handler', () => {
  it('绕过聊天专用 fire_pack，生成后通过 emitResult + 通知送回客户端', async () => {
    const readState = vi.fn(async (namespace: string) => namespace === AMSG_JOB_NAMESPACE
      ? [{ key: callJobKey(JOB_ID), value: await packStateValue(JSON.stringify(job)) }]
      : []);
    const writeState = vi.fn(async () => ({ upserted: 0, skipped: 0, deleted: 1 }));
    const before = await callReplyHandler.beforeFire({
      ctx: {
        task: {
          id: 1,
          uuid: 'task-1',
          metadata: {
            charId: CHAR_ID,
            [AMSG_TASK_KIND_KEY]: CALL_BACKGROUND_REPLY_KIND,
            [AMSG_JOB_ID_KEY]: JOB_ID,
          },
        },
        readState,
        writeState,
        now: new Date('2026-08-25T08:00:00Z'),
        scratch: {},
      },
      charId: CHAR_ID,
      taskMeta: {
        [AMSG_TASK_KIND_KEY]: CALL_BACKGROUND_REPLY_KIND,
        [AMSG_JOB_ID_KEY]: JOB_ID,
      },
    });
    expect('messages' in before && before.messages).toEqual([
      { role: 'system', content: job.systemPrompt },
      ...job.messages,
    ]);
    const emitResult = vi.fn(async () => ({ messageId: 'result-1', pushed: true }));
    const result = await callReplyHandler.llmOutput({
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
    expect(payload.resultKind).toBe(CALL_BACKGROUND_REPLY_RESULT_KIND);
    expect(payload.text).toContain('我在');
    expect(payload.notification).toMatchObject({ show: 'when-hidden' });
    expect(payload.notification.data).toMatchObject({ charId: CHAR_ID, sessionId: 'call-1' });
    expect(writeState).toHaveBeenCalledWith(AMSG_JOB_NAMESPACE, [{ key: callJobKey(JOB_ID), value: null }]);
  });

  it('系统通知正文不会泄露视频演出指令', async () => {
    const writeState = vi.fn(async () => ({ upserted: 0, skipped: 0, deleted: 1 }));
    const emitResult = vi.fn(async () => ({ messageId: 'result-2', pushed: true }));
    await callReplyHandler.llmOutput({
      ctx: {
        llmOutputText: '[[AVATAR: emotion=relaxed; face=grin; gesture=lean-in]]\n别急，我陪你慢慢吃。',
        emitResult,
        writeState,
      },
      state: { jobId: JOB_ID, job },
    });
    const payload = (emitResult as any).mock.calls[0][0] as any;
    expect(payload.text).toContain('AVATAR');
    expect(payload.notification.body).toBe('别急，我陪你慢慢吃。');
  });
});
