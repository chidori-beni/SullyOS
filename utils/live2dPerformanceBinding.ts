import type { AvatarModelActionBinding } from '../types';
import type { AvatarPerformanceDirection } from './avatarPerformance';
import {
  live2dActionMatchKey,
  resolveLive2DActionByKey,
  type Live2DActionCandidate,
  type Live2DActionMatchTier,
} from './live2dActionNaming';

/** The select value used to remove a per-outfit override and use legacy/semantic fallback. */
export const LIVE2D_AUTO_ACTION = '__live2d_auto__';

export type Live2DPerformanceActionSource =
  | 'avatar-id'
  | 'avatar-key-exact'
  | 'avatar-key-similar'
  | 'avatar-explicit-none'
  | 'avatar-binding-none'
  | 'legacy-id'
  | 'legacy-key-exact'
  | 'legacy-key-similar'
  | 'legacy-key-none'
  | 'none';

export interface Live2DPerformanceActionResolution {
  direction: AvatarPerformanceDirection;
  source: Live2DPerformanceActionSource;
  tier: Live2DActionMatchTier;
  matchedRawName?: string;
}

const hasOwn = (value: object | undefined, key: string): boolean => (
  Boolean(value) && Object.prototype.hasOwnProperty.call(value, key)
);

const clearActionIds = (direction: AvatarPerformanceDirection): AvatarPerformanceDirection => {
  const next = { ...direction };
  delete next.modelAction;
  delete next.modelActions;
  return next;
};

const directActionIds = (
  binding: AvatarModelActionBinding | null | undefined,
  candidates: readonly Live2DActionCandidate[],
): { ids: string[]; matchedRawName?: string } => {
  const requested = [binding?.modelAction, ...(binding?.modelActions || [])]
    .filter((id): id is string => Boolean(id));
  const ids: string[] = [];
  let matchedRawName: string | undefined;
  for (const id of requested) {
    const match = candidates.find(candidate => candidate.id === id);
    if (!match || ids.includes(match.id)) continue;
    ids.push(match.id);
    if (!matchedRawName) matchedRawName = match.rawName;
  }
  return { ids, matchedRawName };
};

const directionActionIds = (
  direction: AvatarPerformanceDirection,
  candidates: readonly Live2DActionCandidate[],
): { ids: string[]; matchedRawName?: string } => directActionIds({
  modelAction: direction.modelAction,
  modelActions: direction.modelActions,
}, candidates);

const withActionIds = (
  direction: AvatarPerformanceDirection,
  ids: string[],
): AvatarPerformanceDirection => {
  if (!ids.length) return clearActionIds(direction);
  return { ...direction, modelAction: ids[0], modelActions: ids };
};

const keyResolution = (
  key: string,
  candidates: readonly Live2DActionCandidate[],
): { id: string; tier: Live2DActionMatchTier; rawName?: string } => {
  const match = resolveLive2DActionByKey(key, candidates);
  return { id: match.id, tier: match.tier, rawName: match.rawName || undefined };
};

/**
 * Resolve one saved performance direction against the currently visible whole-model outfit.
 *
 * A present map entry is an explicit override: `null` means no model action, while an object
 * means only that outfit's saved ID/key may be used. Missing entries intentionally fall back
 * to the pre-existing global semantic action, which keeps old/generated packs working.
 */
export const resolveLive2DPerformanceDirection = (
  direction: AvatarPerformanceDirection | undefined,
  assetId: string | undefined,
  candidates: readonly Live2DActionCandidate[],
): Live2DPerformanceActionResolution | undefined => {
  if (!direction) return undefined;

  const bindings = direction.modelActionByAvatarAssetId;
  if (assetId && hasOwn(bindings, assetId)) {
    const binding = bindings![assetId];
    if (binding === null) {
      return {
        direction: clearActionIds(direction),
        source: 'avatar-explicit-none',
        tier: 'none',
      };
    }
    const direct = directActionIds(binding, candidates);
    if (direct.ids.length) {
      return {
        direction: withActionIds(direction, direct.ids),
        source: 'avatar-id',
        tier: 'exact',
        matchedRawName: direct.matchedRawName,
      };
    }
    if (binding?.modelActionKey) {
      const match = keyResolution(binding.modelActionKey, candidates);
      if (match.id) {
        return {
          direction: withActionIds(direction, [match.id]),
          source: match.tier === 'exact' ? 'avatar-key-exact' : 'avatar-key-similar',
          tier: match.tier,
          matchedRawName: match.rawName,
        };
      }
    }
    return {
      direction: clearActionIds(direction),
      source: 'avatar-binding-none',
      tier: 'none',
    };
  }

  // A semantic key is more trustworthy than a positional legacy ID. If the key cannot
  // resolve, skipping is safer than silently playing another motion at the same index.
  if (direction.modelActionKey) {
    const match = keyResolution(direction.modelActionKey, candidates);
    if (match.id) {
      return {
        direction: withActionIds(direction, [match.id]),
        source: match.tier === 'exact' ? 'legacy-key-exact' : 'legacy-key-similar',
        tier: match.tier,
        matchedRawName: match.rawName,
      };
    }
    return {
      direction: clearActionIds(direction),
      source: 'legacy-key-none',
      tier: 'none',
    };
  }

  const direct = directionActionIds(direction, candidates);
  if (direct.ids.length) {
    return {
      direction: withActionIds(direction, direct.ids),
      source: 'legacy-id',
      tier: 'exact',
      matchedRawName: direct.matchedRawName,
    };
  }
  return { direction, source: 'none', tier: 'none' };
};

/** Return the action choice that should be shown in an outfit-aware select. */
export const selectLive2DPerformanceAction = (
  direction: AvatarPerformanceDirection,
  assetId: string | undefined,
  candidates: readonly Live2DActionCandidate[],
): string => {
  const bindings = direction.modelActionByAvatarAssetId;
  if (assetId && hasOwn(bindings, assetId)) {
    const resolution = resolveLive2DPerformanceDirection(direction, assetId, candidates);
    return resolution?.direction.modelAction || '';
  }
  if (assetId && (direction.modelAction || direction.modelActionKey || direction.modelActions?.length)) {
    return LIVE2D_AUTO_ACTION;
  }
  return direction.modelAction || '';
};

/**
 * Create a patch for a manual action select. With an asset ID this changes only that outfit's
 * map entry, never the global legacy fields shared by other outfits.
 */
export const patchLive2DPerformanceAction = (
  direction: AvatarPerformanceDirection,
  assetId: string | undefined,
  actionId: string,
  candidates: readonly Live2DActionCandidate[],
): Partial<AvatarPerformanceDirection> => {
  if (!assetId) {
    if (!actionId || actionId === LIVE2D_AUTO_ACTION) {
      return { modelAction: undefined, modelActionKey: undefined, modelActions: [] };
    }
    const picked = candidates.find(item => item.id === actionId);
    return {
      modelAction: actionId,
      modelActionKey: picked ? live2dActionMatchKey(picked.rawName) : undefined,
      modelActions: [actionId],
    };
  }

  const nextBindings: Record<string, AvatarModelActionBinding | null> = {
    ...(direction.modelActionByAvatarAssetId || {}),
  };
  if (actionId === LIVE2D_AUTO_ACTION) {
    delete nextBindings[assetId];
  } else if (!actionId) {
    nextBindings[assetId] = null;
  } else {
    const picked = candidates.find(item => item.id === actionId);
    nextBindings[assetId] = {
      modelAction: actionId,
      modelActionKey: picked ? live2dActionMatchKey(picked.rawName) : undefined,
      modelActions: [actionId],
    };
  }
  return {
    modelActionByAvatarAssetId: Object.keys(nextBindings).length ? nextBindings : undefined,
  };
};
