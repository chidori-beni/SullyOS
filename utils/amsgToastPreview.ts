/** 将主动消息正文压成适合 APP 内部横幅 / 系统通知的一行预览。 */
export const formatAmsgPreviewBody = (body: unknown): string => {
  const raw = typeof body === 'string' ? body : '';
  const preview = raw
    .replace(/\s+/g, ' ')
    .replace(/\[\[(?:RECALL|SEARCH|READ_DIARY|FS_READ_DIARY|READ_NOTE|XHS_[A-Z_]+|SEND_EMOJI|POKE|TRANSFER|ADD_EVENT|MUSIC_ACTION|CALL_INVITE|SCHEDULE_MESSAGE)[^\]]*\]\]/g, '')
    .trim();
  return preview.length > 96 ? `${preview.slice(0, 96).trimEnd()}…` : preview;
};

export const formatAmsgToastText = (charName: unknown, body: unknown): string => {
  const who = typeof charName === 'string' && charName.trim() ? charName.trim() : '角色';
  const preview = formatAmsgPreviewBody(body);
  return preview ? `${who}：${preview}` : `${who} 给你发了消息`;
};
