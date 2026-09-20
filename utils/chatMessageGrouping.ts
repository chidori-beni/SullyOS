/**
 * 聊天气泡的时间分组窗口。
 *
 * 同一轮回复拆出的多条气泡共用同一个基准时间（主动消息路径最多只相差
 * 1 毫秒），所以短时间内仍会保持一组；超过几分钟的新一批消息则应显示
 * 自己的时间，而不是继续沿用整组最后一条消息的时间。
 */
export const CHAT_MESSAGE_GROUP_GAP_MS = 5 * 60 * 1000;

export const areMessagesWithinGroupGap = (leftTimestamp: number, rightTimestamp: number): boolean => {
    const gap = Math.abs(leftTimestamp - rightTimestamp);
    return Number.isFinite(gap) && gap <= CHAT_MESSAGE_GROUP_GAP_MS;
};
