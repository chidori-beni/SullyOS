import React from 'react';
import {
    CHAT_ACTION_DEFINITIONS,
    DEFAULT_CHAT_ACTION_ORDER,
    moveChatAction,
    normalizeChatActionOrder,
    type ChatActionOrder,
} from '../../utils/chatActionOrder';

interface ChatActionOrderSettingsProps {
    value: ChatActionOrder;
    onChange: (value: ChatActionOrder) => void;
}

const ChatActionOrderSettings: React.FC<ChatActionOrderSettingsProps> = ({ value, onChange }) => {
    const order = normalizeChatActionOrder(value);

    return (
        <div className="space-y-3">
            <p className="text-[10px] leading-relaxed text-slate-400">
                按上、下箭头调整“＋”菜单顺序，每页仍自动放 8 项。调整后请点击下面的“保存设置”才会生效。
            </p>
            <div className="space-y-2">
                {order.map((id, index) => {
                    const definition = CHAT_ACTION_DEFINITIONS.find(item => item.id === id);
                    if (!definition) return null;
                    return (
                        <div key={id} className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-1.5">
                            <span className="w-5 shrink-0 text-center text-xs font-mono text-slate-400">{index + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-600">{definition.label}</span>
                            <button
                                type="button"
                                onClick={() => onChange(moveChatAction(order, id, -1))}
                                disabled={index === 0}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-white disabled:opacity-20"
                                aria-label={`将${definition.label}上移`}
                            >
                                <span aria-hidden="true">↑</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange(moveChatAction(order, id, 1))}
                                disabled={index === order.length - 1}
                                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-white disabled:opacity-20"
                                aria-label={`将${definition.label}下移`}
                            >
                                <span aria-hidden="true">↓</span>
                            </button>
                        </div>
                    );
                })}
            </div>
            <button
                type="button"
                onClick={() => onChange([...DEFAULT_CHAT_ACTION_ORDER])}
                className="w-full rounded-2xl border border-slate-200 py-2.5 text-xs font-bold text-slate-500 hover:bg-slate-50"
            >
                恢复默认顺序
            </button>
            <p className="text-center text-[10px] leading-relaxed text-slate-400">
                “语音”在消息栏已经显示时，会自动从加号菜单里隐藏，但它的位置会保留。
            </p>
        </div>
    );
};

export default ChatActionOrderSettings;
