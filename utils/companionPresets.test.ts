import { describe, expect, it } from 'vitest';
import type { CompanionStartupSettings, CompanionTouchSettings } from '../types';
import {
  activateCompanionStartupPreset,
  activateCompanionTouchPreset,
  collectCompanionVoiceAssetIds,
  mergeCompanionTouchReactions,
  saveCompanionStartupPreset,
  saveCompanionTouchPreset,
  updateCompanionTouchReaction,
} from './companionPresets';

const emptySettings = (): CompanionTouchSettings => ({ enabledZones: ['head'], reactions: {} });

const performance = (emotion: 'happy' | 'neutral', gesture: 'wave' | 'idle') => ({
  emotion,
  gesture,
  camera: 'medium' as const,
  gaze: 'viewer' as const,
  intensity: 0.7,
});

const startup = (line: string, voiceAssetId: string): CompanionStartupSettings => ({
  enabled: true,
  line,
  performance: performance('happy', 'wave'),
  voiceAssetId,
});

describe('Live2D companion presets', () => {
  it('creates independent startup presets and restores the selected old preset', () => {
    const first = saveCompanionStartupPreset(emptySettings(), startup('早上好', 'companion-startup-voice:first'), '清晨', {
      now: 10,
      id: 'startup-a',
    });
    const second = saveCompanionStartupPreset(first.settings, startup('欢迎回来', 'companion-startup-voice:second'), '回家', {
      now: 20,
      id: 'startup-b',
    });

    expect(second.settings.startupPresets?.map(item => item.name)).toEqual(['清晨', '回家']);
    expect(second.settings.startupPresets?.[0].startup.voiceAssetId).toBe('companion-startup-voice:first');
    expect(second.settings.startup?.voiceAssetId).toBe('companion-startup-voice:second');

    const selected = activateCompanionStartupPreset(second.settings, 'startup-a');
    expect(selected.activeStartupPresetId).toBe('startup-a');
    expect(selected.startup?.line).toBe('早上好');
    expect(selected.startup?.voiceAssetId).toBe('companion-startup-voice:first');
  });

  it('creates independent touch packs and keeps every referenced Blob id discoverable for backup', () => {
    const first = saveCompanionTouchPreset(emptySettings(), {
      enabledZones: ['head'],
      reactions: { head: [{ id: 'a', text: '嗯？', performance: performance('neutral', 'idle'), voiceAssetId: 'companion-touch-voice:first' }] },
      voiceEnabled: true,
    }, '摸头', { now: 10, id: 'touch-a' });
    const second = saveCompanionTouchPreset(first.settings, {
      enabledZones: ['hand'],
      reactions: { hand: [{ id: 'b', text: '牵住了', performance: performance('happy', 'wave'), voiceAssetId: 'companion-touch-voice:second' }] },
      voiceEnabled: true,
    }, '牵手', { now: 20, id: 'touch-b' });

    expect(second.settings.touchPresets?.map(item => item.name)).toEqual(['摸头', '牵手']);
    const selected = activateCompanionTouchPreset(second.settings, 'touch-a');
    expect(selected.activeTouchPresetId).toBe('touch-a');
    expect(selected.enabledZones).toEqual(['head']);
    expect(selected.reactions.head?.[0].voiceAssetId).toBe('companion-touch-voice:first');
    expect([...collectCompanionVoiceAssetIds(second.settings)].sort()).toEqual([
      'companion-touch-voice:first',
      'companion-touch-voice:second',
    ]);
  });

  it('edits the active touch reaction and its saved preset without leaking TTS markup into text', () => {
    const saved = saveCompanionTouchPreset(emptySettings(), {
      enabledZones: ['head'],
      reactions: { head: [{ id: 'a', text: '别闹。', performance: performance('neutral', 'idle') }] },
      voiceEnabled: true,
    }, '摸头', { now: 10, id: 'touch-a' });
    const updated = updateCompanionTouchReaction(saved.settings, 'head', 'a', {
      ttsText: '别闹。<#0.4#>(chuckle)',
      performance: performance('happy', 'wave'),
    });

    expect(updated.reactions.head?.[0].text).toBe('别闹。');
    expect(updated.reactions.head?.[0].ttsText).toContain('<#0.4#>');
    expect(updated.touchPresets?.[0].reactions.head?.[0].performance.gesture).toBe('wave');
  });
});

describe('merging generated zones into the active touch pack', () => {
  const reaction = (id: string) => ({ id, text: id, performance: performance('happy', 'wave') });

  const packWithHead = () => saveCompanionTouchPreset(emptySettings(), {
    enabledZones: ['head'],
    reactions: { head: [reaction('head-1')] },
    voiceLanguage: '',
    voiceEnabled: false,
    voiceGeneratedCount: 1,
    generatedAt: 10,
  }, '主包', { now: 10 });

  it('adds a new zone without dropping zones generated earlier', () => {
    const base = packWithHead();
    const merged = mergeCompanionTouchReactions(base.settings, {
      enabledZones: ['hand'],
      reactions: { hand: [reaction('hand-1')] },
      voiceLanguage: '',
      voiceEnabled: false,
      voiceGeneratedCount: 1,
      generatedAt: 20,
    }, { now: 20 });
    expect(Object.keys(merged.settings.reactions).sort()).toEqual(['hand', 'head']);
    expect(merged.settings.reactions.head?.[0].id).toBe('head-1');
    expect(merged.settings.enabledZones.sort()).toEqual(['hand', 'head']);
    // 语音条数累加，否则界面上的「语音 N 条」会随每次合并倒退。
    expect(merged.settings.voiceGeneratedCount).toBe(2);
  });

  it('updates the active preset in place instead of creating another one', () => {
    const base = packWithHead();
    const merged = mergeCompanionTouchReactions(base.settings, {
      enabledZones: ['hand'],
      reactions: { hand: [reaction('hand-1')] },
      voiceLanguage: '',
      voiceEnabled: false,
      voiceGeneratedCount: 0,
      generatedAt: 20,
    }, { now: 20 });
    expect(merged.settings.touchPresets).toHaveLength(1);
    expect(merged.preset?.id).toBe(base.preset.id);
    expect(merged.settings.activeTouchPresetId).toBe(base.preset.id);
    // 关键：切走再切回来，合并进去的部位必须还在。
    const reactivated = activateCompanionTouchPreset(merged.settings, base.preset.id);
    expect(Object.keys(reactivated.reactions).sort()).toEqual(['hand', 'head']);
  });

  it('replaces only the zones this run actually produced', () => {
    const base = packWithHead();
    const merged = mergeCompanionTouchReactions(base.settings, {
      enabledZones: ['head', 'hand'],
      // 本次只有 head 写出来了；hand 缺席不应清掉已有内容。
      reactions: { head: [reaction('head-2')], hand: undefined },
      voiceLanguage: '',
      voiceEnabled: false,
      voiceGeneratedCount: 0,
      generatedAt: 20,
    }, { now: 20 });
    expect(merged.settings.reactions.head?.[0].id).toBe('head-2');
    expect(merged.settings.reactions.hand).toBeUndefined();
  });

  it('still merges when no preset was ever saved', () => {
    const merged = mergeCompanionTouchReactions(emptySettings(), {
      enabledZones: ['face'],
      reactions: { face: [reaction('face-1')] },
      voiceLanguage: '',
      voiceEnabled: false,
      voiceGeneratedCount: 0,
      generatedAt: 20,
    }, { now: 20 });
    expect(merged.preset).toBeUndefined();
    expect(merged.settings.reactions.face?.[0].id).toBe('face-1');
  });
});
