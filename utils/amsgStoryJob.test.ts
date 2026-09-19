import { describe, expect, it } from 'vitest';
import {
  buildStoryBackgroundJobInput,
  buildStoryBackgroundJobResult,
  parseStoryBackgroundJobInput,
  parseStoryBackgroundJobResult,
} from './amsgStoryJob';

const input = buildStoryBackgroundJobInput({
  clientJobId: 'story-s-append-42-abcd',
  storyId: 's',
  storyTitle: '夜航',
  threadId: 'story-theater:s',
  primaryCharId: 'char-1',
  primaryCharName: '小满',
  markerMessageId: 9,
  operation: 'append',
  turnKind: 'advance',
  sourceUserMessageId: 42,
  expectedTailId: 42,
  expectedTailRole: 'user',
  expectedTailFingerprint: 'tail',
  messages: [
    { role: 'system', content: '系统设定' },
    { role: 'user', content: '继续。' },
  ],
  assistantPrefill: '【正文】',
  promptTokenEstimate: 1234,
  mirrorTargets: [{ charId: 'char-1', entryCreatedAt: 1000 }],
  temperature: 0.7,
  maxTokens: 1200,
  extraBody: { top_p: 0.9, ignored: 'nope' },
  createdAt: 2000,
});

describe('story background job contract', () => {
  it('保留输入快照并过滤未允许的采样字段', () => {
    const parsed = parseStoryBackgroundJobInput(JSON.stringify(input));
    expect(parsed).toEqual(expect.objectContaining({
      kind: 'story-reply',
      charId: 'story-theater:s',
      markerMessageId: 9,
      messages: input.messages,
      extraBody: { top_p: 0.9 },
    }));
  });

  it('结果不携带完整 prompt 也能解析', () => {
    const result = buildStoryBackgroundJobResult({ job: input, text: '新的正文', generatedAt: 3000 });
    expect(result).not.toHaveProperty('messages');
    expect(parseStoryBackgroundJobResult(result)).toEqual(expect.objectContaining({
      resultKind: 'story-reply',
      text: '新的正文',
      generatedAt: 3000,
      markerMessageId: 9,
    }));
  });

  it('拒绝没有 prompt 消息的输入', () => {
    expect(parseStoryBackgroundJobInput({ ...input, messages: [] })).toBeNull();
  });
});

