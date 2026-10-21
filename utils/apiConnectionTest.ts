import type { APIConfig } from '../types';
import { extractContent, safeResponseJson } from './safeApi';

export type ApiConnectionTarget = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model' | 'stream'>;

export interface ApiConnectionResult {
  ok: boolean;
  /** 给人看的一句话；失败时带上接口原文，别改写成「连接失败」这种没信息量的话 */
  message: string;
  ms: number;
}

/**
 * 发一句 "Hi"（max_tokens 5）看接口通不通。和设置页「测试连接」同一个请求，
 * 方便聊天设置 / 通话 / 见面里就地测，不用退回设置。
 */
export async function testApiConnection(api: ApiConnectionTarget, signal?: AbortSignal): Promise<ApiConnectionResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const baseUrl = api.baseUrl.trim().replace(/\/+$/, '');
  const model = api.model.trim();
  if (!baseUrl || !model) return { ok: false, message: '还没填 URL 或模型', ms: 0 };
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey.trim() || 'sk-none'}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5, stream: api.stream ?? false }),
      signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, message: `HTTP ${response.status}${text ? '：' + text.slice(0, 160) : ''}`, ms: elapsed() };
    }
    // safeResponseJson 能把 SSE 流响应拼回普通结构，开了流式的预设也能测
    const reply = extractContent(await safeResponseJson(response)).trim();
    return { ok: true, message: reply ? `回复：${reply.slice(0, 30)}` : '接口已响应，但回复为空', ms: elapsed() };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // 浏览器这句英文看不懂：其实是 Key 里粘进了中文、全角或换行之类的字符
    const hint = raw.includes('ISO-8859-1') ? '（Key 里混进了中文、全角符号或换行，重新复制一遍 Key）' : '';
    return { ok: false, message: raw + hint, ms: elapsed() };
  }
}
