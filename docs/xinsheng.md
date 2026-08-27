# 心声（Xinsheng）

角色回复之后，点那条消息上的**角色头像**，弹出的那张「内心戏卡片」。

移植自糯叽机 4.64，**布局语法、CSS 类名、预设文件格式全部一比一兼容** —— 糯叽机论坛上的心声美化
（`.json` 预设）可以直接导入 Sully 使用，不用改一个字。

---

## 目录

1. [它是怎么工作的](#它是怎么工作的)
2. [开启与入口](#开启与入口)
3. [两种显示模式](#两种显示模式)
4. [布局模板 — @指令语法](#布局模板--指令语法)
5. [容器与条件渲染](#容器与条件渲染)
6. [动画修饰符](#动画修饰符)
7. [粒子背景](#粒子背景)
8. [内建系统变量](#内建系统变量)
9. [CSS 美化](#css-美化)
10. [交互开关（checkbox hack）](#交互开关checkbox-hack)
11. [自定义提示词](#自定义提示词)
12. [AI 可见字段与内心连续性](#ai-可见字段与内心连续性)
13. [预设库](#预设库)
14. [和糯叽机的差异](#和糯叽机的差异)
15. [代码位置](#代码位置)

---

## 它是怎么工作的

开启后，system prompt 里会多一段指令，要求模型在**每条回复的最后一行**追加一个单行 JSON：

```
{"t":"xinsheng","innerVoice":"想再多待一会儿","statusText":"悄悄瞟向你手里的零食","temperature":"36.8°C","emotionLevel":82,"moodDelta":"+4"}
```

前端在任何渲染发生之前把这一行**摘掉**（绝不会变成气泡，也绝不会进推送横幅），解析成一条心声，
按「轮」存进心声库。本轮落库的每条 assistant 消息都会带上同一个 `roundId`，
所以点这一轮任意一条气泡的头像，打开的都是同一张卡。

`{"t":"xinsheng"` 这个开头是**硬锚点**，解析器只认它。自定义提示词可以换掉全部字段，
但这个开头不能改。

---

## 开启与入口

| 想做什么 | 去哪 |
|-|-|
| 打开 / 关闭心声、改布局、改 CSS、管预设 | 聊天页 → 加号面板 → **心声** |
| 看某一轮的心声卡 | 点那一轮消息上的**角色头像**（存过心声的才可点） |
| 翻历史 / 收藏 / 删除 | 心声卡上的翻页按钮，或右上角「历史」 |

**默认关闭，每个角色单独开。** 关着的角色 prompt 里一个字都不会多，解析器也完全不介入 ——
即使模型自己幻觉出一行 xinsheng JSON 也不会凭空冒出一张卡。

历史上限 **100 条**，超出后从最旧的开始淘汰，**收藏过的永远不淘汰**。
「清空全部」同样保留收藏。

---

## 两种显示模式

### 默认卡（planner）

Sully 风格的玻璃拟态卡，字段固定：内心独白、此刻、体温 / 情绪 / 本轮波动，
外加一个「自定义字段」区 —— 自定义提示词多吐的字段都会自动列在那里。
**外观不可自定义**，但配合自定义提示词可以改变内容。

### 布局模板（layout）

用 **@指令** 定义结构 + **CSS** 美化样式。自由度最高，论坛上的心声美化全部走这条。

```
你写 @指令 → 系统解析成安全组件 → 渲染到屏幕 → 你的 CSS 美化它
```

全程无 HTML、无 JS。

---

## 布局模板 — @指令语法

### 基本规则

- 每行一个 `@指令`，后面跟参数
- `#` 开头的行是注释，空行忽略
- **缩进两个以上空格**的行归属上方最近的容器指令；顶格的非 `@` 行会被当成 `@text`
- 参数里有空格要用**双引号**包起来
- 指令末尾可以加**动画修饰符**，如 `.fadeInUp.delay200`
- 字段名对应 AI 输出的 JSON key，大小写敏感

### 指令一览

| 指令 | 写法 | 说明 |
|-|-|-|
| `@header` | `@header charImage charName` | 头像 + 名字 |
| `@duo` | `@duo charImage charName userImage userName` | 双头像 + 中间爱心 |
| `@badge` | `@badge emotionLevel "%"` | 小标签：值 + 后缀 |
| `@section` | `@section 内心独白` + 缩进字段 | 带标题的区块 |
| `@text` | `@text statusText` | 全宽单字段 |
| `@quote` | `@quote innerVoice` | 带大引号的引用块 |
| `@grid` | `@grid 3` + 缩进 `字段:类型 "标签"` | N 列网格（≤6）。类型：`stat`（默认）/ `bar` / `badge` |
| `@bar` | `@bar trustLevel "信任"` | 进度条，值 0–100 |
| `@ring` | `@ring emotionLevel "情绪"` | SVG 圆环，值 0–100 |
| `@gauge` | `@gauge affection "好感"` | 半圆仪表盘，值 0–100 |
| `@wave` | `@wave moodLevel "情绪水位"` | 水位波浪，值 0–100 |
| `@compare` | `@compare wantStay wantLeave "想留" "想走"` | 双向拉扯对比条 |
| `@rating` / `@stars` | `@rating closeness "亲近度" 5` | 星级，第三个参数是满分（≤10） |
| `@sparkline` / `@spark` | `@sparkline moodTrend "趋势"` | 迷你折线，字段是数字数组 |
| `@heatmap` | `@heatmap weekMood "这七天" 7` | 热力格，第三个参数是列数（≤14） |
| `@list` | `@list` + 缩进字段 | 列表。系统自动识别 `{字段}Done` 显示勾选 |
| `@tags` | `@tags` + 缩进字段或 `"固定文字"` | 标签云 |
| `@bubbles` | `@bubbles` + 缩进 `字段:left`/`:right` | 聊天气泡 |
| `@timeline` | `@timeline` + 缩进 `"08:00" \| wakeUp` | 时间线，`\|` 分段 |
| `@table` | `@table` + 缩进 `"列1" \| "列2"` | 表格，第一行是表头 |
| `@kv` | `@kv` + 缩进 `键 : 字段` | 键值对列表 |
| `@marquee` | `@marquee secretThought` | 水平跑马灯 |
| `@image` | `@image letterImage` | 图片，字段值是 URL |
| `@bg` | `@bg charImage blur` | 卡片背景图。第二参数是模式类名（`.xt-bg-blur`） |
| `@particles` | `@particles sakura 20` | 粒子背景，见下 |
| `@divider` | `@divider` | 分隔线 |
| `@spacer` | `@spacer 24` | 空白，默认 16px |
| `@footer` | `@footer XINSHENG v1` | 底部小字 |
| `@toggle` | `@toggle 1` | 第 N 个交互按钮（1–8） |

### 内建特殊字段

不需要 AI 输出，系统自动填：`charImage` / `charName` / `userImage` / `userName`。
更多见[内建系统变量](#内建系统变量)。

---

## 容器与条件渲染

容器要用 `@end*` 收口。所有 `@end*` 等价（`@end` / `@endrow` / `@endcard` / `@endcollapse` / `@endif` / `@endeach`），
写错顶多提前收口，不会整卡崩。

### `@row` — 水平多列

```
@row 2
@card "左"
  @quote innerVoice
@endcard
@card "右"
  @text statusText
@endcard
@endrow
```

### `@card` — 嵌套卡片

```
@card "TA的心声"
  @quote innerVoice
@endcard
```

### `@collapse` — 可折叠区块

```
@collapse "💭 内心独白" 1
  @quote innerVoice
@endcollapse
```

第二个参数是 toggle 编号（1–8）。**不同折叠块必须用不同编号。**

### `@each` — 数组循环

```
@each thoughts
  @quote item
@endeach
```

字段是数组（或能 `JSON.parse` 成数组的字符串）。循环体里用 `item` 引用当前元素，
元素是对象时用 `item.字段名`。最多渲染 50 个。

### `@if` / `@else`

```
@if emotionLevel > 80
  @marquee secretHappy .shimmer
@else
  @text statusText
@endif
```

运算符：`>` `<` `>=` `<=` `=` `==` `!=` `contains` `between`。
省略运算符和值 = 判断字段是否有值。

多条件用 `and` / `or`（或 `&&` / `||`）连接，**同一行里只要出现一个 `or`，整行就按 or 判定**：

```
@if emotionLevel > 80 and mood = happy
@if moodLevel between 40 70
```

---

## 动画修饰符

在任意 `@指令` 末尾追加 `.名字`，多个用 `.` 连接。

**入场**：`.fadeIn` `.fadeInUp` `.fadeInDown` `.slideInLeft` `.slideInRight` `.scaleIn` `.blurIn` `.flipIn`
**持续**：`.pulse` `.glow` `.breathe` `.float` `.shimmer`
**数值**：`.typewriter`（逐字出字） `.countUp`（数字从 0 缓动）
**时间**：`.delay100` ~ `.delay1000`、`.slow`（0.8s）、`.fast`（0.2s）
**容器**：`.stagger`（子元素依次入场，间隔 `--xt-stagger-delay`，默认 80ms）

修饰符渲染成 `xt-anim-*` 类名，你的 CSS 可以覆盖它们：

```css
.xt-root {
    --xt-anim-duration: 0.6s;
    --xt-anim-easing: ease-out;
    --xt-stagger-delay: 120ms;
    --xt-glow-color: rgba(255,100,100,0.4);
}
/* 改 stagger 子元素的动画 */
.xt-anim-stagger > * { animation-name: xt-slideInLeft; }
```

---

## 粒子背景

```
@particles 效果 [数量] ["自订字元"]
```

参数**无序**：纯数字 = 数量（≤50，默认 25），纯字母 = 效果名，其它 = 自订字元（取前 2 个码点）。

效果：`snow` `rain` `stars` `hearts` `sakura` `bubble` `firefly` `leaves` `matrix` `emoji`

只给字元不给效果名会自动切到 `emoji`：`@particles 14 "✧"`。

粒子层在内容下方作为背景，不挡点击。建议 20–30 个，纯 CSS 动画，没有 JS。

---

## 内建系统变量

无需 AI 输出，由本地数据填充。**AI 输出了同名字段时以 AI 为准。**

| 字段 | 说明 |
|-|-|
| `currentDate` / `currentTime` / `dayOfWeek` | 用户本地日期 / 时间 / 星期 |
| `todayTodos` | 今日待办列表（多行，`✓` / `○` 前缀） |
| `todoProgress` | 完成百分比 0–100 |
| `todoCount` / `todoDoneCount` | 今日待办总数 / 已完成数 |
| `bondDays` | 在一起天数 |
| `anniversary` | 纪念日日期 |
| `messageCount` | 与该角色的总消息数 |

> **和糯叽机不同的地方**：Sully 没有「情侣空间开始日期」这个字段，
> `bondDays` / `anniversary` 取的是**该角色最早的一条纪念日**（日程 App 里 kind=纪念日 的那种）。
> 一条纪念日都没有时这两个变量不存在，布局里对应位置留空。
>
> `todayTodos` 取的是待办 App 里今天到期的项；**没填截止日的待办也算今天**
>（跟糯叽机一致，否则随手记的待办永远不进统计）。

---

## CSS 美化

布局生成的所有元素都带 `.xt-*` 前缀。内置默认 CSS 先注入，你的自定义 CSS 后注入，所以能直接覆盖。

### CSS 变量（最快的换肤方式）

```css
.xt-root {
    --xt-bg: #0e1117;
    --xt-text: #e0e0e0;
    --xt-text-sub: #8888aa;
    --xt-text-muted: #555;
    --xt-accent: #63b3ed;
    --xt-accent-bg: rgba(99,179,237,0.1);
    --xt-border: #2a2a44;
    --xt-radius: 20px;
    --xt-radius-sm: 10px;
    --xt-font: "Kaiti", serif;
    --xt-shadow-sm / --xt-shadow-md / --xt-shadow-lg
}
```

### 选择器速查

| 选择器 | 元素 |
|-|-|
| `.xt-root` / `.xt-content` | 最外层 / 内容区 |
| `.xt-header` `.xt-avatar` `.xt-name` | 头部 |
| `.xt-duo` `.xt-duo-avatar` `.xt-duo-heart` `.xt-duo-name` | 双头像 |
| `.xt-badge` `.xt-badge-value` `.xt-badge-suffix` | 徽章 |
| `.xt-section` `.xt-section-title` `.xt-section-body` | 区块 |
| `.xt-text` / `.xt-text-{字段}` / `.xt-text-content` | 独立文字 |
| `.xt-quote` | 引用（引号是 `::before` / `::after`） |
| `.xt-grid` `.xt-grid-N` `.xt-grid-stat` `.xt-grid-bar` `.xt-grid-badge` `.xt-grid-item-{字段}` | 网格 |
| `.xt-bar` `.xt-bar-{字段}` `.xt-bar-track` `.xt-bar-fill` `.xt-bar-label` | 进度条 |
| `.xt-ring` `.xt-ring-svg` `.xt-ring-track` `.xt-ring-fill` `.xt-ring-value` `.xt-ring-label` | 圆环 |
| `.xt-gauge` `.xt-gauge-svg` `.xt-gauge-fill` `.xt-gauge-value` `.xt-gauge-label` | 仪表盘 |
| `.xt-wave` `.xt-wave-body` `.xt-wave-fill` `.xt-wave-surface` `.xt-wave-value` | 水位 |
| `.xt-compare` `.xt-compare-track` `.xt-compare-a` `.xt-compare-b` `.xt-compare-num` | 对比条 |
| `.xt-rating` `.xt-rating-stars` `.xt-rating-star` `.xt-rating-star-on` | 星级 |
| `.xt-sparkline` `.xt-sparkline-line` `.xt-sparkline-area` `.xt-sparkline-dot` | 折线 |
| `.xt-heatmap` `.xt-heatmap-grid` `.xt-heatmap-cell` `.xt-heatmap-lv0`~`lv4` | 热力格 |
| `.xt-list` `.xt-list-item` `.xt-list-item-{字段}` `.xt-list-item-on` `.xt-list-check` `.xt-list-text` | 列表 |
| `.xt-tags` `.xt-tag` `.xt-tag-{字段}` | 标签云 |
| `.xt-bubbles` `.xt-bubble` `.xt-bubble-left` `.xt-bubble-right` `.xt-bubble-body` | 气泡 |
| `.xt-timeline` `.xt-timeline-item` `.xt-timeline-dot` `.xt-timeline-title` `.xt-timeline-sub` | 时间线 |
| `.xt-table` `.xt-table-row` `.xt-table-row-head` `.xt-table-cell` | 表格 |
| `.xt-kv` `.xt-kv-row` `.xt-kv-{字段}` `.xt-kv-key` `.xt-kv-val` | 键值对 |
| `.xt-marquee` `.xt-marquee-inner` | 跑马灯 |
| `.xt-row` `.xt-card` `.xt-card-title` | 容器 |
| `.xt-collapse` `.xt-collapse-N` `.xt-collapse-header` `.xt-collapse-arrow` `.xt-collapse-body` | 折叠 |
| `.xt-image` / `.xt-image-{字段}` `.xt-bg` `.xt-divider` `.xt-spacer` `.xt-footer` | 其它 |
| `.xt-particles` `.xt-particles-{效果}` `.xt-particle` | 粒子 |
| `.xt-action-N` | 第 N 个交互按钮 |
| `.xt-typing` `.xt-typing-on` `.xt-num` | 打字机 / 数字滚动 |

### 数据驱动的钩子

心声字段会自动变成 CSS 钩子，让样式跟着数据变：

- **数字字段** → `.xt-root` 上的 CSS 变量 `--xt-f-{字段}`
  ```css
  .xt-bar-fill { filter: hue-rotate(calc(var(--xt-f-emotionLevel, 50) * 2deg)); }
  ```
- **文本字段** → `.xt-root` 上的类名 `xt-v-{字段}-{值}`（值会被 slugify，非 ASCII 会被丢弃）
  ```css
  .xt-v-mood-angry { --xt-accent: #e05252; }
  .xt-v-mood-calm  { --xt-accent: #6aa9d0; }
  ```

上限：最多扫 120 个键，最多生成 30 个类名。

### 其它

`@import url(...)` 导入外部字体、`@keyframes`、伪元素装饰、`backdrop-filter` 都可以正常用。
自定义 CSS 是**原样注入**的，不做作用域改写。

---

## 交互开关（checkbox hack）

布局里内置了 8 个隐藏 checkbox（`#xt-t1` ~ `#xt-t8`），它们是 `.xt-content` 的**前置兄弟**。
`@toggle N` 产出对应的 label 按钮 `.xt-action-N`。

```
@section 内心独白
  innerVoice
@toggle 1
```

```css
.xt-section-body { filter: blur(6px); transition: filter .4s; }
.xt-action-1 { display:block; padding:10px; text-align:center; background:var(--xt-accent); color:#fff; border-radius:10px; }
.xt-action-1::after { content: "🔓 点击解锁"; }

#xt-t1:checked ~ .xt-content .xt-section-body { filter: none; }
#xt-t1:checked ~ .xt-content .xt-action-1::after { content: "🔒 已解锁"; }
```

格式固定是 `#xt-tN:checked ~ .xt-content 目标 { … }`。
`@collapse` 内部已经绑好，不用自己写。

---

## 自定义提示词

「提示词」页签留空 = 用内置指令。填了就完全替换。

**唯一硬性要求**：让模型输出 `{"t":"xinsheng"` 开头的**单行** JSON。系统靠这个锚点摘它。
丢了锚点，那行 JSON 会原样变成聊天气泡。

系统会自动在你写的内容前面补两句：「追加到回复最末尾」+「必须以 `{"t":"xinsheng"` 开头」，
所以你只需要写字段定义。额外字段会：

- 布局模板里直接按字段名引用
- 默认卡里自动列在「自定义字段」区

---

## AI 可见字段与内心连续性

「字段」页签填逗号分隔的字段名（默认 `innerVoice`）。下一轮生成时，模型会看到这些字段
**最近 3 轮**的值，注入形式是：

```
[INNER-CONTINUITY] Your private interior over recent turns …
· (just now) innerVoice="想再多待一会儿"
· (30min ago) innerVoice="有点困了"
```

作用是让内心戏有连续性 —— 当前情绪从上一轮流下来，而不是每轮凭空重开。

**留空 = 模型完全看不到自己的心声。** 想要每轮内心戏彼此独立就留空。

这一段注入在 volatileState（历史之后的那条 system），不进稳定前缀 —— 它每轮都变，
放稳定段会打断 prompt 前缀缓存。

---

## 预设库

一个预设 = 布局 + CSS + 提示词 + 可见字段，四件套一起分发。**全局共享**，所有角色都能用。

- **保存**：把当前设置存成预设
- **载入**：把预设填进编辑区 —— 载入后要回「总览」点右上角**保存**才对角色生效
- **覆盖**：用当前设置更新已有预设
- **导出**：下载 `.json`
- **导入**：选 `.json`，追加到库里；重名自动加 `(2)` `(3)`，不覆盖正在用的那份

导出格式和糯叽机完全一致，两边可以互导：

```json
{
  "type": "nuojiji.xinsheng.preset",
  "version": 2,
  "exportedAt": "...",
  "preset": { "name": "…", "customCss": "…", "customPrompt": "…", "layout": "…", "displayMode": "layout", "aiVisibleFields": "innerVoice" }
}
```

导入也认多预设信封 `{presets:[…]}` 和裸数组 `[…]`。

### 每次生成随机套一个预设

打开后，每轮回复前从预设库随机挑一个（**避开上一次抽中的那个**），
这一轮就用它的提示词、CSS 和布局。

抽中的样式**跟着那条心声一起存**，所以历史里的旧卡永远保持它生成时的样子。
（糯叽机的做法是直接改写角色档案，结果是旧卡会跟着一起变皮。）

---

## 和糯叽机的差异

| 项 | 糯叽机 4.64 | Sully |
|-|-|-|
| 布局语法 / CSS 类名 / DOM 结构 | — | **完全一致**，美化可直接用 |
| 预设文件格式 | `nuojiji.xinsheng.preset` v2 | **完全一致**，可互导 |
| 默认（非布局）卡外观 | 蓝灰手账本，四个页签 | Sully 玻璃拟态卡，字段与功能相同 |
| 卡片入口 | 点消息头像 | 同 |
| 历史上限 / 收藏 | 100 条，收藏不淘汰 | 同 |
| `bondDays` / `anniversary` | 情侣空间开始日期 | 该角色最早的一条纪念日 |
| 随机预设 | 抽中后写回角色档案（旧卡跟着变皮） | 只作用于本轮，存进那条记录（旧卡保持原样） |
| JSON 坏掉时的兜底 | 只捞 9 个内置字段，自定义字段全丢 | 内置字段之外再扫一遍简单键值，尽量不丢 |
| `@bg` 的 URL 转义 | `encodeURIComponent`（实际不转义 `'()!*`） | 显式编码 `"'()\\;{}` 与空白 |

---

## 代码位置

| 文件 | 职责 |
|-|-|
| `utils/xinsheng/xinshengLayout.ts` | @指令 DSL 解析（**兼容层，不要"顺手优化"**） |
| `utils/xinsheng/xinshengDefaultCss.ts` | 内置默认 CSS（与糯叽机逐字一致） |
| `utils/xinsheng/xinshengTemplates.ts` | 8 个内置范例布局 |
| `utils/xinsheng/xinshengData.ts` | JSON 行的摘取、修复、归一 |
| `utils/xinsheng/xinshengStore.ts` | 历史 + 预设库（走 `DB.getAssetRaw`，不新建 objectStore） |
| `utils/xinsheng/xinshengPrompt.ts` | 生成指令 + `[INNER-CONTINUITY]` |
| `utils/xinsheng/xinshengSystemData.ts` | 内建系统变量 |
| `utils/xinsheng/xinshengRound.ts` | roundId（消息 metadata 上的 `xinshengRoundId`） |
| `utils/xinsheng/xinshengRandomPreset.ts` | 「随机套预设」的本轮 override |
| `utils/xinsheng/xinshengEvents.ts` | 落库广播 |
| `components/chat/xinsheng/XinshengLayoutRenderer.tsx` | 布局渲染（**DOM 契约文件**） |
| `components/chat/xinsheng/XinshengCard.tsx` | 默认卡 |
| `components/chat/xinsheng/XinshengCardModal.tsx` | 卡片弹层 + 历史 |
| `components/chat/xinsheng/XinshengSettingsModal.tsx` | 自定义面板 |

挂载点（都是小改动）：`types.ts`（6 个角色字段）、`utils/chatPrompts.ts`（两段注入）、
`utils/applyAssistantPostProcessing.ts`（摘取 + 落库 + 打 roundId）、
`utils/sanitize.ts`（横幅/气泡/分段三条路径的兜底）、
`components/chat/MessageItem.tsx`（头像可点）、`components/chat/ChatInputArea.tsx`（加号面板按钮）、
`apps/Chat.tsx`（两个弹层接线）。

测试在 `utils/xinsheng/*.test.ts`。
其中 `xinshengRenderer.test.ts` 是**DOM 契约测试** —— 它挂了就说明论坛美化会失效，
不要靠改断言让它变绿。
