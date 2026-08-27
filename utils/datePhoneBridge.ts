import type { CharacterProfile, Message } from '../types';

/** Metadata on the one real online message saved while an encounter is active. */
export const DATE_PHONE_MESSAGE_FLAG = 'datePhoneMessage';
export const DATE_PHONE_BRIDGE_FLAG = 'datePhoneBridge';

export const isDatePhoneMessage = (message: Pick<Message, 'metadata'>): boolean => (
    message.metadata?.[DATE_PHONE_MESSAGE_FLAG] === true
    && typeof message.metadata?.dateEncounterId === 'string'
);

export const isDatePhoneBridge = (message: Pick<Message, 'metadata'>): boolean => (
    message.metadata?.[DATE_PHONE_BRIDGE_FLAG] === true
);

/**
 * Markdown-compatible source used by the display-only bridge. It is deliberately
 * not persisted as a new Message: the original ChatApp message remains the only
 * memory/prompt input.
 */
export const formatDatePhoneMarkdown = (message: Message, speakerName: string): string => {
    const body = String(message.content || '').replace(/\r\n/g, '\n').trim();
    const quoted = body.split('\n').map(line => `> ${line}`).join('\n');
    return `**${speakerName}** · 手机消息\n\n${quoted}`;
};

/**
 * Build a read-only projection without changing the original message id/content.
 * Keeping the id allows the existing edit/delete UI to operate on the real record;
 * the bridge flag prevents it from ever being sent to an API or memory pipeline.
 */
export const makeDatePhoneBridgeMessage = (
    message: Message,
    userProfileName: string,
    charName: string,
): Message => {
    const speakerName = message.role === 'user' ? (userProfileName || '用户') : charName;
    return {
        ...message,
        metadata: {
            ...(message.metadata || {}),
            [DATE_PHONE_BRIDGE_FLAG]: true,
            datePhoneMarkdown: formatDatePhoneMarkdown(message, speakerName),
            datePhoneSpeaker: speakerName,
        },
    };
};

/**
 * Merge linked phone messages into a date timeline for rendering only.
 * The returned array contains cloned projections; callers must continue using
 * DB-loaded date messages for prompt construction, reroll and memory extraction.
 */
export const mergeDatePhoneMessages = (
    dateMessages: Message[],
    allMessages: Message[],
    encounterId: string | readonly string[] | undefined,
    userProfileName: string,
    charName: string,
): Message[] => {
    const encounterIds = new Set(
        (Array.isArray(encounterId) ? encounterId : encounterId ? [encounterId] : [])
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    if (encounterIds.size === 0) return dateMessages;
    const linked = allMessages
        .filter(message => isDatePhoneMessage(message)
            && encounterIds.has(String(message.metadata?.dateEncounterId || '')))
        .map(message => makeDatePhoneBridgeMessage(message, userProfileName, charName));
    if (linked.length === 0) return dateMessages;
    const byId = new Map<number, Message>();
    [...dateMessages, ...linked].forEach(message => {
        // Date rows and phone rows have distinct DB ids; prefer the actual date row
        // if a caller accidentally passes a bridge twice.
        if (!byId.has(message.id) || !isDatePhoneBridge(message)) byId.set(message.id, message);
    });
    return Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
};

export const getDatePhoneSpeaker = (message: Message, char: CharacterProfile, userProfileName: string): string => (
    message.metadata?.datePhoneSpeaker
    || (message.role === 'user' ? (userProfileName || '用户') : char.name)
);

