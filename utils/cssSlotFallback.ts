/**
 * CSS 槽的「旧字段回填」。
 *
 * 2026-09-04 把一份 globalCustomCss 拆成 chatDialogCustomCss / notifyCustomCss 时，
 * 为了不丢用户已存的内容，读取时回填旧字段。第一版在 apps/Chat.tsx 里写成
 *
 *     osTheme.chatDialogCustomCss || osTheme.globalCustomCss
 *
 * —— `||` 把**空字符串也当成假**。于是用户在编辑器里点「清空」（写入 ''）之后，
 * 页面立刻回退去跑那份旧 CSS，表现为「代码全清空了，美化还在」。
 * 而编辑器那边用的是 `??`，输入框显示为空 —— 两处运算符不一致，症状就更难猜。
 *
 * 这里统一成 `??`：**只有从来没设置过（undefined/null）才回填，空字符串就是空**。
 */
export const resolveCssSlot = (
  current: string | undefined | null,
  legacy?: string | null,
): string => current ?? legacy ?? '';
