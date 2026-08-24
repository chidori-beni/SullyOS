import { describe, expect, it } from 'vitest';
import { SPEECH_EMOTION_ENABLED, resolveSpeechEmotion } from './voiceEmotionPolicy';
import { inferAvatarPerformanceFromText } from './avatarPerformance';

describe('resolveSpeechEmotion', () => {
  it('当前整体关闭：任何输入都不带 emotion 参数', () => {
    expect(SPEECH_EMOTION_ENABLED).toBe(false);
    expect(resolveSpeechEmotion('happy')).toBeUndefined();
    expect(resolveSpeechEmotion('sad')).toBeUndefined();
    expect(resolveSpeechEmotion('neutral')).toBeUndefined();
  });

  it('空值 / 未传也返回 undefined，不会变成空字符串塞进请求体', () => {
    expect(resolveSpeechEmotion()).toBeUndefined();
    expect(resolveSpeechEmotion('')).toBeUndefined();
    expect(resolveSpeechEmotion(null)).toBeUndefined();
    expect(resolveSpeechEmotion('   ')).toBeUndefined();
  });
});

describe('立绘表情不能变成语音情绪（「打电话一开口就炸」的回归防线）', () => {
  it('「喂」是中文接电话的第一个字，立绘会推断成 happy —— 这一点本身没变', () => {
    // 立绘该笑还是要笑，这条断言是在钉住"推断逻辑仍然存在"，不是在挑它的毛病。
    expect(inferAvatarPerformanceFromText('喂？你怎么这个点打来。')).toMatchObject({ emotion: 'happy' });
  });

  it('但那个 happy 绝不能流进语音：整条链路的出口只有 resolveSpeechEmotion', () => {
    const avatarEmotion = inferAvatarPerformanceFromText('喂？你怎么这个点打来。').emotion;
    expect(avatarEmotion).toBe('happy');
    // 真实调用点传进来的只会是"显式标签"，历史上误传的立绘情绪即便传进来也被挡掉。
    expect(resolveSpeechEmotion(avatarEmotion)).toBeUndefined();
  });

  it('其它几个高唤起的推断结果同样进不了语音', () => {
    for (const line of ['啊？你说真的？', '你好呀', '哈哈笑死我了', '不许你这样']) {
      const inferred = inferAvatarPerformanceFromText(line).emotion;
      expect(resolveSpeechEmotion(inferred)).toBeUndefined();
    }
  });
});
