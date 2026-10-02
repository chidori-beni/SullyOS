import type { CharacterProfile } from '../types';

/**
 * 线上聊天界面显示的名字：填了网名就用网名，否则真名。
 * 只给界面用——提示词、消息、见面、通话里永远是 character.name。
 * （上游这里是「把描述当备注显示」，本 fork 改成单独的网名字段，描述原样保留。）
 */
export function chatCharacterDisplayName(character: Pick<CharacterProfile, 'name' | 'chatNickname'>): string {
    return character.chatNickname?.trim() || character.name;
}
