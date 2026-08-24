import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_UPDATE_ANNOUNCEMENT_KEY,
  DEFAULT_CALL_PREFERENCES,
  markCallUpdateAnnouncementSeen,
  parseCallPreferences,
  shouldShowCallUpdateAnnouncement,
} from './callPreferences';

afterEach(() => vi.unstubAllGlobals());

describe('call preferences', () => {
  it('keeps voice/opening defaults on but makes idle follow-ups opt-in', () => {
    expect(parseCallPreferences(null)).toEqual(DEFAULT_CALL_PREFERENCES);
    expect(parseCallPreferences('{broken')).toEqual(DEFAULT_CALL_PREFERENCES);
  });

  it('persists all four preferences independently and migrates old storage safely', () => {
    expect(parseCallPreferences(JSON.stringify({ characterInitiative: false }))).toEqual({
      characterInitiative: false,
      voiceAutoPlay: true,
      idleNudgeEnabled: false,
      sleepDreamEnabled: true,
    });
    expect(parseCallPreferences(JSON.stringify({ voiceAutoPlay: false }))).toEqual({
      characterInitiative: true,
      voiceAutoPlay: false,
      idleNudgeEnabled: false,
      sleepDreamEnabled: true,
    });
    expect(parseCallPreferences(JSON.stringify({ idleNudgeEnabled: true }))).toEqual({
      characterInitiative: true,
      voiceAutoPlay: true,
      idleNudgeEnabled: true,
      sleepDreamEnabled: true,
    });
    // sleepDreamEnabled 是唯一默认开、显式关闭才生效的旧字段——其余全是「默认开、显式 false 才关」，
    // 这里单独测 false 值能被存住，别被 !== false 的判定方式反着挡回 true。
    expect(parseCallPreferences(JSON.stringify({ sleepDreamEnabled: false }))).toEqual({
      characterInitiative: true,
      voiceAutoPlay: true,
      idleNudgeEnabled: false,
      sleepDreamEnabled: false,
    });
  });

  it('shows the call update once and remembers acknowledgement', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    expect(shouldShowCallUpdateAnnouncement()).toBe(true);
    markCallUpdateAnnouncementSeen();
    expect(values.get(CALL_UPDATE_ANNOUNCEMENT_KEY)).toBe('seen');
    expect(shouldShowCallUpdateAnnouncement()).toBe(false);
  });
});
