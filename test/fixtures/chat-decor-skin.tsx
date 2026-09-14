import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ChatDecorSheet, {ChatDecorTab} from '../../components/chat/ChatDecorSheet';
import {OSTheme, CharacterProfile} from '../../types';
import {resolveChatAppearance, splitAppearancePatch, pickChatAppearance} from '../../utils/chatAppearanceOverride';

// 「装扮」抽屉的预览页。真聊天要先过三个开屏弹窗才进得去，改这个抽屉时开这页快得多。
// 这里连角色覆盖也接了：切到「小夜」改聊天壳，只会写进这个假角色，不动全局。
const BASE = {chatBubbleFontSize:0,chatBubbleLineHeight:0,chatBubbleIndent:0,chatAvatarVisibility:'both',
  chatAvatarPlacement:'beside',chatAvatarAlign:'bottom',chatAvatarOffsetY:0,chatSnapToEdge:false,
  chatModuleAlign:'center'} as unknown as OSTheme;

function Demo(){
  const [tab,setTab]=useState<ChatDecorTab>('style');
  const [custom,setCustom]=useState(true);
  const [theme,setTheme]=useState<OSTheme>(BASE);
  const [char,setChar]=useState<CharacterProfile>({id:'demo',name:'小夜',chatFineTune:{enabled:true}} as CharacterProfile);
  const charTheme=resolveChatAppearance(theme,char);
  return <div style={{height:'100vh',padding:20,fontSize:13,color:'#475569'}}>
    <p>（这里假装是真聊天，抽屉浮在上面）</p>
    <p style={{fontSize:11,color:'#94a3b8'}}>角色聊天壳：{String(charTheme.chatChromeStyle||'soft')} ／ 全局：{String(theme.chatChromeStyle||'soft')}</p>
    <ChatDecorSheet
      charName={char.name} tab={tab} onChangeTab={setTab} onClose={()=>{}}
      fineTuneValue={charTheme as any} fineTuneCustomized={custom}
      onToggleFineTuneCustomized={next=>{setCustom(next);setChar(c=>({...c,chatFineTune:{...c.chatFineTune,enabled:next}}));}}
      onChangeFineTune={()=>{}} onClearFineTune={()=>setChar(c=>({...c,chatAppearance:undefined,chatFineTune:undefined}))}
      onOpenFloatingFineTune={()=>{}}
      onUploadBackground={()=>{}} onRemoveBackground={()=>{}}
      globalBackground={theme.chatBackground} onUploadGlobalBackground={()=>{}} onRemoveGlobalBackground={()=>{}}
      charCardCss="" onChangeCharCardCss={()=>{}} charDialogCss="" onChangeCharDialogCss={()=>{}}
      onOpenBubblePicker={()=>{}} onOpenThemeMaker={()=>{}}
      chromeCss="" onChangeChromeCss={()=>{}} onResetChromeCss={()=>{}}
      sound={null} soundBound={false} onChangeSound={()=>{}} onChangeSoundBound={()=>{}}
      theme={theme} onUpdateTheme={patch=>setTheme(t=>({...t,...patch}))}
      charAppearanceTheme={charTheme}
      onUpdateCharAppearance={patch=>{
        const {appearance,fineTune}=splitAppearancePatch(patch);
        setChar(c=>({...c,chatAppearance:{...pickChatAppearance(c.chatAppearance),...appearance},
          chatFineTune:{...c.chatFineTune,...fineTune,enabled:true}} as CharacterProfile));
      }}
      onResetAllChrome={()=>{}} onOpenApp={()=>{}}
    />
  </div>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
