import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatInputArea from '../../components/chat/ChatInputArea';

// 预览页：只为看加号菜单的动作页怎么分。真聊天要先过三个开屏弹窗才进得去。
// ⚠️ showPanel / setShowPanel 必须接成真 state —— 写成空实现的话面板根本打不开
// （之前两个预览页都栽在「回调写空壳」上）。
const noop: any = () => {};
function Demo() {
  const [panel, setPanel] = useState<'none' | 'actions' | 'emojis' | 'chars'>('actions');
  const [input, setInput] = useState('');
  return <div style={{height:'100vh',display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
    <ChatInputArea
      input={input} setInput={setInput}
      isTyping={false} selectionMode={false}
      showPanel={panel} setShowPanel={setPanel}
      onSend={noop} onPanelAction={noop} onOpenVoiceInput={noop} showVoiceButton={false}
      emojis={[]} onImageSelect={noop}
      isSummarizing={false} canReroll
      {...({} as any)}
    />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
