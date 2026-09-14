import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SARUpdateDialogue} from '../../apps/vrWorld/SARUpdateDialogue';
import {SAR_UPDATE_NOTICES, sarUpdateNoticeKey, acknowledgeSARUpdateNotice, type SARUpdateNotice} from '../../utils/vrWorld/sarUpdateNotices';

// 预览页：真 SAR 要先进彼方、开 NPC、点设施才看得到，改这块时直接开这页。
function Demo(){
  const [notice,setNotice]=useState<SARUpdateNotice|null>(null);
  return <div style={{padding:20,color:'#ddd',fontFamily:'system-ui'}}>
    {(['cabinet','board'] as const).map(id=>
      <button key={id} onClick={()=>{localStorage.removeItem(sarUpdateNoticeKey(id));setNotice(id);}}
        style={{marginRight:10,padding:'8px 14px',borderRadius:10,border:0,cursor:'pointer'}}>
        播放「{id}」公告（{SAR_UPDATE_NOTICES[id].length} 句）
      </button>)}
    <p style={{fontSize:12,opacity:.6}}>读完会写 localStorage，点按钮会先清掉重播。</p>
    {notice&&<SARUpdateDialogue key={notice} notice={notice}
      onComplete={()=>{acknowledgeSARUpdateNotice(notice);setNotice(null);}}/>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Demo/>);
