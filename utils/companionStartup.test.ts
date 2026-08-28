import { describe, expect, it } from 'vitest';
import {
  buildCompanionStartupPrompt,
  companionStartupPeriodForHour,
  parseCompanionStartupResponse,
  resolveCompanionStartupForTime,
} from './companionStartup';
import type { CharacterProfile } from '../types';

describe('companion startup performance', () => {
  it('repairs fenced JSON and keeps an authored focus pose', () => {
    const result = parseCompanionStartupResponse({
      choices: [{
        message: {
          content: `\`\`\`json
{
  "line": "……你总算回来了。",
  "performance": {
    "emotion": "calm",
    "gesture": "tilt",
    "gaze": "left",
    "intensity": 0.72,
    "faces": ["brow-up"],
    "modelAction": "look-close",
    "precision": { "headX": 0.18, "headZ": -0.12, "eyeX": 0, "overshoot": 0.11, "settleMs": 1080, }
  },
}
\`\`\``,
        },
      }],
    }, [{ id: 'look-close', name: '靠近镜头' }]);

    expect(result?.line).toBe('……你总算回来了。');
    expect(result?.performance.gaze).toBe('viewer');
    expect(result?.performance.modelAction).toBe('look-close');
    expect(result?.performance.precision).toMatchObject({
      lockAutonomy: true,
      lockHead: true,
      headX: 0,
      headY: 0,
      headZ: 0,
      eyeX: 0,
      overshoot: 0.11,
      settleMs: 1080,
    });
  });

  it('accepts a plain character reply but never invents a local fallback', () => {
    const plain = parseCompanionStartupResponse('别盯着我看。 [[AVATAR: emotion=calm; gesture=tilt; gaze=viewer]]');

    expect(plain?.line).toBe('别盯着我看。');
    expect(plain?.performance.precision?.lockAutonomy).toBe(true);
    expect(plain?.performance.precision?.lockHead).toBe(true);
    expect(parseCompanionStartupResponse('')).toBeNull();
  });

  it('tells the model that themes cannot author dialogue', () => {
    const prompt = buildCompanionStartupPrompt('角色完整上下文', 'Sully', '条条');

    expect(prompt).toContain('不要替桌面主题说话');
    expect(prompt).toContain('不要套用通用欢迎');
    expect(prompt).toContain('眼睛默认看镜头');
    expect(prompt).toContain('身体 X/Y/Z');
  });

  it('maps all six character-local startup periods at their boundaries', () => {
    expect([0, 4, 5, 10, 11, 12, 13, 16, 17, 18, 19, 23].map(companionStartupPeriodForHour)).toEqual([
      'late-night', 'late-night', 'morning', 'morning', 'noon', 'noon',
      'afternoon', 'afternoon', 'dusk', 'dusk', 'evening', 'evening',
    ]);
  });

  it('selects a saved line for the current character-local period', () => {
    const character = {
      id: 'char-1',
      name: 'Sully',
      companionTouchSettings: {
        enabledZones: [],
        reactions: {},
        startup: { enabled: true, line: 'fallback', performance: { emotion: 'calm', gesture: 'idle', camera: 'medium', gaze: 'viewer', intensity: 0.5 } },
        startupPresets: [{
          id: 'morning', name: '早上', createdAt: 1, updatedAt: 1,
          startup: { enabled: true, line: '早上好。', timePeriod: 'morning', performance: { emotion: 'calm', gesture: 'idle', camera: 'medium', gaze: 'viewer', intensity: 0.5 } },
        }],
      },
    } as unknown as CharacterProfile;
    const localMorning = new Date(2026, 7, 28, 8, 0, 0);
    expect(resolveCompanionStartupForTime(character, localMorning)?.line).toBe('早上好。');
  });
});
