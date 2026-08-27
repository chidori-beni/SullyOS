// 心声布局模板的内置范例（「布局」页签里一键加载的那几个）。
//
// 与糯叽机 4.64 内置的 8 个模板逐字一致 —— 用户照着教程或论坛帖改的时候，
// 一键加载出来的东西必须和别人截图里的一模一样，否则连从哪一行下手都对不上。
export interface XinshengTemplate {
    id: string;
    /** 「布局」页签按钮上的中文名 */
    name: string;
    layout: string;
}

export const XINSHENG_TPL_CLASSIC = "# 心声经典布局 — 可自由修改\n@header charImage charName .fadeInDown\n@badge emotionLevel \"%\" .fadeIn.delay200\n\n@section 内心独白 .fadeInUp.delay100\n  innerVoice\n\n@section 细微观察 .fadeInUp.delay200\n  statusText\n\n@grid 3 .stagger\n  temperature:stat \"体温\"\n  emotionLevel:bar \"情绪\"\n  moodDelta:stat \"波动\"\n\n@footer XINSHENG";

export const XINSHENG_TPL_DIAGNOSTIC = "# 诊断卡片风格\n@header charImage charName .fadeInDown\n@badge bondDays \"DAY\" .scaleIn.delay200\n\n@section INNER VOICE .fadeInUp.delay100\n  innerVoice\n\n@section BEHAVIOR .fadeInUp.delay200\n  actionBehavior\n\n@grid 3 .stagger\n  mood:stat \"MOOD\"\n  bloodPressure:stat \"BP\"\n  hunger:bar \"HUNGER\"\n\n@bar hunger \"HUNGER LEVEL\" .fadeIn.delay400\n\n@section NOW PLAYING .fadeInUp.delay300\n  bgmTitle\n\n@list .stagger\n  todo1\n  todo2\n  todo3\n\n@footer PSY-DIAG v1.0 .fadeIn.delay500";

export const XINSHENG_TPL_CHAT_SIM = "# 聊天模拟风格\n@header charImage charName .fadeInDown\n\n@toggle 1\n\n@bubbles .stagger\n  msg1:left\n  msg2:right\n  msg3:left\n  msg4:right\n  msg5:left\n\n@divider\n\n@section 内心独白 .fadeInUp\n  innerVoice\n\n@grid 2 .stagger\n  mood:stat \"心情\"\n  emotionLevel:bar \"情绪\"";

export const XINSHENG_TPL_COUPLE = "# 情侣卡片 — 双头像 + 条件渲染\n@duo charImage charName userImage userName .fadeInDown\n@badge bondDays \"天\" .scaleIn.delay200\n\n@row 2\n@card \"TA的心声\"\n  @quote innerVoice .fadeInUp\n@endcard\n@card \"此刻状态\"\n  @text statusText .fadeInUp\n  @ring emotionLevel \"情绪\" .scaleIn.delay300\n@endcard\n@endrow\n\n@if emotionLevel > 80\n  @marquee secretHappy .shimmer\n@endif\n\n@tags .fadeIn.delay400\n  mood\n  weather\n  \"❤️\"\n\n@footer WITH YOU";

export const XINSHENG_TPL_SYSTEM_VARS = "# 系统变量展示 — 日历+情侣+粒子\n@particles sakura 20\n@duo charImage charName userImage userName .fadeInDown\n@badge bondDays \"天\" .scaleIn.delay200\n\n@row 2\n@card \"今日\"\n  @text currentDate .fadeIn\n  @text dayOfWeek\n  @bar todoProgress \"待办进度\" .fadeInUp\n@endcard\n@card \"数据\"\n  @ring emotionLevel \"情绪\" .scaleIn\n  @badge messageCount \"条消息\"\n@endcard\n@endrow\n\n@collapse \"📋 今日待办\" 1 .fadeInUp.delay200\n  @text todayTodos\n@endcollapse\n\n@section 内心独白 .fadeInUp.delay300\n  innerVoice\n\n@footer WITH YOU";

export const XINSHENG_TPL_COLLAPSE = "# 折叠面板 — 多区域可展开\n@header charImage charName .fadeInDown\n@ring emotionLevel \"情绪\" .scaleIn.delay200\n\n@collapse \"💭 内心独白\" 1 .fadeInUp.delay100\n  @quote innerVoice\n  @text statusText\n@endcollapse\n\n@collapse \"📊 详细数据\" 2 .fadeInUp.delay200\n  @grid 3 .stagger\n    temperature:stat \"体温\"\n    emotionLevel:bar \"情绪\"\n    moodDelta:stat \"波动\"\n  @bar emotionLevel \"情绪指数\"\n@endcollapse\n\n@collapse \"💬 内心对话\" 3 .fadeInUp.delay300\n  @bubbles .stagger\n    msg1:left\n    msg2:right\n    msg3:left\n@endcollapse\n\n@footer XINSHENG v2";

export const XINSHENG_TPL_LIVE_MOOD = "# 情绪实况 — 波浪/对比/热力格 + 数据驱动配色\n# 提示词需让 AI 额外输出：\n#   moodLevel  0-100 数字（水位）\n#   wantStay / wantLeave  两个 0-100 数字（拉扯对比）\n#   weekMood   7 个数字，如 [30,55,20,70,90,45,60]\n#   mood       英文单词状态，如 calm / angry / happy（驱动配色）\n@bg charImage blur\n@particles emoji \"✧\" 14\n\n@header charImage charName .fadeInDown\n@badge intimacy \"%\" .countUp.delay200\n\n@row 2\n@card \"此刻\"\n  @wave moodLevel \"情绪水位\"\n@endcard\n@card \"心里的拉扯\"\n  @compare wantStay wantLeave \"想留下\" \"想逃开\"\n  @rating closeness \"亲近度\"\n@endcard\n@endrow\n\n@quote innerVoice .typewriter\n\n@heatmap weekMood \"这七天\" 7 .fadeInUp.delay300\n\n@if moodLevel between 40 70\n  @text statusText .fadeIn\n@else\n  @marquee statusText .shimmer\n@endif\n\n@footer LIVE";

export const XINSHENG_TPL_DATA_DRIVEN = "# 数据驱动 — @each 循环 + 新组件\n# 提示词需让 AI 额外输出这些字段：\n#   moodTrend  数字数组，如 [40,55,48,70,66]\n#   affection  0-100 数字\n#   closeness  0-5 数字\n#   thoughts   字符串数组，如 [\"想靠近你\",\"又有点怕\"]\n@header charImage charName .fadeInDown\n\n@row 2\n@card \"好感度\"\n  @gauge affection \"AFFECTION\"\n@endcard\n@card \"亲密度\"\n  @rating closeness \"CLOSENESS\"\n@endcard\n@endrow\n\n@sparkline moodTrend \"情绪波动趋势\" .fadeInUp.delay100\n\n@section 脑内闪过的念头 .fadeInUp.delay200\n# thoughts 是数组，数量由 AI 决定，@each 逐个渲染\n@each thoughts\n  @quote item\n@endeach\n\n@kv .fadeInUp.delay300\n  好感度 : affection\n  当前心情 : mood\n  此刻时间 : currentTime\n\n@footer DATA-DRIVEN v1";

export const XINSHENG_TEMPLATES: XinshengTemplate[] = [
    { id: 'classic', name: '经典布局', layout: XINSHENG_TPL_CLASSIC },
    { id: 'diagnostic', name: '诊断卡片', layout: XINSHENG_TPL_DIAGNOSTIC },
    { id: 'chat-sim', name: '聊天模拟', layout: XINSHENG_TPL_CHAT_SIM },
    { id: 'couple', name: '情侣卡片', layout: XINSHENG_TPL_COUPLE },
    { id: 'system-vars', name: '系统变量+粒子', layout: XINSHENG_TPL_SYSTEM_VARS },
    { id: 'collapse', name: '折叠面板', layout: XINSHENG_TPL_COLLAPSE },
    { id: 'live-mood', name: '情绪实况', layout: XINSHENG_TPL_LIVE_MOOD },
    { id: 'data-driven', name: '数据驱动', layout: XINSHENG_TPL_DATA_DRIVEN },
];
