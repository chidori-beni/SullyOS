// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ReviewSheet, type BookReviewExchangeResult } from '../apps/bookroom/sheets';
import { translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import { formatBookCinemaText } from './bookCinemaLocale';
import { readFileSync } from 'node:fs';
const state=vi.hoisted(()=>({locale:'ja-JP' as UiLocale,read:vi.fn(),subscribe:vi.fn()}));
vi.mock('../context/UiLocaleContext',()=>({useUiLocale:()=>({locale:state.locale,t:(key:UiMessageKey,params?:UiMessageParams)=>translateUi(state.locale,key,params)})}));
vi.mock('../context/OSContext',()=>({useOS:()=>({apiConfig:{baseUrl:'https://example.invalid',apiKey:'fake',model:'test'}})}));
vi.mock('./safeApi',()=>({safeFetchJson:vi.fn()}));
vi.mock('./characterContentLocale',async original=>({...await original<typeof import('./characterContentLocale')>(),contentTranslator:{read:state.read},subscribeCharacterText:state.subscribe}));
const element=document.createElement('div');let root=createRoot(element);
let observe!:(entries:Array<{isIntersecting:boolean}>)=>void;
beforeAll(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('IntersectionObserver',class{constructor(callback:typeof observe){observe=callback;}observe(){}disconnect(){}});});
afterAll(()=>vi.unstubAllGlobals());
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(element);vi.resetAllMocks();state.locale='ja-JP';});
const book={novelId:'book',title:'銀河鉄道の夜',record:{companionIds:['char'],reviews:{user:{text:'用户原书评',rating:5,at:1}}}} as unknown as React.ComponentProps<typeof ReviewSheet>['book'];
const characters=[{id:'char',name:'三浦 紗季'}] as React.ComponentProps<typeof ReviewSheet>['characters'];
const mountResult=async(result:BookReviewExchangeResult)=>{
  const save=vi.fn().mockResolvedValue(book.record.reviews),exchange=vi.fn().mockResolvedValue(result),close=vi.fn();
  const props={book,characters,onClose:close,onSaveMine:save,onExchange:exchange};
  await act(async()=>root.render(React.createElement(ReviewSheet,props)));
  const button=[...element.querySelectorAll('button')].find(b=>b.textContent===formatBookCinemaText(state.locale,'存下并交换'))!;
  expect(button).toBeTruthy();await act(async()=>button.click());
  return {save,exchange,close,props};
};
it('translates the actual exchange-result popup even if the model returned Chinese after a Japanese request',async()=>{
  const result:BookReviewExchangeResult={charId:'char',charName:'三浦 紗季',text:'这书读得我一口气闷在胸口。',rating:3,at:123,contentLocale:'ja-JP'};
  const before=JSON.stringify(result);let done!:(text:string)=>void;
  state.subscribe.mockImplementation((_record,_api,callback)=>{done=callback;return vi.fn();});
  const {save,exchange,props}=await mountResult(result);
  expect(state.subscribe).not.toHaveBeenCalled();
  await act(async()=>observe([{isIntersecting:true}]));
  expect(state.subscribe).toHaveBeenCalledTimes(1);
  expect(state.subscribe.mock.calls[0][0]).toEqual({id:JSON.stringify(['book','char',123]),scope:'review',text:result.text});
  await act(async()=>done('この本を読んで、胸が詰まる思いだった。'));
  expect(element.textContent).toContain('この本を読んで、胸が詰まる思いだった。');
  expect(element.textContent).toContain('三浦 紗季');
  expect(JSON.stringify(result)).toBe(before);expect(save).toHaveBeenCalledTimes(1);expect(exchange).toHaveBeenCalledTimes(1);
  state.locale='zh-CN';await act(async()=>root.render(React.createElement(ReviewSheet,props)));
  expect(element.textContent).toContain(result.text);expect(save).toHaveBeenCalledTimes(1);
});
it('reuses the same review cache identity and keeps failed translations visible without altering source',async()=>{
  const result={charId:'char',charName:'三浦 紗季',text:'原始中文',at:456};
  state.read.mockReturnValue({summary:'保存済みの日本語レビュー'});
  await mountResult(result);
  expect(element.textContent).toContain('保存済みの日本語レビュー');
  expect(state.read).toHaveBeenCalledWith(JSON.stringify(['v1','ja-JP',JSON.stringify(['annotation','review',JSON.stringify(['book','char',456])]),'読書メモ',result.text]));
  expect(state.subscribe).not.toHaveBeenCalled();
});
it('shows a translation error and the original result without pretending it is Japanese',async()=>{
  let fail!:(error:string)=>void;state.subscribe.mockImplementation((_record,_api,_done,reject)=>{fail=reject;return vi.fn();});
  const result={charName:'三浦 紗季',text:'模型原话'};await mountResult(result);
  await act(async()=>observe([{isIntersecting:true}]));
  await act(async()=>fail('MODEL_TEXT: incomplete'));
  expect(element.textContent).toContain('模型原话');expect(element.textContent).toContain('MODEL_TEXT: incomplete');
  expect(element.textContent).toContain('翻訳を再試行');expect(state.subscribe).toHaveBeenCalledTimes(1);
});

it('all three review views use the shared source identity without trusting the requested generation locale',()=>{
  for(const file of ['apps/bookroom/sheets.tsx','apps/bookroom/BookParts.tsx','apps/bookroom/CharacterShelf.tsx']){
    const source=readFileSync(file,'utf8');
    const reviewDisplay=source.split('<LocalizedCharacterText').slice(1).map(x=>x.slice(0,x.indexOf('/>'))).filter(x=>x.includes("scope: 'review'"));
    expect(reviewDisplay.length,file).toBeGreaterThan(0);
    for(const display of reviewDisplay)expect(display,file).not.toMatch(/locale\s*:/);
  }
});
