import { describe, expect, it } from 'vitest';
import { callLaunch } from './callLaunch';

describe('callLaunch', () => {
  it('意图只消费一次', () => {
    callLaunch.request({ charId: 'char-1', sessionId: 'call-1' });
    expect(callLaunch.peek()).toEqual({ charId: 'char-1', sessionId: 'call-1' });
    expect(callLaunch.consume()).toEqual({ charId: 'char-1', sessionId: 'call-1' });
    expect(callLaunch.consume()).toBeNull();
  });

  it('保留从聊天深链进入后的返回目标', () => {
    callLaunch.request({ charId: 'char-1', sessionId: 'call-1', returnTo: 'chat' });
    expect(callLaunch.consume()).toEqual({ charId: 'char-1', sessionId: 'call-1', returnTo: 'chat' });
    expect(callLaunch.consume()).toBeNull();
  });
});
