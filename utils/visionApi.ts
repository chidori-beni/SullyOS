import type { ApiPreset, Message, VisionApiConfig } from '../types';
import { DB } from './db';
import { processImage } from './file';
import { extractContent, safeFetchJson } from './safeApi';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';

export const VISION_DESCRIPTION_METADATA_KEY = 'visionDescription';

/** 设置页测试识图能力时发送的 48×48 白底紫色圆点 PNG。 */
export const VISION_API_TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADKSURBVGhD7Y+5DQMxDASvLtfmll2DDQYHHDYwfxGCdoBJFGg513dzLnzYDQZMw4BpGDANA568Xx+zVZQE4HEes6QC8JiMUcIBeECFEUIBOFypF3cADnbowRWAQ51aOScAB1Zo4YwA/HilGgzoVoMB3WqoAfjhajXUAAE/XakGA7rVYEC3GqYAAT9eoYVzAgQc6NTKWQECDnXowR0g4GClXkIBAg5XGCEcIOABGaOkAm7wGI9ZSgJu8Lh/VlEaMAEDpmHANAyYZvuAH2hIrK7auxVfAAAAAElFTkSuQmCC';

const VISION_PROMPT = `请准确、具体地描述图片中实际可见的内容，供另一个无法看图的对话模型理解。
请覆盖主体、动作、场景、重要物品、画面中的文字或界面信息；不要猜测画面外的信息，不要寒暄，只输出描述正文。`;

const inFlightDescriptions = new Map<string, Promise<string>>();

/** 把一份通用模型预设填入独立识图配置，不改变主 API 当前选择。 */
export const visionApiConfigFromPreset = (preset: ApiPreset, enabled = true): VisionApiConfig => ({
  enabled,
  baseUrl: normalizeApiBaseUrl(preset.config.baseUrl),
  apiKey: normalizeApiCredential(preset.config.apiKey),
  model: normalizeApiModel(preset.config.model),
});

export const isVisionApiReady = (config?: VisionApiConfig | null): config is VisionApiConfig =>
  config?.enabled === true
  && !!config.baseUrl?.trim()
  && !!config.apiKey?.trim()
  && !!config.model?.trim();

export const readVisionDescription = (message: Message): string => {
  const value = message.metadata?.[VISION_DESCRIPTION_METADATA_KEY];
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * 送去识图之前先把大图缩一缩。
 *
 * 聊天里的图未必都是本 App 压过的：从别的应用搬家进来的、早期版本存的，都可能是
 * 一两 MB 的原图。base64 之后体积再涨三成，很多视觉模型直接拒收——**而拒收会让
 * 整轮回复挂掉**。缩到 1024 宽对"看图说话"绰绰有余，还顺带省 token。
 *
 * 缩失败就用原图去试，不因为压缩本身再制造一次失败。
 */
const VISION_MAX_WIDTH = 1024;
const VISION_SHRINK_THRESHOLD = 400_000;

async function shrinkForVision(imageUrl: string): Promise<string> {
  if (!imageUrl.startsWith('data:image/')) return imageUrl;
  if (imageUrl.length < VISION_SHRINK_THRESHOLD) return imageUrl;
  try {
    const match = /^data:([^;]+);base64,(.+)$/.exec(imageUrl);
    if (!match) return imageUrl;
    const bin = atob(match[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'vision.jpg', { type: match[1] });
    return await processImage(file, { maxWidth: VISION_MAX_WIDTH, quality: 0.8, forceJpeg: true });
  } catch {
    return imageUrl;
  }
}

const cleanDescription = (value: string): string => value
  .replace(/^\s*\[?图片\s*[：:]\s*/i, '')
  .replace(/\]\s*$/i, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 4000);

/** 调用 OpenAI 兼容视觉端点，把一张图片变成可交给纯文本模型的描述。 */
export async function describeImageWithVisionApi(
  imageUrl: string,
  config: VisionApiConfig,
): Promise<string> {
  if (!isVisionApiReady(config)) {
    throw new Error('识图 API 已开启，但 URL、Key 或 Model 尚未填写完整');
  }
  if (!/^(data:image\/|https?:\/\/)/i.test(imageUrl)) {
    throw new Error('图片数据不可用，无法调用识图 API');
  }

  const existing = inFlightDescriptions.get(imageUrl);
  if (existing) return existing;

  const request = (async () => {
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        temperature: 0,
        max_tokens: 1200,
        stream: false,
      }),
    }, 1, 60_000, { appName: '消息', purpose: '识图' });

    const description = cleanDescription(extractContent(data));
    if (!description) throw new Error('识图 API 没有返回图片描述');
    return description;
  })();

  inFlightDescriptions.set(imageUrl, request);
  try {
    return await request;
  } finally {
    inFlightDescriptions.delete(imageUrl);
  }
}

/**
 * 为聊天历史里的图片补齐识图描述。
 *
 * 描述写回消息 metadata，因此同一条图片消息后续聊天、重 roll、主动消息都只识别一次；
 * 同一批里内容完全相同的图片也会复用第一次结果。
 */
export async function materializeVisionDescriptions(
  messages: Message[],
  config?: VisionApiConfig | null,
): Promise<Message[]> {
  if (config?.enabled !== true) return messages;
  if (!isVisionApiReady(config)) {
    throw new Error('识图 API 已开启，但 URL、Key 或 Model 尚未填写完整');
  }

  const descriptionByImage = new Map<string, string>();
  const prepared: Message[] = [];

  for (const message of messages) {
    if (message.type !== 'image') {
      prepared.push(message);
      continue;
    }

    const cached = readVisionDescription(message);
    if (cached) {
      descriptionByImage.set(message.content, cached);
      prepared.push(message);
      continue;
    }

    // 角色自己生成的图（metadata.imageGen.prompt 就是当初那句提示词）永远不送识图。
    //
    // 我们比任何识图模型都清楚它画了什么，再问一遍是白花钱、白等一次往返；而且生成图
    // 往往是原尺寸的大图，识图模型很可能直接拒掉 —— 那会让**整轮回复挂掉**，表现为
    // 「回复处理失败: 识图 API 没有返回图片描述」。
    //
    // 放在 cached 检查之后、真正调用之前：这样连「装新版之前就已经生成、身上没写描述」
    // 的老图也能就地自愈，不用用户回去手动删消息。
    const genPrompt = (message.metadata as any)?.imageGen?.prompt;
    if (typeof genPrompt === 'string' && genPrompt.trim()) {
      const description = `（这是一张刚生成的图，画面内容：${genPrompt.trim()}）`;
      descriptionByImage.set(message.content, description);
      const metadata = {
        ...(message.metadata || {}),
        [VISION_DESCRIPTION_METADATA_KEY]: description,
        visionRecognizedAt: Date.now(),
        visionModel: 'novelai-prompt',
      };
      // 写回只是省下次的事，**不能因为它失败就把整轮回复带走**——这条路存在的全部意义
      // 就是避免生成图搞挂聊天，自己再挂一次就荒唐了。（消息被删、库写不进去都可能。）
      await DB.updateMessageMetadata(message.id, prev => ({ ...(prev || {}), ...metadata }))
        .catch(() => { /* 缓存写不进去就算了，这轮照常用上面算好的描述 */ });
      prepared.push({ ...message, metadata });
      continue;
    }

    const imageUrl = typeof message.content === 'string' ? message.content : '';
    // 纯文字备份会保留 image 消息但移除原图数据；这种历史沿用“图片已不可用”占位，
    // 不能因为新开了识图 API 就让整轮聊天失败。
    if (!/^(data:image\/|https?:\/\/)/i.test(imageUrl)) {
      prepared.push(message);
      continue;
    }
    // 一张图认不出来，**绝不能把整轮回复带走**。
    //
    // 上游原本让异常直接往上抛，于是只要历史里有一张识图模型吃不下的图（搬家进来的
    // 大图最常见），用户就会陷入「每轮都失败、连天都聊不了」的死局，而且自己完全看不出
    // 是哪张图的问题。现在退化成一句占位描述：那张图这轮读不懂，但天照聊。
    //
    // 失败的结果**不写回 metadata** —— 写了就等于永久放弃，下次换个模型也没机会重试了。
    let description = descriptionByImage.get(imageUrl) || '';
    let recognized = true;
    if (!description) {
      try {
        description = await describeImageWithVisionApi(await shrinkForVision(imageUrl), config);
      } catch (e) {
        recognized = false;
        description = '[图片：这次没能识别出内容]';
        // 走 console.error 是为了让它出现在设置里的日志面板（那面板只收 error 通道）。
        console.error('[识图] 这张图没认出来，本轮用占位描述顶上，聊天照常继续：', e);
      }
    }
    descriptionByImage.set(imageUrl, description);

    if (!recognized) {
      prepared.push({ ...message, metadata: { ...(message.metadata || {}), [VISION_DESCRIPTION_METADATA_KEY]: description } });
      continue;
    }

    const metadata = {
      ...(message.metadata || {}),
      [VISION_DESCRIPTION_METADATA_KEY]: description,
      visionRecognizedAt: Date.now(),
      visionModel: config.model.trim(),
    };
    // 先写回 DB 再调用主模型：下一轮与刷新页面后都会直接命中，不重复扣识图额度。
    await DB.updateMessageMetadata(message.id, prev => ({ ...(prev || {}), ...metadata }));
    prepared.push({ ...message, metadata });
  }

  return prepared;
}
