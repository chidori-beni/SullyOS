import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';
const categories = [
  ['groupChats', '群聊资料'],
  ['posts', '动态帖子'],
  ['courses', '学习课程'],
  ['games', '游戏记录'],
  ['worldbooks', '世界书'],
  ['theaters', '剧情剧场'],
  ['theaterPresets', '剧情预设'],
  ['masks', '剧场面具箱'],
  ['novels', '小说'],
  ['vrNovels', '彼方小说库'],
  ['annotations', '彼方批注'],
  ['creatorParts', '捏脸自定义部件'],
  ['chatThemes', '聊天主题'], ['emojis', '表情包'], ['emojiCategories', '表情分类'], ['assets', '系统资源'], ['favorites', '聊天收藏'], ['journalStickers', '日记贴纸'],
  ['galleryAlbums', '相册分类'], ['galleryOrder', '相册分类顺序'], ['galleryImages', '相册图片'], ['diaries', '日记'], ['tasks', '任务'], ['anniversaries', '纪念日'], ['roomTodos', '房间待办'], ['roomNotes', '房间便签'],
] as const;
const source = readFileSync(resolve(process.cwd(), 'utils/db.ts'), 'utf8');
it.each(categories)('adds explicit display marker while keeping label: %s', (key, label) => {
  expect(source).toContain(`await runSection('${label}'`);
  expect(source).toContain(`key: 'settings.importDb.${key}'`);
  expect(translateUi('zh-CN', `settings.importDb.${key}`)).toBe(label);
  expect(translateUi('ja-JP', `settings.importDb.${key}`)).not.toBe(label);
});
it('keeps the complete database module identical apart from the six display arguments', () => {
  const baseline = execFileSync('git', ['show', 'HEAD:utils/db.ts'], { encoding: 'utf8' }).replace(/\r/g, '');
  let actual = source.replace(/\r/g, '');
  for (const [key] of categories) {
    const addition = `${key === 'favorites' ? ', undefined' : ''}, { key: 'settings.importDb.${key}' }`;
    if (!baseline.includes(addition)) actual = actual.replace(addition, '');
  }
  expect(actual).toBe(baseline);
});
