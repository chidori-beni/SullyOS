import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import {
  buildStoryBackgroundJobInput,
  buildStoryBackgroundJobResult,
} from './amsgStoryJob';
import { applyStoryBackgroundResult, fingerprintStoryText } from './storyBackgroundJobs';

const STORY_ID = 'story-background-test';
const THREAD_ID = `story-theater:${STORY_ID}`;

const entry = {
  id: STORY_ID,
  title: '夜航',
  premise: '',
  openingMode: 'user',
  mask: { type: 'user' },
  characterIds: ['char-story-test'],
  writesToCharacterMemory: false,
  characterMemoryDates: {},
  carryCharacterMemory: false,
  characterContextLimits: {},
  archiveAfter: 40,
  archiveKeepRecent: 5,
  archiveStrategy: 'summary',
  archives: [],
  selectedWorldbookIds: [],
  forceUserLastMessage: false,
  omitSamplingParams: false,
  createdAt: 1000,
  updatedAt: 1000,
} as any;

describe('剧情后台结果桥', () => {
  beforeEach(async () => {
    await DB.deleteDB();
    await DB.saveStoryTheater(entry);
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    localStorage.clear();
  });

  afterEach(async () => {
    await DB.deleteDB();
    vi.unstubAllGlobals();
  });

  it('在同一剧情尾部写入正文并销毁隐藏 marker，重复结果只落一份', async () => {
    const userId = await DB.saveMessage({
      charId: THREAD_ID,
      role: 'user',
      type: 'text',
      content: '我推开门。',
      metadata: { source: 'story_theater', theaterId: STORY_ID },
      timestamp: 2000,
    });
    const markerId = await DB.saveMessage({
      charId: THREAD_ID,
      role: 'system',
      type: 'system',
      content: '',
      timestamp: 2001,
      metadata: { source: 'story_theater_background_job', storyBackgroundClientJobId: 'story-test-job' },
    });
    const job = buildStoryBackgroundJobInput({
      clientJobId: 'story-test-job',
      storyId: STORY_ID,
      storyTitle: '夜航',
      threadId: THREAD_ID,
      primaryCharId: 'char-story-test',
      primaryCharName: '小满',
      markerMessageId: markerId,
      operation: 'append',
      turnKind: 'advance',
      sourceUserMessageId: userId,
      expectedTailId: userId,
      expectedTailRole: 'user',
      expectedTailFingerprint: fingerprintStoryText('我推开门。'),
      messages: [{ role: 'user', content: '我推开门。' }],
      promptTokenEstimate: 20,
      mirrorTargets: [],
      createdAt: 2001,
    });
    const result = buildStoryBackgroundJobResult({ job, text: '灯亮了。', generatedAt: 3000 });

    await expect(applyStoryBackgroundResult(result)).resolves.toBe(true);
    await expect(applyStoryBackgroundResult(result)).resolves.toBe(true);
    const rows = (await DB.getMessagesByCharId(THREAD_ID, true)).sort((a, b) => a.id - b.id);
    expect(rows.filter(row => row.metadata?.source === 'story_theater')).toHaveLength(2);
    expect(rows.find(row => row.role === 'assistant')?.content).toBe('灯亮了。');
    expect(rows.some(row => row.id === markerId)).toBe(false);
  });

  it('取消墓碑会吞掉迟到结果，并在重复收件时仍可销账', async () => {
    const userId = await DB.saveMessage({
      charId: THREAD_ID,
      role: 'user',
      type: 'text',
      content: '我停在门口。',
      metadata: { source: 'story_theater', theaterId: STORY_ID },
      timestamp: 2000,
    });
    const markerId = await DB.saveMessage({
      charId: THREAD_ID,
      role: 'system',
      type: 'system',
      content: '',
      timestamp: 2001,
      metadata: {
        source: 'story_theater_background_job',
        storyBackgroundClientJobId: 'story-cancelled-job',
        storyBackgroundJobState: 'canceled',
      },
    });
    const job = buildStoryBackgroundJobInput({
      clientJobId: 'story-cancelled-job',
      storyId: STORY_ID,
      storyTitle: '夜航',
      threadId: THREAD_ID,
      primaryCharId: 'char-story-test',
      primaryCharName: '小满',
      markerMessageId: markerId,
      operation: 'append',
      turnKind: 'advance',
      sourceUserMessageId: userId,
      expectedTailId: userId,
      expectedTailRole: 'user',
      expectedTailFingerprint: fingerprintStoryText('我停在门口。'),
      messages: [{ role: 'user', content: '我停在门口。' }],
      promptTokenEstimate: 20,
      mirrorTargets: [],
      createdAt: 2001,
    });
    const result = buildStoryBackgroundJobResult({ job, text: '门后传来脚步声。', generatedAt: 3000 });

    await expect(applyStoryBackgroundResult(result)).resolves.toBe(true);
    await expect(applyStoryBackgroundResult(result)).resolves.toBe(true);
    const rows = (await DB.getMessagesByCharId(THREAD_ID, true)).sort((a, b) => a.id - b.id);
    expect(rows.filter(row => row.role === 'assistant')).toHaveLength(0);
    expect(rows.find(row => row.id === markerId)?.metadata?.storyBackgroundJobState).toBe('canceled');
  });
});

