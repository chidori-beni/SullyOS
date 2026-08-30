import { afterEach, describe, expect, it } from 'vitest';
import { DB } from './db';

const NAME = '__test_sticker_front_vision__';

afterEach(async () => {
  await DB.deleteEmoji(NAME).catch(() => {});
});

describe('表情包排序与识图字段持久化', () => {
  it('同名同图换分组保留排序与识图缓存', async () => {
    await DB.saveEmoji(NAME, 'https://img.example.com/a.png', 'cat-a');
    await DB.updateEmoji(NAME, {
      movedToFrontAt: 123,
      visionDescription: '一只小狗挥手',
      visionRecognizedAt: 456,
      visionModel: 'vision-model',
    });

    await DB.saveEmoji(NAME, 'https://img.example.com/a.png', 'cat-b');
    const saved = (await DB.getEmojis()).find(item => item.name === NAME);

    expect(saved).toMatchObject({
      categoryId: 'cat-b',
      movedToFrontAt: 123,
      visionDescription: '一只小狗挥手',
      visionRecognizedAt: 456,
      visionModel: 'vision-model',
    });
  });

  it('同名换图时保留手动排序，但清掉旧图的识别结果', async () => {
    await DB.saveEmoji(NAME, 'https://img.example.com/old.png');
    await DB.updateEmoji(NAME, { movedToFrontAt: 789, visionDescription: '旧图描述' });

    await DB.saveEmoji(NAME, 'https://img.example.com/new.png');
    const saved = (await DB.getEmojis()).find(item => item.name === NAME);

    expect(saved?.movedToFrontAt).toBe(789);
    expect(saved?.visionDescription).toBeUndefined();
  });
});
