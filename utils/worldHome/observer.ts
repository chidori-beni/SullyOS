/**
 * 5.1 双人私聊观测器 —— 选两个角色，让他俩私下聊一段，你在旁边看。
 *
 * ## 这是什么
 *
 * 小镇平时是「一轮演所有人」。观测器是另一种用法：
 * **你就想看这两个人单独说话**，不想为此推进半天时间。
 *
 * 选 A 和 B →「让他俩聊聊」→ 出一段私聊 → 每条都能改/删（复用手机弹窗里
 * 已有的编辑能力）→「再聊几句」在改过之后的内容上继续。
 *
 * ## ⛔⭐ 铁律一：观测器不推进世界
 *
 * 它**不动** `storyClock`、不排 `pendings`、不结算节日/阈值、不写 `relationships`。
 * 理由很实际：节日、约定、转折点全都是按「第几轮」计时的。
 * 观测器要是顺手推一轮，用户「让他俩多聊两句」就会把镇上的节日挤掉 ——
 * 这种因果关系没人猜得到，只会被当成 bug。
 *
 * 所以观测器产出的消息**落在当前轮**（`world.storyClock`），和这半天的其它消息并排。
 *
 * ## ⛔⭐ 铁律二：观测器绝不改关系
 *
 * 和 §5 铁律「别把我的角色写崩」同源。观测器**读**关系（他俩怎么称呼彼此、
 * 好感多少）好让对话的调子对，但**一个字都不写回去**。
 * 提示词里也不给 `relationships` 这个输出字段 —— 不给字段比给了再丢弃更可靠。
 *
 * ## ⛔ 铁律三：机主不在场
 *
 * 这是他俩的私聊。提示词里不能出现「用户想看」「请表现出」——
 * 和旁白的指令档同一个口径：角色只知道**这段对话正在发生**，
 * 不知道是谁让它发生的。「话题引子」也按这个口径包装。
 */
import type { WorldProfile, WorldThread, WorldChatMessage } from '../../types';
import { dmThreadId, ensureThreads, isDuplicateLine, THREAD_CAP } from './threads';
import { extractJson } from './prompts';

/** 一次生成多少条。长短是明摆着的口味差异，所以做成三档而不是写死。 */
export type ObserverLength = 'short' | 'medium' | 'long';

export const OBSERVER_LENGTHS: Record<ObserverLength, { name: string; lines: number; hint: string }> = {
    short: { name: '几句', lines: 4, hint: '一个来回，试试水' },
    medium: { name: '一段', lines: 8, hint: '聊出点东西来' },
    long: { name: '聊久点', lines: 14, hint: '一口气聊透' },
};

/** 缺省档。短的那档常常「刚开口就没了」，长的那档烧 token，中间最稳。 */
export const DEFAULT_OBSERVER_LENGTH: ObserverLength = 'medium';

export interface ObserverPeer {
    id: string;
    name: string;
    /** 人设摘要（已压缩过的一段话） */
    persona?: string;
}

export interface ObserverLine {
    fromId: string;
    fromName: string;
    text: string;
}

const genId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

/** 取 a→b 那条有向关系的口径（观测器只读不写）。 */
function relLabelOf(world: WorldProfile, fromId: string, toId: string): string {
    const r = (world.relationships || []).find(x => x.fromId === fromId && x.toId === toId);
    if (!r) return '（还没定过关系）';
    const v = typeof r.value === 'number' ? `好感 ${r.value}/100` : '';
    return [r.label, v].filter(Boolean).join('，') || '（还没定过关系）';
}

/** 找到（或新建）他俩的私聊线程。原地挂在 world 上并返回。 */
export function dmThreadBetween(world: WorldProfile, aId: string, bId: string): WorldThread {
    const threads = ensureThreads(world);
    const tid = dmThreadId(aId, bId);
    let thread = threads.find(t => t.id === tid);
    if (!thread) {
        thread = { id: tid, kind: 'dm', memberIds: [aId, bId], messages: [] };
        threads.push(thread);
    }
    return thread;
}

/**
 * 构造观测器的提示词。
 *
 * @param topic 用户给的话题引子，可空。**按旁白指令档的口径包装** ——
 *              说「这次他们说起的是…」，绝不说「用户希望你们聊…」。
 */
export function buildObserverPrompt(args: {
    world: WorldProfile;
    a: ObserverPeer;
    b: ObserverPeer;
    storyTime: string;
    length: ObserverLength;
    topic?: string;
    /** 线程里已有的上文（旁观者口径：两边都写名字，见 formatThreadForObserver） */
    recent?: string;
    /** 「再聊几句」时为 true —— 要求接着上面往下说，而不是重新开场 */
    continued?: boolean;
}): string {
    const { world, a, b, storyTime, length, topic, recent, continued } = args;
    const n = OBSERVER_LENGTHS[length].lines;
    const topicSection = topic?.trim()
        // ⛔ 这里的措辞是刻意的：只描述「对话从哪儿起头」，不出现任何下指令的人。
        //    写成「用户想看你们聊 X」，角色就会去回应那个不存在的人。
        ? ['', '## 这段对话的起头', `这次他们说起的是：${topic.trim()}`, '自然地从这里聊开，不必生硬点题，也不要解释为什么聊到这个。'].join('\n')
        : '';
    const recentSection = recent?.trim()
        ? ['', '## 他们私聊里之前说过的话', recent.trim()].join('\n')
        : '';
    const continueRule = continued
        ? '这是**接着上面那些话往下说**，不是重新开场 —— 别再打招呼、别重复已经说过的意思。'
        : '这是他们这会儿新开的一段话。';
    const fence = '```json';
    return [
        `你在写共同世界「${world.name}」里两个人的**手机私聊记录**。`,
        '',
        '## 世界观',
        world.worldview || '（一个安静的小世界）',
        '',
        '## 这两个人',
        `▸ ${a.name}：${a.persona || '（没写人设）'}`,
        `　ta 眼中的 ${b.name}：${relLabelOf(world, a.id, b.id)}`,
        `▸ ${b.name}：${b.persona || '（没写人设）'}`,
        `　ta 眼中的 ${a.name}：${relLabelOf(world, b.id, a.id)}`,
        '　（这两行是**参考**，让你把调子写对。两边可以完全不对等。）',
        recentSection,
        topicSection,
        '',
        `剧情时间：${storyTime}。${continueRule}`,
        '',
        '## 怎么写',
        '- 这是**打字发消息**，不是小说。一条就是一条消息：口语、可以很短、可以只有一个字、可以连发两条。',
        '- ⛔ 不要写旁白、动作描写、括号里的心理活动 —— 手机上打不出这些。',
        '- 两个人都要说话，谁多谁少看性格，但不能变成一个人的独白。',
        '- 关系什么样就怎么写：不熟就客气，有心结就别硬凑热络。',
        // ⛔ 这一条对应「机主不在场」：私聊里冒出第三个人，整个观测器的前提就没了。
        '- ⛔ 这是**只有他们两个人**的私聊。不要出现第三个人说话，也不要提到有谁在看他们聊天。',
        '',
        `严格输出一个 JSON 对象（建议用 ${fence} 包裹），一共 ${n} 条左右：`,
        '{',
        `  "lines": [{ "from": "${a.name} 或 ${b.name}", "text": "这条消息的内容" }]`,
        '}',
    ].join('\n');
}

/**
 * 解析模型输出。只认这两个人的名字 —— 模型偶尔会塞进第三个人或旁白，直接丢掉。
 * 解析不出来返回空数组（调用方据此提示「再试一次」），不抛错。
 */
export function parseObserverLines(raw: string, a: ObserverPeer, b: ObserverPeer): ObserverLine[] {
    const j = extractJson(raw);
    const arr = Array.isArray(j?.lines) ? j.lines : null;
    if (!arr) return [];
    const out: ObserverLine[] = [];
    for (const item of arr) {
        const from = typeof item?.from === 'string' ? item.from.trim() : '';
        const text = typeof item?.text === 'string' ? item.text.trim() : '';
        if (!from || !text) continue;
        // 只收这两个人。名字对不上（模型编了个路人、或写成「旁白」）就丢掉这一条，
        // 而不是硬塞给其中一个 —— 硬塞会把不属于 ta 的话记到 ta 头上。
        const who = from === a.name ? a : from === b.name ? b : null;
        if (!who) continue;
        out.push({ fromId: who.id, fromName: who.name, text });
    }
    return out;
}

/**
 * 把生成的对话落进他俩的私聊线程。返回**新增消息的 id**，
 * 供「这段不要了」原样撤掉（见 `dropObserverLines`）。
 *
 * ⛔ 这个函数只碰 `world.threads`。不动 storyClock、不动 relationships、
 *    不排 pendings —— 见文件头铁律一、二。
 */
export function appendObserverLines(
    world: WorldProfile,
    a: ObserverPeer,
    b: ObserverPeer,
    lines: ObserverLine[],
    round: number,
    storyTime: string,
): string[] {
    if (lines.length === 0) return [];
    const thread = dmThreadBetween(world, a.id, b.id);
    const now = Date.now();
    const ids: string[] = [];
    for (const l of lines) {
        // 沿用线程既有的去重口径：同一个人近期发过一模一样的话就跳过。
        if (isDuplicateLine(thread, l.fromId, l.text)) continue;
        const msg: WorldChatMessage = {
            id: genId('wm'), fromId: l.fromId, fromName: l.fromName,
            text: l.text, round, storyTime, timestamp: now,
        };
        thread.messages.push(msg);
        ids.push(msg.id);
    }
    if (thread.messages.length > THREAD_CAP) thread.messages = thread.messages.slice(-THREAD_CAP);
    return ids;
}

/** 「这段不要了」：按 id 原样撤掉刚生成的那批，不碰用户自己留下的消息。 */
export function dropObserverLines(world: WorldProfile, a: ObserverPeer, b: ObserverPeer, ids: string[]): void {
    if (ids.length === 0) return;
    const thread = (world.threads || []).find(t => t.id === dmThreadId(a.id, b.id));
    if (!thread) return;
    const drop = new Set(ids);
    thread.messages = thread.messages.filter(m => !drop.has(m.id));
}

/**
 * 把线程尾部格式化成观测器的上文。
 *
 * 和 `formatThreadForPrompt` 的区别：那个是**某个角色的视角**（自己显示成「你」），
 * 观测器是**旁观者视角**，两边都写名字 —— 写成「你」模型会分不清在扮演谁。
 */
export function formatThreadForObserver(thread: WorldThread | null | undefined, limit = 20): string {
    const msgs = (thread?.messages || []).slice(-limit);
    if (msgs.length === 0) return '';
    return msgs.map(m => `${m.fromName}：${m.text}`).join('\n');
}
