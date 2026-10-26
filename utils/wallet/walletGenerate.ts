/**
 * 「按人设生成余额」：读角色卡 + 记忆（ContextBuilder 那一套），让模型给一个符合设定的余额和一句理由。
 * 调法照抄查手机（apps/CheckPhone.tsx handleGenerate）：OpenAI 兼容 /chat/completions。
 */
import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import { ContextBuilder } from '../context';
import { extractContent, extractJson, safeResponseJson } from '../safeApi';
import { parseGeneratedBalance } from './wallet';

export async function generateBalanceByPersona(
    char: CharacterProfile,
    user: UserProfile,
    api: APIConfig,
): Promise<{ balance: number; reason: string }> {
    if (!api?.baseUrl || !api?.model) throw new Error('还没配置 API（设置 → API）');
    const task = `### [Task]
请估算你（${char.name}）现在**手头可以自由支配的钱**有多少（单位：₩，就当人民币的数值来估）。
要贴合你的人设：职业、家境、年龄、生活方式、最近的处境（记忆里提到的破产、发工资、大笔开销等都要考虑）。
- 学生 / 打工人 / 富豪 / 落魄的人，数字应该差得很远，别都给一个中庸的数
- 这是能随手转账的钱（钱包 + 活期），不是全部身家；房产、股票、公司不算
- 别给整齐的测试数字，像真实账户一样带零头

只输出 JSON：{ "balance": 12345.67, "reason": "一句话说明为什么是这个数，20 字以内" }`;
    const messages = await ContextBuilder.buildCharacterRequest(
        { char, user, includeDetailedMemories: true },
        [{ role: 'user', content: task }],
    );
    const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
        body: JSON.stringify({ model: api.model, messages, temperature: 0.7 }),
    });
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${body ? `：${body.slice(0, 200)}` : ''}`);
    }
    const data = await safeResponseJson(response);
    const content = extractContent(data) || '';
    const parsed = parseGeneratedBalance(extractJson(content));
    if (!parsed) throw new Error(`模型没给出能用的余额：${content.slice(0, 120) || '（空回复）'}`);
    return parsed;
}
