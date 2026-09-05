import { describe, expect, it } from 'vitest';
import {
  buildDateBackgroundJobInput,
  buildDateBackgroundJobResult,
  dateBackgroundJobKey,
  parseDateBackgroundJobInput,
  parseDateBackgroundJobResult,
} from './amsgDateJob';

describe('见面后台回复契约', () => {
  const job = buildDateBackgroundJobInput({
    clientJobId: 'date-enc-42',
    charId: 'char-1',
    charName: '小满',
    encounterId: 'enc-1',
    encounterStartedAt: 1_700_000_000_000,
    sourceUserMessageId: 42,
    sceneClockAt: 1_700_000_000_000,
    sceneClockAdvancedMs: 0,
    sceneClockRevision: 3,
    messages: [
      { role: 'system', content: '你是角色。' },
      { role: 'user', content: '我来了。' },
    ],
    createdAt: 1_700_000_000_100,
  });

  it('生成并解析版本化输入，job key 稳定', () => {
    expect(dateBackgroundJobKey(job.clientJobId)).toBe('date:date-enc-42');
    expect(parseDateBackgroundJobInput(JSON.stringify(job))).toEqual(job);
  });

  it('拒绝缺少消息或不可校验字段的输入', () => {
    expect(parseDateBackgroundJobInput({ ...job, messages: [] })).toBeNull();
    expect(parseDateBackgroundJobInput({ ...job, sourceUserMessageId: '42' })).toBeNull();
  });

  it('结果保留 encounter、时钟和源消息锚点', () => {
    const result = buildDateBackgroundJobResult({ job, text: '[normal] 回来了。', generatedAt: 1_700_000_000_200 });
    expect(parseDateBackgroundJobResult(result)).toEqual({
      ...result,
      resultKind: 'date-reply',
    });
  });
});
