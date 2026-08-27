import { afterEach, describe, expect, it } from 'vitest';

import {
  endCallSession,
  didCallEndAbruptly,
  getActiveCallSessionId,
  getCallLifecycleGeneration,
  getCallSessionWindowForChar,
  isCallActiveForChar,
  isCallSessionEnded,
  resetCallLifecycleForTests,
  startCallSession,
} from './callSessionLifecycle';

afterEach(() => resetCallLifecycleForTests());

describe('call session lifecycle sentinel', () => {
  it('把没有最后一句告别的挂断标记为突然结束', () => {
    expect(didCallEndAbruptly([])).toBe(true);
    expect(didCallEndAbruptly([{ role: 'user', content: '好' }])).toBe(true);
    expect(didCallEndAbruptly([{ role: 'user', content: '那明天聊' }])).toBe(false);
  });

  it('starts an active session and advances its generation', () => {
    expect(isCallActiveForChar('char-1')).toBe(false);
    startCallSession('char-1', 'call-1', 100);
    expect(isCallActiveForChar('char-1')).toBe(true);
    expect(getActiveCallSessionId('char-1')).toBe('call-1');
    expect(getCallLifecycleGeneration('char-1')).toBe(1);
  });

  it('marks the session ended synchronously so late requests can be dropped', () => {
    const startedAt = Date.now();
    startCallSession('char-1', 'call-1', startedAt);
    const beforeEnd = getCallLifecycleGeneration('char-1');
    endCallSession('char-1', 'call-1', startedAt + 100);
    expect(isCallActiveForChar('char-1')).toBe(false);
    expect(getActiveCallSessionId('char-1')).toBeNull();
    expect(isCallSessionEnded('call-1')).toBe(true);
    expect(getCallLifecycleGeneration('char-1')).toBe(beforeEnd + 1);
    expect(getCallSessionWindowForChar('char-1')).toEqual({
      sessionId: 'call-1', startedAt, endedAt: startedAt + 100,
    });
  });

  it('detects a call that starts and ends while a proactive request is in flight', () => {
    const generationAtRequestStart = getCallLifecycleGeneration('char-1');
    startCallSession('char-1', 'call-1');
    endCallSession('char-1', 'call-1');
    expect(getCallLifecycleGeneration('char-1')).not.toBe(generationAtRequestStart);
    expect(isCallSessionEnded('call-1')).toBe(true);
  });

});
