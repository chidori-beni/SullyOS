import { expect, it, vi } from 'vitest';
import { createLocalizedPlayback } from './localizedPlayback';
import type { APIConfig, CharacterProfile } from '../../types';
import type { CinemaSpeaker } from './cinemaVoice';
const char = { id:'char',voiceProfile:{id:'voice'} } as unknown as CharacterProfile;
const api = {} as APIConfig;
const make = () => {
  const speaker = { say:vi.fn().mockResolvedValue('blob:voice'), replay:vi.fn(), stop:vi.fn() } as unknown as CinemaSpeaker;
  const playback = createLocalizedPlayback(()=>speaker,()=>speaker.stop());
  const input = {identity:'session:line',locale:'zh-CN' as const,char,api,current:()=>true,resolve:()=>({promise:Promise.resolve('原话'),cancel:vi.fn()})};
  return {speaker,playback,input};
};
it('never reuses a Chinese audio cache entry for Japanese text and includes voice settings',async()=>{
  const {speaker,playback,input}=make();
  await playback.play(input);
  await playback.play({...input,locale:'ja-JP',resolve:()=>({promise:Promise.resolve('日本語'),cancel:vi.fn()})});
  expect(speaker.say).toHaveBeenCalledTimes(2);expect(speaker.replay).not.toHaveBeenCalled();
  await playback.play({...input,locale:'ja-JP',resolve:()=>({promise:Promise.resolve('日本語'),cancel:vi.fn()})});
  expect(speaker.replay).toHaveBeenCalledTimes(1);
  await playback.play({...input,api:{...api,ttsProvider:'different'} as unknown as APIConfig});
  expect(speaker.say).toHaveBeenCalledTimes(3);
});
it('cancels pending translation on language/session invalidation, including a round trip',async()=>{
  const {speaker,playback,input}=make();let finish!:(text:string)=>void;
  const cancel=vi.fn();
  const run=playback.play({...input,resolve:()=>({promise:new Promise<string>(r=>{finish=r;}),cancel})});
  playback.invalidate(true);playback.invalidate(true);
  finish('遅い訳文');await run;
  expect(cancel).toHaveBeenCalled();expect(speaker.say).not.toHaveBeenCalled();
});
it('does not play a fallback Chinese audio after Japanese translation fails',async()=>{
  const {speaker,playback,input}=make();await playback.play(input);
  await expect(playback.play({...input,locale:'ja-JP',resolve:()=>({promise:Promise.reject(new Error('MODEL_TEXT')),cancel:vi.fn()})})).rejects.toThrow('MODEL_TEXT');
  expect(speaker.say).toHaveBeenCalledTimes(1);expect(speaker.replay).not.toHaveBeenCalled();
});
it('discards late TTS URLs and does not add them to the replay cache',async()=>{
  const {speaker,playback,input}=make();let finish!:(url:string)=>void;
  const revoke=vi.fn();vi.stubGlobal('URL',{revokeObjectURL:revoke});
  vi.mocked(speaker.say).mockImplementationOnce(()=>new Promise<string>(r=>{finish=r;}));
  const run=playback.play(input);await Promise.resolve();playback.invalidate(true);finish('blob:late');await run;
  expect(revoke).toHaveBeenCalledWith('blob:late');
  await playback.play(input);expect(speaker.say).toHaveBeenCalledTimes(2);expect(speaker.replay).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
it('a stale auto reply cannot stop a newer active playback request',async()=>{
  const {speaker,playback,input}=make();await playback.play(input);const stops=vi.mocked(speaker.stop).mock.calls.length;
  await playback.play({...input,current:()=>false});expect(speaker.stop).toHaveBeenCalledTimes(stops);
});
