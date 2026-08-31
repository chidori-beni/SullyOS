import type {
    CharacterProfile,
    DailySchedule,
    ScheduleCareerFocus,
    ScheduleSlot,
    ScheduleVariationClass,
} from '../types';

/** 世界书已经通过统一激活器解析过后的最小输入。这里只读正文和来源 id。 */
export interface SchedulePlannerWorldbookEntry {
    id: string;
    content: string;
}

export interface SchedulePlannerInput {
    char: Pick<CharacterProfile, 'id'> & Partial<Pick<
        CharacterProfile,
        'description' | 'systemPrompt' | 'worldview' | 'writerPersona' | 'scheduleStyle'
    >>;
    today: string;
    rerollIndex?: number;
    recentSchedules?: DailySchedule[];
    worldbookEntries?: SchedulePlannerWorldbookEntry[];
}

export interface SchedulePlan {
    schemaVersion: 1;
    seed: number;
    rerollIndex: number;
    variationClass: ScheduleVariationClass;
    variationInstruction: string;
    careerFocus: ScheduleCareerFocus;
    commercialActivityRequested: boolean;
    recentActivityHints: string[];
    sourceWorldbookIds: string[];
}

const CAREER_SIGNALS = [
    '职业', '本职', '工作', '上班', '训练', '专业', '团队', '车队', '赛车', '赛道', '模拟器', '测试',
    '比赛', '客户', '项目', '演出', '上课', '课程', '研究', '实验', '执业', '值班', '创作', '拍摄',
    '主播', '直播', '运动员', '演员', '歌手', '作家', '学生', '老师', '程序员', '医生', '护士', '厨师',
    '律师', '记者', '摄影', 'professional', 'work', 'training', 'racing', 'race', 'simulation', 'testing',
];

const COMMERCIAL_SIGNALS = [
    '商业', '赞助', '品牌', '媒体', '广告', '代言', '商务', '合同', '推广', '宣传', '发布会', '采访',
    '公关', '营销', '合作方', '合作伙伴', '客户会议', 'commercial', 'sponsor', 'brand', 'media',
    'advertising', 'endorsement', 'business', 'interview',
];

const LIFESTYLE_VARIATIONS: Array<{ id: ScheduleVariationClass; instruction: string }> = [
    {
        id: 'small-surprise',
        instruction: '加入一件低影响的临时小事或偶遇，让今天和昨天有一点区别；它必须符合角色的生活半径，不要凭空制造重大事件。',
    },
    {
        id: 'social-pulse',
        instruction: '让角色和一个合理的熟人、同事或场所产生短暂互动；如果设定没有支持，就改成观察到一点人情味，而不是捏造重要新人物。',
    },
    {
        id: 'errand-detour',
        instruction: '安排一件顺路的生活琐事或小绕路，例如补给、取件、整理装备；不要让它抢走职业硬约束。',
    },
    {
        id: 'hobby-detour',
        instruction: '让角色在本职之外被一个真实的个人兴趣短暂带偏，兴趣必须从角色设定中长出来。',
    },
    {
        id: 'recovery-pause',
        instruction: '保留一段不高效但真实的恢复、拖延或发呆时间，让角色不必每天像待办清单一样运转。',
    },
    {
        id: 'unfinished-thread',
        instruction: '让昨天没有收尾的一件小事在今天留下余波，并自然影响一个时段；不要凭空添加未发生的重大冲突。',
    },
];

const MINDFUL_VARIATIONS: Array<{ id: ScheduleVariationClass; instruction: string }> = [
    {
        id: 'thought-shift',
        instruction: '让一个念头在今天中途改变方向，形成自然的自我修正，而不是重复同一句情绪。',
    },
    {
        id: 'memory-echo',
        instruction: '让一条已经存在的记忆或近期对话在合适时刻短暂回响；不能凭空创造没有发生过的往事。',
    },
    {
        id: 'curiosity',
        instruction: '安排一次具体的小好奇或思考岔路，让意识流出现新的观察角度，但不要假装拥有未提供的工具或物理行动能力。',
    },
    {
        id: 'quiet-pause',
        instruction: '保留一段真正的空白、发呆或等待，不要把每个时段都写成高密度产出。',
    },
    {
        id: 'unfinished-thread',
        instruction: '让一个之前未解决的想法在今天继续发酵，并在下午或晚上出现轻微变化；不要凭空补写事实。',
    },
];

const normalizeForMatch = (value: unknown): string => (
    typeof value === 'string' ? value.toLocaleLowerCase() : ''
);

const hasAnySignal = (text: string, signals: string[]): boolean => (
    signals.some(signal => text.includes(signal.toLocaleLowerCase()))
);

/** FNV-1a 风格的稳定哈希：同一角色、日期、重抽次数在不同浏览器也得到同一结果。 */
export const hashScheduleSeed = (value: string): number => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/** 不使用 Math.random，避免刷新页面或 Worker 侧重新计算出另一套日程意图。 */
export const createSeededRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const pick = <T>(items: T[], random: () => number): T => (
    items[Math.min(items.length - 1, Math.floor(random() * items.length))]
);

const scheduleHasSignal = (schedule: DailySchedule, signals: string[]): boolean => (
    (schedule.slots || []).some(slot => hasAnySignal(
        `${slot.activity || ''} ${slot.description || ''}`.toLocaleLowerCase(),
        signals,
    ))
);

const getRecentActivityHints = (schedules: DailySchedule[]): string[] => {
    const seen = new Set<string>();
    const hints: string[] = [];
    const sorted = [...schedules]
        .filter(schedule => schedule && Array.isArray(schedule.slots))
        .sort((a, b) => b.date.localeCompare(a.date) || b.generatedAt - a.generatedAt)
        .slice(0, 7);

    for (const schedule of sorted) {
        for (const slot of schedule.slots) {
            const activity = typeof slot.activity === 'string' ? slot.activity.trim() : '';
            const key = activity.replace(/\s+/gu, '').toLocaleLowerCase();
            if (key.length < 2 || seen.has(key)) continue;
            seen.add(key);
            hints.push(activity.slice(0, 18));
            if (hints.length >= 10) return hints;
        }
    }
    return hints;
};

const getCharacterSignalText = (
    input: SchedulePlannerInput,
    worldbookEntries: SchedulePlannerWorldbookEntry[],
): string => [
    input.char.description,
    input.char.systemPrompt,
    input.char.worldview,
    input.char.writerPersona,
    ...worldbookEntries.map(entry => entry.content),
].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .slice(0, 40_000)
    .toLocaleLowerCase();

const chooseVariation = (
    input: SchedulePlannerInput,
    recentSchedules: DailySchedule[],
    random: () => number,
): { id: ScheduleVariationClass; instruction: string } => {
    const choices = input.char.scheduleStyle === 'mindful' ? MINDFUL_VARIATIONS : LIFESTYLE_VARIATIONS;
    const recentClasses = new Set(
        recentSchedules
            .slice(0, 3)
            .map(schedule => schedule.planningMeta?.variationClass)
            .filter((value): value is ScheduleVariationClass => typeof value === 'string'),
    );
    const freshChoices = choices.filter(choice => !recentClasses.has(choice.id));
    const usableChoices = freshChoices.length > 0 ? freshChoices : choices;

    // 大约五分之一的日子保持主干稳定，其他日子让低风险变化进入日程。
    if (random() < 0.2) {
        return {
            id: 'routine',
            instruction: '今天以角色的典型日常为主，但至少改变一个小细节（顺序、地点、心情、临时念头或一件小插曲），不要机械复制上一张表。',
        };
    }
    return pick(usableChoices, random);
};

const chooseCareerFocus = (
    signalText: string,
    recentSchedules: DailySchedule[],
    random: () => number,
): { focus: ScheduleCareerFocus; commercialRequested: boolean } => {
    const hasCommercialSignals = hasAnySignal(signalText, COMMERCIAL_SIGNALS);
    const hasCareerSignals = hasCommercialSignals || hasAnySignal(signalText, CAREER_SIGNALS);
    if (!hasCareerSignals) return { focus: 'none', commercialRequested: false };

    const recentCommercialSchedules = recentSchedules.filter(schedule => scheduleHasSignal(schedule, COMMERCIAL_SIGNALS));
    if (hasCommercialSignals) {
        const mostRecentCommercialIndex = recentSchedules.findIndex(schedule => scheduleHasSignal(schedule, COMMERCIAL_SIGNALS));
        // 连续几张日程没有商业/媒体类职业活动时，下一次提高优先级；出现过之后仍保留随机间隔。
        if (recentCommercialSchedules.length === 0 || mostRecentCommercialIndex >= 4) {
            return { focus: 'secondary', commercialRequested: true };
        }
        const roll = random();
        if (roll < 0.34) return { focus: 'secondary', commercialRequested: true };
        if (roll < 0.72) return { focus: 'balanced', commercialRequested: false };
        return { focus: 'core', commercialRequested: false };
    }

    return random() < 0.28
        ? { focus: 'balanced', commercialRequested: false }
        : { focus: 'core', commercialRequested: false };
};

/** 生成只负责“今天往哪边偏一点”的本地计划，最终时间表仍由 LLM 负责落槽。 */
export const buildSchedulePlan = (input: SchedulePlannerInput): SchedulePlan => {
    const rerollIndex = Math.max(0, Math.floor(input.rerollIndex ?? 0));
    const seed = hashScheduleSeed(`${input.char.id}|${input.today}|${rerollIndex}`);
    const random = createSeededRandom(seed);
    const recentSchedules = [...(input.recentSchedules || [])]
        .filter(schedule => schedule && Array.isArray(schedule.slots))
        .sort((a, b) => b.date.localeCompare(a.date) || b.generatedAt - a.generatedAt);
    const worldbookEntries = input.worldbookEntries || [];
    const signalText = getCharacterSignalText(input, worldbookEntries);
    const variation = chooseVariation(input, recentSchedules, random);
    const career = chooseCareerFocus(signalText, recentSchedules, random);
    const recentActivityHints = getRecentActivityHints(recentSchedules);
    const sourceWorldbookIds = worldbookEntries
        .filter(entry => hasAnySignal(normalizeForMatch(entry.content), [...CAREER_SIGNALS, ...COMMERCIAL_SIGNALS]))
        .map(entry => entry.id)
        .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index)
        .slice(0, 20);

    return {
        schemaVersion: 1,
        seed,
        rerollIndex,
        variationClass: variation.id,
        variationInstruction: variation.instruction,
        careerFocus: career.focus,
        commercialActivityRequested: career.commercialRequested,
        recentActivityHints,
        sourceWorldbookIds,
    };
};

/** 把本地计划翻译成提示词；它是软约束，聊天里明确说过的硬事实优先。 */
export const formatSchedulePlanPrompt = (
    plan: SchedulePlan,
    style: 'lifestyle' | 'mindful' = 'lifestyle',
): string => {
    const careerInstruction = plan.careerFocus === 'secondary'
        ? '角色设定支持次级职业事务。除非聊天记录明确表明今天有冲突的硬约束，今天必须在 slots 中安排至少一项商业、媒体、赞助、品牌或同类次级职业活动；不要把车辆测试这一项算作商业活动。'
        : plan.careerFocus === 'balanced'
            ? '今天在核心职业活动之外，尽量安排一项角色设定支持的次级职业事务；不要为了凑类别捏造不存在的公司、合同或人物。'
            : plan.careerFocus === 'core'
                ? '今天至少保留一项角色设定明确支持的核心职业活动；其他时段仍需像一个完整的人，而不是工作清单。'
                : '没有足够的职业依据时，不要凭空添加职业、商业或组织活动。';
    const realityInstruction = style === 'mindful'
        ? '这是意识系角色：变化只能表现为真实可拥有的思绪、记忆、期待或线上互动，不要安排物理世界行动。'
        : '这是生活系角色：变化可以是小型生活插曲，但不能凭空制造事故、疾病、巨额金钱损失、重大关系变化或改变世界观的事件。';
    const recent = plan.recentActivityHints.length > 0
        ? `最近几天已经出现过的活动（只用于避免机械照抄）：${plan.recentActivityHints.join('、')}。必要的硬事实仍然优先。`
        : '暂时没有可用的旧日程，按照角色设定自然安排。';

    return `## 今日的日程规划（本地骰子结果，必须服从角色硬设定）
- 今日变化类型：${plan.variationClass}
- 变化要求：${plan.variationInstruction}
- 职业覆盖：${careerInstruction}
- ${recent}
- ${realityInstruction}
- 随机性应该体现在活动的选择、顺序、空档和情绪细节上；不要为了“有随机事件”硬塞一个不符合角色的剧情。
`;
};

export const buildScheduleFingerprint = (
    slots: Array<Pick<ScheduleSlot, 'startTime' | 'activity'>>,
): string => {
    const value = slots
        .map(slot => `${slot.startTime}:${(slot.activity || '').trim().replace(/\s+/gu, '')}`)
        .join('|');
    return hashScheduleSeed(value).toString(16).padStart(8, '0');
};
