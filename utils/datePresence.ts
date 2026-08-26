import type { DateEncounterPresence } from '../types';

/**
 * A small local presence registry shared by DateApp, ChatApp and DB.saveMessage.
 *
 * Character state is persisted as the authoritative snapshot for fire_pack, while
 * this local copy is intentionally immediate: DateApp can be unmounted when the
 * user switches to ChatApp, so the next phone message must still be associated with
 * the active encounter without waiting for a React render or a remote sync.
 */
const STORAGE_PREFIX = 'sully:date-presence:';
const memory = new Map<string, DateEncounterPresence>();

const storageKey = (charId: string) => `${STORAGE_PREFIX}${charId}`;

const canUseStorage = () => {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
        return false;
    }
};

export const makeDateEncounterPresence = (
    encounterId: string,
    startedAt: number,
    status: DateEncounterPresence['status'] = 'active',
): DateEncounterPresence => ({
    encounterId,
    startedAt,
    status,
    updatedAt: Date.now(),
});

export const setActiveDatePresence = (
    charId: string,
    presence: DateEncounterPresence,
): void => {
    memory.set(charId, presence);
    if (!canUseStorage()) return;
    try {
        window.localStorage.setItem(storageKey(charId), JSON.stringify(presence));
    } catch {
        // Private browsing / quota errors must not block a conversation.
    }
};

export const getActiveDatePresence = (charId: string): DateEncounterPresence | null => {
    const cached = memory.get(charId);
    if (cached) return cached;
    if (!canUseStorage()) return null;
    try {
        const raw = window.localStorage.getItem(storageKey(charId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DateEncounterPresence>;
        if (typeof parsed.encounterId !== 'string' || typeof parsed.startedAt !== 'number'
            || (parsed.status !== 'active' && parsed.status !== 'paused')) return null;
        const presence: DateEncounterPresence = {
            encounterId: parsed.encounterId,
            startedAt: parsed.startedAt,
            status: parsed.status,
            updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
        };
        memory.set(charId, presence);
        return presence;
    } catch {
        return null;
    }
};

export const clearActiveDatePresence = (charId: string, encounterId?: string): void => {
    const current = getActiveDatePresence(charId);
    if (encounterId && current && current.encounterId !== encounterId) return;
    memory.delete(charId);
    if (!canUseStorage()) return;
    try {
        window.localStorage.removeItem(storageKey(charId));
    } catch {
        // Best effort only.
    }
};
