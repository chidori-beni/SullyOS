import type {
  CharacterProfile,
  CompanionStartupPreset,
  CompanionStartupSettings,
  CompanionTouchPreset,
  CompanionTouchReaction,
  CompanionTouchSettings,
  CompanionTouchZone,
} from '../types';

type TouchSnapshot = Pick<
  CompanionTouchSettings,
  'enabledZones' | 'reactions' | 'voiceLanguage' | 'voiceEnabled' | 'voiceGeneratedCount' | 'generatedAt'
>;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const makePresetId = (kind: 'startup' | 'touch', now: number): string => {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  return `companion-${kind}-preset:${now.toString(36)}:${random}`;
};

const presetName = (name: string, fallback: string): string => name.trim().slice(0, 40) || fallback;

export function saveCompanionStartupPreset(
  settings: CompanionTouchSettings,
  startup: CompanionStartupSettings,
  name: string,
  options: { now?: number; id?: string } = {},
): { settings: CompanionTouchSettings; preset: CompanionStartupPreset } {
  const now = options.now ?? Date.now();
  const presets = settings.startupPresets || [];
  const preset: CompanionStartupPreset = {
    id: options.id || makePresetId('startup', now),
    name: presetName(name, `开机演出 ${presets.length + 1}`),
    startup: cloneJson(startup),
    createdAt: now,
    updatedAt: now,
  };
  return {
    preset,
    settings: {
      ...settings,
      startup: cloneJson(startup),
      startupPresets: [...presets, preset],
      activeStartupPresetId: preset.id,
    },
  };
}

export function activateCompanionStartupPreset(
  settings: CompanionTouchSettings,
  presetId: string,
): CompanionTouchSettings {
  const preset = settings.startupPresets?.find(item => item.id === presetId);
  if (!preset) return settings;
  return {
    ...settings,
    startup: cloneJson(preset.startup),
    activeStartupPresetId: preset.id,
  };
}

export function saveCompanionTouchPreset(
  settings: CompanionTouchSettings,
  snapshot: TouchSnapshot,
  name: string,
  options: { now?: number; id?: string } = {},
): { settings: CompanionTouchSettings; preset: CompanionTouchPreset } {
  const now = options.now ?? Date.now();
  const presets = settings.touchPresets || [];
  const preset: CompanionTouchPreset = {
    id: options.id || makePresetId('touch', now),
    name: presetName(name, `触摸反馈 ${presets.length + 1}`),
    enabledZones: [...snapshot.enabledZones],
    reactions: cloneJson(snapshot.reactions),
    voiceLanguage: snapshot.voiceLanguage,
    voiceEnabled: snapshot.voiceEnabled,
    voiceGeneratedCount: snapshot.voiceGeneratedCount,
    generatedAt: snapshot.generatedAt,
    createdAt: now,
    updatedAt: now,
  };
  return {
    preset,
    settings: {
      ...settings,
      ...cloneJson(snapshot),
      touchPresets: [...presets, preset],
      activeTouchPresetId: preset.id,
    },
  };
}

/**
 * 把新生成的部位并进「当前正在用的这一包」，而不是另存一套。
 * 一次生成全部部位容易被模型截断，用户只能一个部位一个部位地生成；
 * 若每次都新建预设，最后会得到 N 套各只有一个部位的包，而同一时刻只有一套生效。
 *
 * 只覆盖本次真正生成出来的部位，其余部位原样保留；同时就地更新当前激活的那一套预设，
 * 让「下拉里选中的那一套」和「实际生效的内容」始终一致。
 */
export function mergeCompanionTouchReactions(
  settings: CompanionTouchSettings,
  snapshot: TouchSnapshot,
  options: { now?: number } = {},
): { settings: CompanionTouchSettings; preset?: CompanionTouchPreset } {
  const now = options.now ?? Date.now();
  const incoming = snapshot.reactions || {};
  const mergedReactions: CompanionTouchSettings['reactions'] = cloneJson(settings.reactions || {});
  for (const [zone, items] of Object.entries(incoming) as Array<[CompanionTouchZone, CompanionTouchReaction[] | undefined]>) {
    if (!items?.length) continue;
    mergedReactions[zone] = cloneJson(items);
  }
  const mergedZones = [...new Set([...(settings.enabledZones || []), ...snapshot.enabledZones])];
  const voiceGeneratedCount = (settings.voiceGeneratedCount || 0) + (snapshot.voiceGeneratedCount || 0);
  const merged: CompanionTouchSettings = {
    ...settings,
    enabledZones: mergedZones,
    reactions: mergedReactions,
    // 语言/语音开关跟随本次生成，避免同一包里混着两种语言的音频设定。
    voiceLanguage: snapshot.voiceLanguage,
    voiceEnabled: snapshot.voiceEnabled,
    voiceGeneratedCount,
    generatedAt: snapshot.generatedAt ?? settings.generatedAt,
  };
  const activeId = settings.activeTouchPresetId;
  const active = activeId ? settings.touchPresets?.find(item => item.id === activeId) : undefined;
  if (!active) return { settings: merged };
  const preset: CompanionTouchPreset = {
    ...active,
    enabledZones: [...mergedZones],
    reactions: cloneJson(mergedReactions),
    voiceLanguage: merged.voiceLanguage,
    voiceEnabled: merged.voiceEnabled,
    voiceGeneratedCount,
    generatedAt: merged.generatedAt,
    updatedAt: now,
  };
  return {
    preset,
    settings: {
      ...merged,
      touchPresets: (settings.touchPresets || []).map(item => item.id === preset.id ? preset : item),
    },
  };
}

export function activateCompanionTouchPreset(
  settings: CompanionTouchSettings,
  presetId: string,
): CompanionTouchSettings {
  const preset = settings.touchPresets?.find(item => item.id === presetId);
  if (!preset) return settings;
  return {
    ...settings,
    enabledZones: [...preset.enabledZones],
    reactions: cloneJson(preset.reactions),
    voiceLanguage: preset.voiceLanguage,
    voiceEnabled: preset.voiceEnabled,
    voiceGeneratedCount: preset.voiceGeneratedCount,
    generatedAt: preset.generatedAt,
    activeTouchPresetId: preset.id,
  };
}

export function updateCompanionTouchReaction(
  settings: CompanionTouchSettings,
  zone: CompanionTouchZone,
  reactionId: string,
  patch: Partial<CompanionTouchReaction>,
): CompanionTouchSettings {
  const patchList = (source?: CompanionTouchReaction[]) => source?.map(item => (
    item.id === reactionId ? { ...item, ...cloneJson(patch) } : item
  ));
  const reactions = {
    ...settings.reactions,
    [zone]: patchList(settings.reactions?.[zone]),
  };
  return {
    ...settings,
    reactions,
    touchPresets: settings.touchPresets?.map(preset => (
      preset.id === settings.activeTouchPresetId
        ? { ...preset, reactions: { ...preset.reactions, [zone]: patchList(preset.reactions?.[zone]) }, updatedAt: Date.now() }
        : preset
    )),
  };
}

export const removeCompanionStartupPreset = (
  settings: CompanionTouchSettings,
  presetId: string,
): CompanionTouchSettings => ({
  ...settings,
  startupPresets: (settings.startupPresets || []).filter(item => item.id !== presetId),
  activeStartupPresetId: settings.activeStartupPresetId === presetId ? undefined : settings.activeStartupPresetId,
});

export const removeCompanionTouchPreset = (
  settings: CompanionTouchSettings,
  presetId: string,
): CompanionTouchSettings => ({
  ...settings,
  touchPresets: (settings.touchPresets || []).filter(item => item.id !== presetId),
  activeTouchPresetId: settings.activeTouchPresetId === presetId ? undefined : settings.activeTouchPresetId,
});

const collectReactionVoiceIds = (
  reactions: Partial<Record<CompanionTouchZone, CompanionTouchReaction[]>> | undefined,
  ids: Set<string>,
) => {
  Object.values(reactions || {}).forEach(items => items?.forEach(item => {
    if (item.voiceAssetId) ids.add(item.voiceAssetId);
  }));
};

export function collectCompanionVoiceAssetIds(settings?: CompanionTouchSettings | null): Set<string> {
  const ids = new Set<string>();
  if (!settings) return ids;
  if (settings.startup?.voiceAssetId) ids.add(settings.startup.voiceAssetId);
  collectReactionVoiceIds(settings.reactions, ids);
  settings.startupPresets?.forEach(preset => {
    if (preset.startup.voiceAssetId) ids.add(preset.startup.voiceAssetId);
  });
  settings.touchPresets?.forEach(preset => collectReactionVoiceIds(preset.reactions, ids));
  return ids;
}

export const collectCharacterCompanionVoiceAssetIds = (characters: CharacterProfile[]): Set<string> => {
  const ids = new Set<string>();
  characters.forEach(character => {
    collectCompanionVoiceAssetIds(character.companionTouchSettings).forEach(id => ids.add(id));
  });
  return ids;
};
