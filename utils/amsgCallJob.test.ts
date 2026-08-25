import { describe, expect, it } from 'vitest';
import {
  CALL_BACKGROUND_REPLY_RESULT_KIND,
  SLEEP_DREAM_RESULT_KIND,
  buildCallJobResult,
  parseCallJobInput,
  parseCallJobResult,
  type CallJobInput,
} from './amsgCallJob';

const job: CallJobInput = {
  v: 1,
  charId: 'char-1',
  charName: '小鹿',
  sessionId: 'call-1',
  callMode: 'voice',
  phase: 'dream',
  systemPrompt: '你正在通话。',
  messages: [{ role: 'user', content: '（梦话指令）' }],
  autoHangupAt: null,
  dreamIndex: 0,
  createdAt: 1,
};

describe('通话后台任务契约', () => {
  it('job/result 可以跨浏览器与 Worker 往返', () => {
    expect(parseCallJobInput(JSON.stringify(job))).toEqual(job);
    const result = buildCallJobResult({ jobId: 'job-1', job, text: '唔……别走。', generatedAt: 2 });
    expect(result.resultKind).toBe(SLEEP_DREAM_RESULT_KIND);
    expect(parseCallJobResult(result)).toEqual(result);
  });

  it('普通回复 result 使用 call-reply kind，并拒绝坏形状', () => {
    const reply = buildCallJobResult({
      jobId: 'job-2',
      job: { ...job, phase: 'reply', sourceUserMessageId: 7 },
      text: '我在，听见了。',
    });
    expect(reply.resultKind).toBe(CALL_BACKGROUND_REPLY_RESULT_KIND);
    expect(parseCallJobResult(reply)?.sourceUserMessageId).toBe(7);
    expect(parseCallJobResult({ ...reply, text: '   ' })).toBeNull();
    expect(parseCallJobInput({ ...job, messages: [] })).toBeNull();
  });
});

