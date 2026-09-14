import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatDecorSheet, {ChatDecorTab} from '../../components/chat/ChatDecorSheet';
import {AppID, OSTheme} from '../../types';

const theme = {chatBubbleFontSize:0,chatBubbleLineHeight:0,chatBubbleIndent:0,chatAvatarVisibility:'both',chatAvatarPlacement:'beside',chatAvatarAlign:'bottom',chatAvatarOffsetY:0,chatSnapToEdge:false,chatModuleAlign:'center'} as unknown as OSTheme;

function Demo(){
  const [tab,setTab]=useState<ChatDecorTab>('style');
  const [custom,setCustom]=useState(true);
  return <div style={{height:'100vh',padding:20,fontSize:13,color:'#475569'}}>
    <p>（这里假装是真聊天，抽屉浮在上面）</p>
    <ChatDecorSheet
      charName="小夜" tab={tab} onChangeTab={setTab} onClose={()=>{}}
      fineTuneValue={theme as any} fineTuneCustomized={custom}
      onToggleFineTuneCustomized={setCustom} onChangeFineTune={()=>{}} onClearFineTune={()=>{}}
      onOpenFloatingFineTune={()=>{}}
      onUploadBackground={()=>{}} onRemoveBackground={()=>{}}
      onOpenBubblePicker={()=>{}} onOpenThemeMaker={()=>{}}
      chromeCss="" onChangeChromeCss={()=>{}} onResetChromeCss={()=>{}}
      sound={null} soundBound={false} onChangeSound={()=>{}} onChangeSoundBound={()=>{}}
      theme={theme} onUpdateTheme={()=>{}} onResetAllChrome={()=>{}} onOpenApp={()=>{}}
    />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
