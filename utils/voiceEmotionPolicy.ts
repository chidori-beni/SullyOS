/**
 * 「立绘表情」和「语音情绪」是两件不同的事，不能互相顶替。
 *
 * ── 病史 ──
 * 「打电话一开口就很夸张」查了好几轮都没治好，因为一直在改提示词，而真凶根本不在提示词里：
 * `avatarPerformance.inferAvatarPerformanceFromText()` 是一段**纯本地的文本启发式**，
 * 用来决定 Live2D / VRM 立绘该做什么表情——它看到「喂」「你好」就返回 `emotion: 'happy'`，
 * 看到「啊？」「真的？」就返回 `surprised`。这本身没问题，**脸该笑就是要笑**。
 *
 * 问题是这个"脸上的表情"被三处代码顺手当成了 TTS 的 `voice_setting.emotion` 送给 MiniMax：
 *   1. `CallApp.prepareCallAssistantReply` —— `speechEmotion = … || inferredPerformance.emotion`
 *   2. `CallApp.ensureCallBubbleAudio`     —— `voiceTag.emotion || bubble.performance?.emotion`
 *   3. `avatarTouchVoice`（开机问候 / 摸头语音）—— `emotion: performance?.emotion`
 *
 * 而「喂」正是中文接电话的第一个字。于是**每一通电话的第一句都被打上 happy 送进 TTS**，
 * 整条语音从头到尾用力上扬。提示词改一百遍也碰不到这段代码——这就是它像狗皮膏药一样
 * 撕不掉的原因。
 *
 * ── 现在的规矩 ──
 * 语音情绪**只认显式写出来的标签**，永远不接受立绘 / 演出情绪当输入。
 * 而且按用户的实测结论（加 neutral 也怪，什么都不加最自然），当前整体关闭：
 * 一律返回 undefined = 请求体里不带 `emotion` 字段，让 MiniMax 自己拿捏。
 *
 * 注意这个函数**故意只接受一个参数**。想再传个"兜底情绪"进来的时候请先停一下——
 * 那个兜底值十有八九就是立绘表情，正是这里要挡住的东西。
 */

/**
 * 是否允许给语音带 emotion 参数。
 *
 * 保留成一个常量而不是直接删掉整条链路，是为了以后想恢复时只改这一行：
 * 改成 true，显式写的 `<语音 emotion="sad">` / `[sad]` 就会重新生效，
 * 而立绘表情依然进不来（那是靠函数签名挡住的，跟这个开关无关）。
 */
export const SPEECH_EMOTION_ENABLED = false;

/**
 * 决定这一条语音要不要给 TTS 带 emotion。
 *
 * @param explicitTag 模型**显式写出来**的情绪标签（`<语音 emotion="…">` 的属性值，
 *   或整段开头的 `[happy]` 方括号标签）。**不要**把立绘 / 演出情绪传进来。
 * @returns 要带的情绪值；`undefined` = 请求体里不带 `emotion` 字段。
 */
export const resolveSpeechEmotion = (explicitTag?: string | null): string | undefined => {
  if (!SPEECH_EMOTION_ENABLED) return undefined;
  const value = (explicitTag || '').trim().toLowerCase();
  return value || undefined;
};
