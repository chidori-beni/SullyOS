import type { CharacterProfile } from '../types';

/**
 * 角色「备注」（字段名 chatNickname，37c 上线时叫「网名」，改名会丢已填的数据所以没改）。
 * 线上的地方显示备注：私聊顶栏、切换会话、消息列表、首页消息小窗、朋友圈、消息横幅与系统通知。
 * 提示词、消息正文、见面、通话里永远是 character.name——角色自己只认真名。
 * （上游这里是「把描述当备注显示」，本 fork 改成单独字段，描述原样保留。）
 */
export function chatCharacterDisplayName(character: Pick<CharacterProfile, 'name' | 'chatNickname'>): string {
    return character.chatNickname?.trim() || character.name;
}

// 横幅 / 通知这些地方只拿得到 charId（事件里带的名字是真名或云端快照），
// OSProvider 在角色变化时把显示名表写到这里。跟 charNameRegistry（给提示词用的真名表）分开。
let displayNames: Record<string, string> = {};
export function setChatDisplayNames(chars: Array<Pick<CharacterProfile, 'id' | 'name' | 'chatNickname'>>): void {
    const next: Record<string, string> = {};
    for (const c of chars) if (c?.id && c?.name) next[c.id] = chatCharacterDisplayName(c);
    displayNames = next;
}
/** 按 charId 取显示名；找不到角色就用传进来的名字。 */
export function chatDisplayNameById(charId: string | undefined | null, fallback = ''): string {
    return (charId && displayNames[charId]) || fallback;
}
