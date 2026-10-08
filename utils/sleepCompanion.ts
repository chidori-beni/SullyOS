/**
 * 陪睡 · 哄睡（通话内的睡前模式）。
 *
 * 开启后先让角色说一整段哄睡的话（lullaby），之后按 planSleepDreams 排好的时刻
 * 补一到三句深夜梦话（dream）——整夜通常只调用 2～4 次 API，不会一直生成。
 * （最早照搬糯叽机「每小时 25%」，实际几乎听不到，2026-10-08 改成排期制；
 * 下面 shouldFireSleepDream 那组旧判定只留给老测试，CallApp 已不用。）这个文件只放纯逻辑（提示词文案 + 可测的调度判定 +
 * 一个持久化的定时挂断分钟数），真正的计时器 / 消息发送留在 CallApp.tsx 里，
 * 因为那边才拿得到 bubbles / requestAssistantReply 这些通话状态。
 */

/**
 * 哄睡阶段的指令。作为「本轮用户输入」喂给模型（跟 CallApp 里已有的
 * fireIdleNudge 走同一条路），不会显示成一条用户气泡。
 * 通话的 system prompt 已经教过完整的语音演出规则（呼吸/停顿/不标情绪等），
 * 这里只需要交代"现在是什么场景、要说什么样的内容"，不用重复那些机制。
 */
export const SLEEP_LULLABY_INSTRUCTION = '（对方已经躺下准备睡了，不会再说话，你只能听见ta轻轻的呼吸声。接下来很长一段时间只有你在说——用一整段温柔、连绵不断的话哄ta入睡：可以讲一个缓慢温柔的睡前故事，可以念一首你想读给喜欢的人听的诗，也可以只是絮絮叨叨说很多晚安的话——回忆一些温暖的小事、告诉ta你在这里、让ta安心睡去。声音要软、要贴近，像趴在ta耳边小声说话，越到后面越像你自己也快睡着了、话音慢慢淡下去。不要提问，不要等回答，不会挂断电话。这是电话里真的说出口的话，不是文字旁白。）';

/**
 * 深夜梦话彩蛋。角色"自己也睡着了"，这条是无意识的呓语，不是清醒地在对话。
 */
export const SLEEP_DREAM_INSTRUCTION = '（现在是深夜，对方早就睡熟了，你自己也已经睡着。这一句是你在睡梦中无意识说出的梦话——你自己都不知道自己说了什么，不是清醒地在跟对方说话。要真实、要贴合你此刻的心事和处境：可以含糊地咕哝几个字（"唔……""别走……"半句没说完的名字），可以清楚地说出梦里的一句话，可以是在做噩梦、小小惊一下或害怕地嘟囔，也可以是甜的、在梦里对对方笑着说了句温柔的话——挑一种最像你的。只写一两句极短的话，不要打招呼、不要提问、不要表现出知道自己在通话中，不会挂断电话。这是电话里传出的声音，只输出这几句迷迷糊糊的梦话本身。）';

/** 梦话彩蛋整夜最多出现几次（含首次哄睡之外的追加次数）。 */
export const SLEEP_DREAM_MAX_COUNT = 2;
/** 每次检查窗口触发梦话的概率。 */
export const SLEEP_DREAM_CHANCE = 0.25;
/** 每隔多久检查一次是否要补一句梦话（毫秒）。 */
export const SLEEP_DREAM_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 纯判定：这次一小时检查要不要真的触发一句梦话。
 * 抽离出来是为了能在不碰计时器的情况下把「上限 2 次 / 25% 概率 / 开关」这几条
 * 边界条件测清楚——真正的 setTimeout 调度留在 CallApp.tsx。
 *
 * @param dreamCount 目前已经说过几次梦话
 * @param dreamEnabled 「陪睡梦话彩蛋」开关（CallPreferences.sleepDreamEnabled）
 * @param roll 一个 [0,1) 的随机数，调用方通常传 Math.random()，测试里传固定值
 */
export const shouldFireSleepDream = (
  dreamCount: number,
  dreamEnabled: boolean,
  roll: number,
): boolean => {
  if (!dreamEnabled) return false;
  if (dreamCount >= SLEEP_DREAM_MAX_COUNT) return false;
  return roll < SLEEP_DREAM_CHANCE;
};

/** 还要不要继续排下一次一小时检查（次数封顶后 / 开关关闭后就不用再排了）。 */
export const shouldScheduleNextSleepDreamCheck = (
  dreamCount: number,
  dreamEnabled: boolean,
): boolean => dreamEnabled && dreamCount < SLEEP_DREAM_MAX_COUNT;

/**
 * 2026-10-08 起的梦话排期：一进陪睡就把整夜的梦话时刻抽好。
 *
 * 旧做法是「第 1、2 小时各抽一次 25%」，前台和 Worker 还各抽一层，一整夜有一半以上的
 * 概率一句都没有——用户连续两晚亮着屏幕放了三四个小时都是「今晚没有生成梦话」。
 * 现在第一句必出，落在入睡后 45～90 分钟；后面两句看运气，落在用户半夜醒来之前。
 * 设了定时挂断时，挂断前放不下的时段就丢掉；一个都放不下但通话够 20 分钟的，
 * 就在后半段塞一句，保证「开着陪睡睡过去」总能留下一句梦话。
 */
export interface SleepDreamSlot {
  dreamIndex: number;
  dueAt: number;
}

const SLEEP_DREAM_WINDOWS: Array<{ fromMin: number; toMin: number; chance: number }> = [
  { fromMin: 45, toMin: 90, chance: 1 },
  { fromMin: 100, toMin: 160, chance: 0.7 },
  { fromMin: 170, toMin: 230, chance: 0.5 },
];
/** 页面亮着时，前台比 Worker 早这么久自己生成，成功后撤掉 Worker 那份。 */
export const SLEEP_DREAM_LOCAL_LEAD_MS = 90 * 1000;
/** 前台这次没说成（正在说话/网络抖）时，隔多久再试。 */
export const SLEEP_DREAM_RETRY_MS = 2 * 60 * 1000;
/** 页面被冻住、错过梦话时刻超过这么久，前台就不再追发（交给 Worker 那份）。 */
export const SLEEP_DREAM_STALE_MS = 10 * 60 * 1000;
/** 距离定时挂断至少留这么久，免得梦话刚生成好电话就挂了。 */
const SLEEP_DREAM_HANGUP_MARGIN_MS = 3 * 60 * 1000;

export const planSleepDreams = (
  startAt: number,
  autoHangupAt: number | null,
  random: () => number = Math.random,
): SleepDreamSlot[] => {
  const minute = 60 * 1000;
  const latest = autoHangupAt ? autoHangupAt - SLEEP_DREAM_HANGUP_MARGIN_MS : Infinity;
  const slots: SleepDreamSlot[] = [];
  SLEEP_DREAM_WINDOWS.forEach((window, index) => {
    const dueAt = startAt + (window.fromMin + random() * (window.toMin - window.fromMin)) * minute;
    const hit = random() < window.chance;
    if (hit && dueAt <= latest) slots.push({ dreamIndex: index, dueAt: Math.round(dueAt) });
  });
  if (slots.length === 0 && autoHangupAt && autoHangupAt - startAt >= 20 * minute) {
    const span = autoHangupAt - startAt;
    slots.push({ dreamIndex: 0, dueAt: Math.round(startAt + span * (0.5 + random() * 0.3)) });
  }
  return slots;
};

const AUTO_HANGUP_KEY = 'sully-call-sleep-autohangup-v1';

/** 上次选的定时挂断分钟数（0 = 不自动挂断）。跨通话记住，省得每次陪睡都要重选。 */
export const loadSleepAutoHangupMinutes = (): number => {
  try {
    const raw = localStorage.getItem(AUTO_HANGUP_KEY);
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
};

export const saveSleepAutoHangupMinutes = (minutes: number): void => {
  try {
    localStorage.setItem(AUTO_HANGUP_KEY, String(Math.max(0, Math.floor(minutes) || 0)));
  } catch {
    // Safari 隐私模式 / 内嵌 WebView 可能拒写，忽略即可，下次开陪睡回到默认「不自动挂断」。
  }
};
