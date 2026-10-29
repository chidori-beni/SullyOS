// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { LocalizedCharacterText } from '../components/LocalizedCharacterText';
import { ReviewsCard } from '../apps/bookroom/BookParts';
import { translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import { characterDisplayKey, type CharacterDisplayRecord } from './characterContentLocale';
const mock = vi.hoisted(()=>({locale:'ja-JP' as UiLocale,read:vi.fn(),subscribe:vi.fn()}));
vi.mock('../context/UiLocaleContext',()=>({useUiLocale:()=>({locale:mock.locale,t:(key:UiMessageKey,params?:UiMessageParams)=>translateUi(mock.locale,key,params)})}));
vi.mock('../context/OSContext',()=>({useOS:()=>({apiConfig:{baseUrl:'https://example.invalid',apiKey:'fake',model:'test'}})}));
vi.mock('./safeApi',()=>({safeFetchJson:vi.fn()}));
vi.mock('./characterContentLocale',async original=>({...await original<typeof import('./characterContentLocale')>(),contentTranslator:{read:mock.read},subscribeCharacterText:mock.subscribe}));
let observe!:(entries:Array<{isIntersecting:boolean}>)=>void;
const element=document.createElement('div');let root=createRoot(element);
beforeAll(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('IntersectionObserver',class{constructor(callback:typeof observe){observe=callback;}observe(){}disconnect(){}});});
afterAll(()=>vi.unstubAllGlobals());
afterEach(async()=>{await act(async()=>root.unmount());root=createRoot(element);vi.resetAllMocks();mock.locale='ja-JP';});
it('translates only a visible character review, leaves the user review and source record unchanged',async()=>{
  const book={novelId:'book',title:'原书名',record:{reviews:{user:{text:'用户自己的原文',at:1},chars:[{charId:'char',charName:'原角色',text:'角色旧书评',at:2,rating:4}]}}} as unknown as React.ComponentProps<typeof ReviewsCard>['book'];
  const before=JSON.stringify(book),action=vi.fn();let done!:(text:string)=>void;
  mock.subscribe.mockImplementation((_record,_api,callback)=>{done=callback;return vi.fn();});
  await act(async()=>root.render(React.createElement(ReviewsCard,{book,onReview:action,onSave:action})));
  expect(mock.subscribe).not.toHaveBeenCalled();
  await act(async()=>observe([{isIntersecting:true}]));
  expect(mock.subscribe).toHaveBeenCalledTimes(1);expect(mock.subscribe.mock.calls[0][0].scope).toBe('review');
  await act(async()=>done('日本語のレビュー'));
  expect(element.textContent).toContain('日本語のレビュー');expect(element.textContent).toContain('用户自己的原文');
  mock.locale='zh-CN';await act(async()=>root.render(React.createElement(ReviewsCard,{book,onReview:action,onSave:action})));
  expect(element.textContent).toContain('角色旧书评');expect(JSON.stringify(book)).toBe(before);expect(action).not.toHaveBeenCalled();
});
it('ignores late cinema translations when the source changes and does not retranslate requested Japanese',async()=>{
  let done!:(text:string)=>void;mock.subscribe.mockImplementation((_r,_api,callback)=>{done=callback;return vi.fn();});
  const record:CharacterDisplayRecord={id:'s:char:1',scope:'cinema',text:'旧发言'};
  await act(async()=>root.render(React.createElement(LocalizedCharacterText,{record})));
  await act(async()=>observe([{isIntersecting:true}]));
  await act(async()=>root.render(React.createElement(LocalizedCharacterText,{record:{...record,text:'新发言',locale:'ja-JP'}})));
  await act(async()=>done('古い訳文'));
  expect(element.textContent).not.toContain('古い訳文');expect(element.textContent).toContain('新发言');
  expect(mock.subscribe).toHaveBeenCalledTimes(1);
  expect(characterDisplayKey(record)).not.toBe(characterDisplayKey({...record,text:'新发言'}));
});
it('translation controls never bubble into cinema playback actions',async()=>{
  const play=vi.fn();mock.subscribe.mockReturnValue(vi.fn());
  await act(async()=>root.render(React.createElement('div',{onClick:play},React.createElement(LocalizedCharacterText,{record:{id:'a',scope:'cinema',text:'原文'}}))));
  await act(async()=>element.querySelector('button')!.click());expect(play).not.toHaveBeenCalled();
});
