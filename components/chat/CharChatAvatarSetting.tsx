import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { processImage } from '../../utils/file';
import type { CharacterProfile } from '../../types';

/**
 * 聊天设置「ta 的聊天头像」：角色在聊天软件里用的头像，和神经链接里的本人照片分开。
 * 存 character.chatAvatar，私聊 / 群聊 / 信息 App 会话列表 / 朋友圈都读它；
 * 不设置就沿用本人照片。点了立即生效，和「保存设置」无关。
 */

const isValidHttpImageUrl = (value: string) => {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
};

const CharChatAvatarSetting: React.FC<{ character: CharacterProfile }> = ({ character }) => {
    const { updateCharacter, addToast } = useOS();
    const current = character.chatAvatar;
    const [urlDraft, setUrlDraft] = useState(current && !current.startsWith('data:') ? current : '');
    const uploadRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setUrlDraft(current && !current.startsWith('data:') ? current : '');
    }, [character.id, current]);

    const apply = (value: string | undefined) => {
        updateCharacter(character.id, { chatAvatar: value });
    };

    const applyUrl = () => {
        const url = urlDraft.trim();
        if (!isValidHttpImageUrl(url)) {
            addToast('URL 无效，请填写 http(s) 图片直链', 'error');
            return;
        }
        apply(url);
        addToast('已更换 ta 的聊天头像', 'success');
    };

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const base64 = await processImage(file);
            apply(base64);
            setUrlDraft('');
            addToast('已更换 ta 的聊天头像', 'success');
        } catch (err: any) {
            addToast(err?.message || String(err), 'error');
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-center gap-5">
                <div className="flex flex-col items-center gap-1">
                    <img src={character.avatar} className="w-14 h-14 rounded-full object-cover bg-slate-100 ring-2 ring-slate-200" alt="" />
                    <span className="text-[10px] text-slate-400">本人照片</span>
                </div>
                <span className="text-slate-300">→</span>
                <div className="flex flex-col items-center gap-1">
                    <img src={current || character.avatar} className={`w-14 h-14 rounded-full object-cover bg-slate-100 ${current ? 'ring-2 ring-primary' : 'ring-2 ring-slate-200 opacity-60'}`} alt="" />
                    <span className="text-[10px] text-slate-400">{current ? '聊天头像' : '未设置（用照片）'}</span>
                </div>
            </div>

            <div className="rounded-2xl bg-slate-50 p-3">
                <div className="text-[11px] font-bold text-slate-600 mb-1.5">图床链接（推荐）</div>
                <div className="flex gap-2">
                    <input
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        placeholder="https://… 图片直链"
                        className="flex-1 min-w-0 bg-white border border-slate-200 focus:border-primary/40 rounded-xl px-3 py-2 text-xs text-slate-700 outline-none transition-all placeholder:text-slate-300"
                    />
                    <button type="button" onClick={applyUrl} className="shrink-0 rounded-xl bg-primary px-3 py-2 text-[11px] font-bold text-white active:scale-95 transition-transform">使用</button>
                </div>
            </div>

            <div className="flex gap-2">
                <button type="button" onClick={() => uploadRef.current?.click()}
                    className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-bold text-slate-600 active:scale-[0.98] transition-transform">
                    本地上传
                </button>
                {current && (
                    <button type="button"
                        onClick={() => { apply(undefined); setUrlDraft(''); addToast('已恢复为本人照片', 'success'); }}
                        className="flex-1 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[11px] font-bold text-rose-500 active:scale-[0.98] transition-transform">
                        恢复用照片
                    </button>
                )}
            </div>
            <input type="file" ref={uploadRef} className="hidden" accept="image/*" onChange={handleUpload} />

            <p className="text-[10px] leading-relaxed text-slate-400">
                私聊、群聊、信息 App 的会话列表和朋友圈都用这张；见面、登场动画、神经链接里仍是本人照片。点了立即生效，不用按「保存设置」。
            </p>
        </div>
    );
};

export default CharChatAvatarSetting;
