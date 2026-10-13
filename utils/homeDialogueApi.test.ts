import {afterEach,expect,it,vi} from 'vitest';
import {generateHomeReply} from './homeConversation';
import {evaluateHomeReplyEmotion} from './homeReplyEmotion';
// fork：聊天请求组装比上游多几步（日程/节假日/通话边界等），测试环境里要等各自的超时，放宽时限。
vi.setConfig({ testTimeout: 30_000 });
vi.mock('./chatRequestPayload',()=>({buildChatRequestPayload:vi.fn(async()=>({flags:{promptBuildSkipped:false},fullMessages:[{role:'user',content:'你好'}]}))}));
vi.mock('./chatContextRange',async importOriginal=>({...await importOriginal<typeof import('./chatContextRange')>(),loadCharacterContextRange:vi.fn(async()=>({messages:[],hwm:0}))}));
vi.mock('./homeReplyEmotion',()=>({evaluateHomeReplyEmotion:vi.fn(async()=>{})}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('home uses the character dialogue credentials and preserves the global specialty configuration',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:'{"text":"你好","actionIds":[]}'}}]}),{status:200}));vi.stubGlobal('fetch',fetcher);
 const api:any={baseUrl:'https://global.example/v1',model:'global',apiKey:'global-key',visionApi:{model:'vision'}};
 const args:any={api,char:{id:'c',name:'C',dialogueApi:{baseUrl:'https://character.example/v1',model:'character',apiKey:'',temperature:.35}},user:{name:'U'},
  scene:{roomName:'客厅',present:true,actions:[]},signal:new AbortController().signal,
  context:{groups:[],emojis:[],categories:[]},records:[{id:'r',turnId:'t',actor:'user',kind:'message',source:'user',text:'你好',at:1}]};
 expect((await generateHomeReply(args)).text).toBe('你好');
 const [url,request]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
 expect(url).toBe('https://character.example/v1/chat/completions');
 expect(request.headers).toMatchObject({Authorization:'Bearer sk-none'});
 expect(JSON.parse(request.body as string)).toMatchObject({model:'character',temperature:.35,stream:false});
 expect(vi.mocked(evaluateHomeReplyEmotion).mock.calls[0][0].api).toBe(api);
});
