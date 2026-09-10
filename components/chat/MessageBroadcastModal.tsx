import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../os/Modal';
import type { CharacterGroup, CharacterProfile } from '../../types';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../character/CharacterGroupFilter';

export interface BroadcastSendFailure {
    characterId: string;
    reason?: string;
}

export interface BroadcastSendReport {
    savedIds: string[];
    failures: BroadcastSendFailure[];
}

interface MessageBroadcastModalProps {
    isOpen: boolean;
    sourceText: string;
    sourceCharId: string;
    characters: CharacterProfile[];
    groups: CharacterGroup[];
    onClose: () => void;
    onSend: (characterIds: string[]) => Promise<BroadcastSendReport>;
}

const MessageBroadcastModal: React.FC<MessageBroadcastModalProps> = ({
    isOpen,
    sourceText,
    sourceCharId,
    characters,
    groups,
    onClose,
    onSend,
}) => {
    const [groupId, setGroupId] = useState(GROUP_FILTER_ALL);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [sending, setSending] = useState(false);
    const [errorText, setErrorText] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setGroupId(GROUP_FILTER_ALL);
        setSelectedIds(new Set());
        setSending(false);
        setErrorText('');
    }, [isOpen]);

    const candidates = useMemo(
        () => characters.filter(character => character.id !== sourceCharId),
        [characters, sourceCharId],
    );
    const visibleCharacters = useMemo(
        () => filterCharactersByGroup(candidates, groups, groupId),
        [candidates, groups, groupId],
    );

    const toggleCharacter = (id: string) => {
        if (sending) return;
        setErrorText('');
        setSelectedIds(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleSend = async () => {
        if (sending || selectedIds.size === 0) return;
        setSending(true);
        setErrorText('');
        try {
            const report = await onSend(Array.from(selectedIds));
            if (report.failures.length === 0) {
                onClose();
                return;
            }

            // 成功项已经写入，不能再次发送；失败项保留，方便用户只重试失败目标。
            setSelectedIds(new Set(report.failures.map(failure => failure.characterId)));
            setErrorText(`已发送 ${report.savedIds.length} 位，${report.failures.length} 位失败。可只重试失败的好友。`);
        } catch (error) {
            console.error('[MessageBroadcastModal] 群发失败:', error);
            setErrorText('群发没有完成，请重试。');
        } finally {
            setSending(false);
        }
    };

    const close = () => {
        if (!sending) onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            title="群发消息"
            onClose={close}
            footer={(
                <>
                    <button
                        type="button"
                        onClick={close}
                        disabled={sending}
                        className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl active:scale-95 transition-transform disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={sending || selectedIds.size === 0}
                        className="flex-1 py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg shadow-indigo-200 active:scale-95 transition-transform disabled:opacity-40 disabled:active:scale-100"
                    >
                        {sending ? '发送中…' : `发送给 ${selectedIds.size} 位好友`}
                    </button>
                </>
            )}
        >
            <div className="space-y-3">
                <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-3.5 py-3">
                    <div className="text-[10px] font-bold tracking-wide text-indigo-400 mb-1.5">将发送的普通消息</div>
                    <div className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap break-words max-h-24 overflow-y-auto">“{sourceText}”</div>
                    <div className="text-[10px] text-indigo-400/70 mt-1.5">不会显示为“聊天记录”，每位好友都会收到一条普通文字消息。</div>
                </div>

                <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-600">选择好友</div>
                    <div className="text-[10px] text-slate-400">已选 {selectedIds.size} 位</div>
                </div>

                <CharacterGroupFilterBar
                    characters={candidates}
                    groups={groups}
                    value={groupId}
                    onChange={setGroupId}
                    className="-mx-1 px-1"
                />

                <div className="max-h-[30vh] overflow-y-auto space-y-1.5 pr-0.5">
                    {visibleCharacters.map(character => {
                        const selected = selectedIds.has(character.id);
                        return (
                            <button
                                type="button"
                                key={character.id}
                                onClick={() => toggleCharacter(character.id)}
                                disabled={sending}
                                aria-pressed={selected}
                                className={`w-full min-h-12 flex items-center gap-3 px-3 py-2 rounded-2xl border text-left transition-colors active:scale-[0.98] disabled:opacity-60 ${selected ? 'bg-indigo-50 border-indigo-300' : 'bg-slate-50 border-slate-100 hover:bg-slate-100'}`}
                            >
                                <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-slate-300'}`}>
                                    {selected && <span className="text-white text-xs font-bold leading-none">✓</span>}
                                </span>
                                <img src={character.avatar} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-bold text-slate-700 truncate">{character.name}</span>
                                    <span className="block text-[10px] text-slate-400 truncate">{character.description || '角色'}</span>
                                </span>
                            </button>
                        );
                    })}
                    {visibleCharacters.length === 0 && (
                        <div className="text-center text-xs text-slate-400 py-6">
                            {candidates.length === 0 ? '没有其他角色可以群发' : '该分组下没有其他角色'}
                        </div>
                    )}
                </div>

                {errorText && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] leading-relaxed text-amber-700" role="status">
                        {errorText}
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default MessageBroadcastModal;
