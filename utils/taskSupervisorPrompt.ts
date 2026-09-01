import type { CharacterProfile, Task } from '../types';

/**
 * 待办台词是一个很小的“监督员”旁路请求。
 *
 * 这里刻意不复用普通聊天的 system prompt 和历史消息数组。普通聊天需要
 * 309 条消息来维持长对话，但待办只需要让角色看懂“这件事是什么、用户现在的
 * 安排和角色本身的语气”。把整套聊天协议搬过来反而会诱发元话术、隐私回显和 429。
 */
export const TASK_SUPERVISOR_PROMPT_BUDGETS = {
    roleCard: 1_000,
    description: 180,
    worldview: 240,
    calendar: 560,
    taskTitle: 220,
    taskNote: 220,
} as const;

export interface TaskSupervisorPromptInput {
    character: CharacterProfile;
    task: Task;
    completed: boolean;
    calendarContext?: string;
    /** Local-only exact phrases to redact from a character card before serialization. */
    privateRedactions?: string[];
}

export interface TaskSupervisorPromptMessage {
    role: 'system' | 'user';
    content: string;
}

/**
 * Normalize and bound user-editable/context data before it enters this
 * side-channel. It is a character/context budget, not a response parser.
 */
export const compactTaskVoiceData = (value: unknown, maxChars: number): string => {
    const normalized = String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!normalized) return '';

    const characters = Array.from(normalized);
    if (characters.length <= maxChars) return normalized;

    const marker = '…（资料过长，中间已省略）…';
    const available = Math.max(8, maxChars - Array.from(marker).length - 2);
    const headLength = Math.max(1, Math.ceil(available * 0.68));
    const tailLength = Math.max(1, available - headLength);
    return characters.slice(0, headLength).join('')
        + '\n' + marker + '\n'
        + characters.slice(-tailLength).join('');
};

const dataOrNone = (value: unknown, maxChars: number): string =>
    compactTaskVoiceData(value, maxChars) || '无';

const TASK_ROLE_CARD_PROFILE_RE = /(?:在|于|来自|住在|居住在|就读于|工作于|留学于)[\p{Script=Han}\p{L}\p{N}·\s]{0,24}(?:留学|留学生|就读|上学|大学|学院|学校|公司|工作|居住|住在)/gu;
const TASK_ROLE_CARD_LOCATION_PROFILE_RE = /(?:日本|东京|大阪|京都)[\p{Script=Han}\p{L}\p{N}·\s]{0,12}(?:留学|留学生|就读|上学|大学|学院|学校|公司|工作|居住|住在)/gu;

/** Redact known user facts from role-card prose without exposing the source text. */
const redactTaskVoicePromptData = (value: unknown, privateRedactions: string[] = []): string => {
    let text = compactTaskVoiceData(value, 2_000);
    if (!text) return '';
    const marker = '（私密资料已省略）';
    const exactRedactions = privateRedactions
        .map(item => compactTaskVoiceData(item, 320))
        .filter(item => Array.from(item).length >= 4)
        .sort((left, right) => Array.from(right).length - Array.from(left).length);
    for (const redaction of exactRedactions) text = text.split(redaction).join(marker);
    return text
        .replace(/(?:https?:\/\/|www\.)\S+/gi, marker)
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, marker)
        .replace(/(?<!\d)(?:\+?\d[\d -]{7,}\d)(?!\d)/g, marker)
        .replace(TASK_ROLE_CARD_PROFILE_RE, marker)
        .replace(TASK_ROLE_CARD_LOCATION_PROFILE_RE, marker);
};

const roleCardBlock = (input: TaskSupervisorPromptInput): string => {
    const { character } = input;
    const name = dataOrNone(character.name, 48);
    const roleCard = dataOrNone(redactTaskVoicePromptData(character.systemPrompt, input.privateRedactions), TASK_SUPERVISOR_PROMPT_BUDGETS.roleCard);
    const description = dataOrNone(redactTaskVoicePromptData(character.description, input.privateRedactions), TASK_SUPERVISOR_PROMPT_BUDGETS.description);
    const worldview = dataOrNone(redactTaskVoicePromptData(character.worldview, input.privateRedactions), TASK_SUPERVISOR_PROMPT_BUDGETS.worldview);
    return [
        '角色名：' + name,
        '角色卡（优先遵守）：\n' + roleCard,
        '角色补充设定（只用于理解身份和语气）：\n' + description,
        '世界观（只用于理解角色身份和语气）：\n' + worldview,
    ].join('\n\n');
};

const taskBlock = (input: TaskSupervisorPromptInput): string => {
    const { task } = input;
    return [
        '待办内容：' + dataOrNone(task.title, TASK_SUPERVISOR_PROMPT_BUDGETS.taskTitle),
        task.note?.trim()
            ? '用户备注：' + compactTaskVoiceData(task.note, TASK_SUPERVISOR_PROMPT_BUDGETS.taskNote)
            : '',
        task.deadline ? '截止日期：' + dataOrNone(task.deadline, 32) : '',
        task.dueTime ? '截止时间：' + dataOrNone(task.dueTime, 16) : '',
    ].filter(Boolean).join('\n');
};

/**
 * Build a small supervisor/encourager request.  Only the role card, the
 * current task and explicitly user-entered calendar context cross the network
 * boundary; relationship summaries, memories, worldbooks and chat history do
 * not belong in this side channel.
 */
export const buildTaskSupervisorMessages = (
    input: TaskSupervisorPromptInput,
): TaskSupervisorPromptMessage[] => {
    const characterName = dataOrNone(input.character.name, 48);
    const completedAction = input.completed
        ? '用户刚刚完成了下面这项待办。'
        : '用户刚刚记下了下面这项待办。';
    const systemContent = [
        '你现在是「' + characterName + '」，也是这位用户的待办监督员和陪伴者。',
        '你不是日历软件客服、通知机器人、任务评价器或 AI 助手。请用这个角色平时说话的方式，留下像熟人随手发来的一句回应。',
        '【角色资料】\n' + roleCardBlock(input),
        '用户的个人资料、地点、学校、工作、年龄、联系方式和经历都属于私密背景；除非当前待办标题或备注明确要求，否则绝不复述、总结或暴露这些信息。不要从资料中挑一段当台词。',
        '当前日程是用户主动写下、允许你参考的背景，用来知道对方此刻可能在做什么并避免说不合时宜的话；不要把日程以外的记忆、聊天或用户资料补写成事实。',
        '本次只生成一条短台词：不展示思考过程，不解释，不输出 JSON、Markdown、角色名前缀或引号，不调用工具，不输出动作命令。',
    ].join('\n\n');

    const userContent = [
        completedAction,
        '【这项待办】\n' + taskBlock(input),
        '【用户当前日程】\n' + dataOrNone(input.calendarContext, TASK_SUPERVISOR_PROMPT_BUDGETS.calendar),
        input.completed
            ? '请像你在看到这件具体成果后的第一反应那样说话：可以夸、调侃、嘴硬、关心或顺手逗他一下，要具体、有性格，不要写成“任务已完成”的状态通知。'
            : '请像你在看到对方记下这件事时顺手说的一句陪伴话那样说话：可以调侃、撒娇、嘴硬、关心或轻轻催促，必须像这个角色，不要写成应用提醒。',
        '用你和用户平时交流的语言，直接输出一句自然、短小、有人味的台词正文。建议 5–30 字，但不因长度或没有句号而拒绝自然说法。',
    ].join('\n\n');

    return [
        { role: 'system', content: systemContent },
        { role: 'user', content: userContent },
    ];
};
