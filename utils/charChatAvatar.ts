import type { CharacterProfile } from '../types';

/**
 * 角色在「聊天软件」里用的头像：私聊、群聊、信息 App 会话列表、朋友圈。
 *
 * 神经链接里的 `avatar` 是角色本人的照片（见面立绘、登场过场、档案都用它）；
 * `chatAvatar` 是角色自己挑的社交头像，没设置就退回本人照片。
 * 任何「把角色当成聊天对象显示」的地方都走这里，别直接读 `char.avatar`。
 */
export function getCharChatAvatar(char: Pick<CharacterProfile, 'avatar' | 'chatAvatar'> | null | undefined): string {
    if (!char) return '';
    return char.chatAvatar || char.avatar || '';
}
