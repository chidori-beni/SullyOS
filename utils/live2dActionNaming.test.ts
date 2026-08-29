import { describe, expect, it } from 'vitest';
import {
  live2dActionDisplayName,
  live2dActionEmotionKey,
  live2dActionMatchKey,
  live2dActionRenamed,
  live2dActionSetName,
  groupLive2DActionsBySet,
  parseLive2DActionName,
  resolveLive2DActionByKey,
} from './live2dActionNaming';

describe('live2dActionDisplayName', () => {
  it('lets the pinyin stem override a wrong hand-written Chinese suffix', () => {
    // 这一组正是把用户坑住的：私服素材里 13 条不同表情全被标成了「微笑」。
    expect(live2dActionDisplayName('X_huaixiao_微笑')).toBe('坏笑');
    expect(live2dActionDisplayName('X_tiaoxiao_微笑')).toBe('调笑');
    expect(live2dActionDisplayName('X_tiaokan_微笑')).toBe('调侃');
    expect(live2dActionDisplayName('X_wenrou_idle_微笑')).toBe('温柔（持续）');
    expect(live2dActionDisplayName('X_wangtiansikaoxiao_微笑')).toBe('望天思考笑');
    expect(live2dActionDisplayName('X_sikao_idle_困惑')).toBe('思考（持续）');
    expect(live2dActionDisplayName('X_zhoumei_idle_困惑')).toBe('皱眉（持续）');
    expect(live2dActionDisplayName('X_beishang_idle_难过')).toBe('悲伤（持续）');
    expect(live2dActionDisplayName('X_fzzhoumeixianqi_气恼')).toBe('皱眉嫌弃');
  });

  it('matches the longest stem so xiao never swallows huaixiao / weixiao', () => {
    expect(live2dActionDisplayName('X_xiao')).toBe('笑');
    expect(live2dActionDisplayName('X_huaixiao')).toBe('坏笑');
    expect(live2dActionDisplayName('X_weixiao')).toBe('微笑');
    expect(live2dActionDisplayName('X_tiaoxiao')).toBe('调笑');
    expect(live2dActionDisplayName('X_wangtiansikaoxiao2')).toBe('望天思考笑 2');
  });

  it('reads variant numbers, idle loops and moving idles', () => {
    expect(live2dActionDisplayName('X_huaixiao3_idle_微笑')).toBe('坏笑 3（持续）');
    expect(live2dActionDisplayName('X_chijing2_idle')).toBe('吃惊 2（持续）');
    expect(live2dActionDisplayName('X_weixiao_idle_move')).toBe('微笑（持续·移动）');
    // idle 可以出现在中间：X_11024_06_idle_温柔
    expect(live2dActionDisplayName('X_11024_06_idle_温柔')).toBe('温柔（持续）');
  });

  it('strips scene and numeric prefixes from the other outfit’s naming scheme', () => {
    // 衬衫外套那套是纯拼音 + fanshu/编号前缀，完全没有中文。
    expect(live2dActionDisplayName('X_02_haixiu_idle')).toBe('害羞（持续）');
    expect(live2dActionDisplayName('X_fanshu01_huaixiao3_idle')).toBe('坏笑 3（持续）');
    expect(live2dActionDisplayName('X_fanshu02_zhoumei')).toBe('皱眉');
    expect(live2dActionDisplayName('X_03_weixiao_idle copy')).toBe('微笑（持续）');
  });

  it('keeps body-action qualifiers instead of dropping them', () => {
    expect(live2dActionDisplayName('X_11022_08_摇头_微笑')).toBe('微笑 · 摇头');
    expect(live2dActionDisplayName('X_11024_16_凑近_调笑')).toBe('调笑 · 凑近');
  });

  it('keeps every Chinese word when there is no pinyin to trust', () => {
    // 纯编号命名时中文是唯一线索，不能只留第一个词。
    expect(live2dActionDisplayName('X_11024_05_微笑_淡定')).toBe('微笑 · 淡定');
    expect(live2dActionDisplayName('X_11026_16_惊讶_点头_微笑')).toBe('惊讶 · 点头 微笑');
  });

  it('never invents a name it cannot justify', () => {
    expect(live2dActionDisplayName('X_idle')).toBe('X_idle');
    expect(live2dActionDisplayName('SomeVendorMotion_07')).toBe('SomeVendorMotion_07');
    expect(live2dActionDisplayName('')).toBe('');
    expect(live2dActionRenamed('X_idle')).toBe(false);
    expect(live2dActionRenamed('X_huaixiao_微笑')).toBe(true);
  });

  it('exposes the parse so callers can reason about idle variants', () => {
    const parsed = parseLive2DActionName('X_fanshu01_huaixiao3_idle');
    expect(parsed.emotion).toBe('坏笑');
    expect(parsed.variant).toBe(3);
    expect(parsed.idle).toBe(true);
    expect(parsed.moving).toBe(false);
  });
});

describe('cross-outfit action matching', () => {
  // 同一角色两套衣服的真实命名：私服带（错的）中文后缀，衬衫是纯拼音带场景前缀。
  const 私服 = [
    { id: 'motion-0', rawName: 'X_huaixiao3_idle_微笑' },
    { id: 'motion-1', rawName: 'X_tiaoxiao_微笑' },
    { id: 'motion-2', rawName: 'X_11022_04_淡定' },
    { id: 'motion-3', rawName: 'X_wenrou_idle_微笑' },
  ];
  const 衬衫 = [
    { id: 'motion-0', rawName: 'X_02_aishang_idle' },
    { id: 'motion-1', rawName: 'X_fanshu01_huaixiao3_idle' },
    { id: 'motion-2', rawName: 'X_tiaoxiao' },
    { id: 'motion-3', rawName: 'X_03_wenrou_idle' },
  ];

  it('gives the same key to the same motion across two naming schemes', () => {
    // 这正是跨衣橱能自动接上的原因：错标的中文被拼音覆盖后，两边算出同一个键。
    expect(live2dActionMatchKey('X_huaixiao3_idle_微笑'))
      .toBe(live2dActionMatchKey('X_fanshu01_huaixiao3_idle'));
    expect(live2dActionMatchKey('X_wenrou_idle_微笑'))
      .toBe(live2dActionMatchKey('X_03_wenrou_idle'));
  });

  it('separates variant and idle so 坏笑3 never silently becomes 坏笑2', () => {
    expect(live2dActionMatchKey('X_huaixiao3_idle')).not.toBe(live2dActionMatchKey('X_huaixiao2_idle'));
    expect(live2dActionMatchKey('X_huaixiao_idle')).not.toBe(live2dActionMatchKey('X_huaixiao'));
    expect(live2dActionEmotionKey('X_huaixiao3_idle')).toBe(live2dActionEmotionKey('X_huaixiao2'));
  });

  it('carries an action over to the other outfit when it exists there', () => {
    const match = resolveLive2DActionByKey(live2dActionMatchKey('X_huaixiao3_idle_微笑'), 衬衫);
    expect(match.tier).toBe('exact');
    expect(match.id).toBe('motion-1');
    // 位置序号完全不同——这就是不能按 ID 搬的原因。
    expect(match.id).not.toBe('motion-0');
  });

  it('falls back to the same emotion and reports it as approximate', () => {
    const match = resolveLive2DActionByKey(live2dActionMatchKey('X_tiaoxiao_idle'), 衬衫);
    expect(match.tier).toBe('similar');
    expect(match.rawName).toBe('X_tiaoxiao');
  });

  it('reports none when this outfit simply has no such motion', () => {
    // 「淡定」只有私服有。
    const match = resolveLive2DActionByKey(live2dActionMatchKey('X_11022_04_淡定'), 衬衫);
    expect(match.tier).toBe('none');
    expect(match.id).toBe('');
  });

  it('still matches identical raw names when the pinyin is unrecognized', () => {
    const key = live2dActionMatchKey('VendorMotion_07');
    expect(key).toBe('raw:VendorMotion_07');
    expect(resolveLive2DActionByKey(key, [{ id: 'motion-9', rawName: 'VendorMotion_07' }]).tier).toBe('exact');
    expect(resolveLive2DActionByKey(key, 衬衫).tier).toBe('none');
  });

  it('treats a missing key as unresolved rather than guessing', () => {
    expect(resolveLive2DActionByKey(undefined, 私服).tier).toBe('none');
    expect(resolveLive2DActionByKey('', 私服).id).toBe('');
  });
});

describe('scene / pose set markers', () => {
  it('extracts the leading set marker from both naming schemes', () => {
    // 私服是剧情编号，衬衫是 fanshu 套系；两者都表示「这条出自哪套姿势」。
    expect(live2dActionSetName('X_11024_06_idle_温柔')).toBe('11024_06');
    expect(live2dActionSetName('X_fanshu01_huaixiao3_idle')).toBe('fanshu01');
    expect(live2dActionSetName('X_02_haixiu_idle')).toBe('02');
    expect(live2dActionSetName('X_fanshu011_wenrou_idle')).toBe('fanshu011');
  });

  it('does not mistake a variant number for a set marker', () => {
    // huaixiao3 的 3 是变体号，不是套系；套系只认名字开头。
    expect(live2dActionSetName('X_huaixiao3_idle')).toBe('');
    expect(live2dActionSetName('X_weixiao2_idle_微笑')).toBe('');
    expect(live2dActionSetName('X_idle')).toBe('');
  });

  it('groups actions by set with the generic bucket first', () => {
    const groups = groupLive2DActionsBySet([
      { name: '坏笑 3（持续）', rawName: 'X_fanshu01_huaixiao3_idle' },
      { name: '温柔（持续）', rawName: 'X_03_wenrou_idle' },
      { name: '调笑', rawName: 'X_tiaoxiao' },
      { name: '微笑（持续）', rawName: 'X_fanshu01_weixiao2_idle' },
    ]);
    expect(groups.map(group => group.set)).toEqual(['', '03', 'fanshu01']);
    expect(groups[0].label).toBe('通用（1）');
    expect(groups[2].label).toBe('fanshu01（2）');
  });

  it('keeps the match key set-agnostic so outfits can still match', () => {
    // 两套衣服的套系名完全不同（11024_06 vs fanshu01），若把它算进键，
    // 跨衣橱就一条都对不上了。套系只用于界面分组。
    expect(live2dActionMatchKey('X_fanshu01_huaixiao3_idle'))
      .toBe(live2dActionMatchKey('X_huaixiao3_idle_微笑'));
  });
});
