import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { translateUi } from './uiLocale';
const categories = [
  ['songs', '歌曲'],
  ['quiz', '练习本'],
  ['guidebook', '攻略本'],
  ['scheduled', '定时消息'],
  ['lifeSim', '人生模拟'],
  ['bankTx', '银行流水'],
  ['xhsActivities', '小红书活动'],
  ['xhsOwned', '角色小红书主页'],
  ['xhsImages', '小红书图库'],
  ['memoryNodes', '记忆节点'],
  ['memoryVectors', '记忆向量'],
  ['memoryLinks', '记忆关系'],
  ['topics', '话题盒'],
  ['anticipations', '期待事项'],
  ['events', '事件盒'],
  ['plates', '房间门牌'],
  ['digests', '消化日志'],
  ['batches', '记忆批次'],
  ['dailySchedules', '每日程'],
  ['handbooks', '手账'],
  ['trackers', '打卡项目'],
  ['trackerEntries', '打卡记录'],
  ['lifeRecords', '生活记录'],
  ['medPlans', '药盒计划'],
  ['lifeSettings', '生活记录设置'],
  ['hotNews', '热点快照'],
  ['pixelAssets', '像素小屋素材'],
  ['pixelLayouts', '像素小屋布局'],
  ['user', '用户资料'],
  ['bank', '银行状态'],
  ['musicRoom', '听歌房'],
  ['guestbook', '留言簿'],
  ['scripts', '剧院剧本'],
  ['plays', '历史舞台剧'],
  ['vrPresets', '剧院预设'],
  ['letters', '邮局信件'],
  ['vrSettings', '彼方设置'],
  ['postOffice', '邮局身份'],
  ['signal', '信号坠落处'],
  ['worlds', '家园世界'],
  ['episodes', '家园演绎历史'],
  ['homeLocal', '家园本机配置'],
  ['luckin', '瑞幸配置'],
  ['mcd', '麦当劳配置'],
  ['home3d', '3D 家园本机偏好'],
  ['mcp', 'MCP 服务器配置'],
  ['amsg', '主动消息配置'],
  ['skin', '桌面皮肤偏好'],
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
    const addition = `${key === 'favorites' || key === 'home3d' ? ', undefined' : ''}, { key: 'settings.importDb.${key}' }`;
    if (!baseline.includes(addition)) actual = actual.replace(addition, '');
  }
  expect(actual).toBe(baseline);
});
