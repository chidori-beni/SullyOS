import React, { useState } from 'react';
import { Question } from '@phosphor-icons/react';
import type { ChatInputPreferences } from '../../utils/chatInputPreferences';

interface ChatInputSettingsProps {
    value: ChatInputPreferences;
    onChange: (value: ChatInputPreferences) => void;
}

const ChatInputSettings: React.FC<ChatInputSettingsProps> = ({ value, onChange }) => {
    const [openHelp, setOpenHelp] = useState<keyof ChatInputPreferences | null>(null);
    return (
        <div className="space-y-1">
            <p className="mb-2 text-[10px] text-slate-400">以下输入习惯对所有私聊生效</p>
            {([
                {
                    key: 'sendButtonGenerates',
                    label: '发送按钮代替生成按钮',
                    help: '开启后，不用够右上角的闪电了。输入框里有光标时，右下角发文字；点一下聊天空白处，右下角就变成闪电，让对方回复已发送的消息。只收起键盘可能还留着光标，点一下空白处就好。没发出的草稿会保留。',
                },
                {
                    key: 'enterToSend',
                    label: '回车发送文字',
                    help: '勾选时，按回车发送文字，Shift + 回车换行；不勾选时，回车只换行，点发送按钮发出文字。输入法选字时按回车不会误发。',
                },
                {
                    key: 'autoReply',
                    label: '发完后自动生成回复',
                    help: '发过文字、图片或表情后，等输入框没有草稿和光标、加号等底部面板全部收起，再等 2 秒让对方回复。继续输入、打开面板或发送新消息，就重新等待。倒计时可以取消。这项开启时，Instant Push 的发送即回复也会按这里等。',
                },
                {
                    key: 'emojiSuggestions',
                    label: '表情包智能匹配',
                    help: '输入“抱”就会联想名称里有“抱”的表情包，点击候选即可发送。匹配当前角色可见的所有分类，文字草稿会保留。默认关闭。',
                },
            ] as const).map(({ key, label, help }) => (
                <div key={key}>
                    <div className="flex items-center gap-1">
                        <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-3 text-xs font-bold text-slate-600">
                            <span>{label}</span>
                            <input
                                type="checkbox"
                                checked={value[key]}
                                onChange={event => onChange({ ...value, [key]: event.target.checked })}
                                className="h-5 w-5 shrink-0 cursor-pointer accent-primary"
                            />
                        </label>
                        <button
                            type="button"
                            aria-label={`${label}说明`}
                            aria-expanded={openHelp === key}
                            aria-controls={`chat-input-help-${key}`}
                            onClick={() => setOpenHelp(openHelp === key ? null : key)}
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-slate-100 ${openHelp === key ? 'text-primary' : 'text-slate-400'}`}
                        >
                            <Question size={18} weight="bold" />
                        </button>
                    </div>
                    <p id={`chat-input-help-${key}`} hidden={openHelp !== key} className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-relaxed text-slate-500">{help}</p>
                </div>
            ))}
        </div>
    );
};

export default ChatInputSettings;
