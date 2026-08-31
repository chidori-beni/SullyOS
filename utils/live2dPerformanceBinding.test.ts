import { describe, expect, it } from 'vitest';
import type { AvatarPerformanceDirection } from './avatarPerformance';
import { live2dActionMatchKey } from './live2dActionNaming';
import {
  LIVE2D_AUTO_ACTION,
  patchLive2DPerformanceAction,
  resolveLive2DPerformanceDirection,
  selectLive2DPerformanceAction,
} from './live2dPerformanceBinding';

const baseDirection = (): AvatarPerformanceDirection => ({
  emotion: 'happy',
  gesture: 'talk',
  camera: 'medium',
  gaze: 'viewer',
  intensity: 0.7,
});

const outfitA = [
  { id: 'motion-0', rawName: 'X_02_huaixiao3_idle' },
  { id: 'motion-9', rawName: 'X_02_wenrou_idle' },
];

const outfitB = [
  { id: 'motion-0', rawName: 'X_10_wenrou_idle' },
  { id: 'motion-2', rawName: 'X_10_huaixiao3_idle' },
];

describe('per-outfit Live2D performance bindings', () => {
  it('keeps outfit A and B manual choices independent even when IDs collide', () => {
    const aPatch = patchLive2DPerformanceAction(baseDirection(), 'outfit-a', 'motion-9', outfitA);
    const withA = { ...baseDirection(), ...aPatch };
    const bPatch = patchLive2DPerformanceAction(withA, 'outfit-b', 'motion-0', outfitB);
    const saved = { ...withA, ...bPatch };

    expect(Object.keys(saved.modelActionByAvatarAssetId || {}).sort()).toEqual(['outfit-a', 'outfit-b']);
    expect(saved.modelActionByAvatarAssetId?.['outfit-a']?.modelAction).toBe('motion-9');
    expect(saved.modelActionByAvatarAssetId?.['outfit-b']?.modelAction).toBe('motion-0');

    const resolvedA = resolveLive2DPerformanceDirection(saved, 'outfit-a', outfitA)!;
    const resolvedB = resolveLive2DPerformanceDirection(saved, 'outfit-b', outfitB)!;
    expect(resolvedA.direction.modelAction).toBe('motion-9');
    expect(resolvedB.direction.modelAction).toBe('motion-0');
    expect(resolvedA.source).toBe('avatar-id');
    expect(resolvedB.source).toBe('avatar-id');
  });

  it('uses the saved semantic key only inside the matching outfit when its ID is unavailable', () => {
    const saved: AvatarPerformanceDirection = {
      ...baseDirection(),
      modelActionByAvatarAssetId: {
        'outfit-a': {
          modelAction: 'removed-motion',
          modelActionKey: live2dActionMatchKey('X_02_huaixiao3_idle'),
        },
      },
    };

    const resolved = resolveLive2DPerformanceDirection(saved, 'outfit-a', outfitA)!;
    expect(resolved.direction.modelAction).toBe('motion-0');
    expect(resolved.source).toBe('avatar-key-exact');
  });

  it('treats an explicit per-outfit no-action choice as stronger than the legacy fallback', () => {
    const legacy: AvatarPerformanceDirection = {
      ...baseDirection(),
      modelAction: 'motion-0',
      modelActionKey: live2dActionMatchKey('X_02_huaixiao3_idle'),
      modelActions: ['motion-0'],
      modelActionByAvatarAssetId: { 'outfit-a': null },
    };

    const resolvedA = resolveLive2DPerformanceDirection(legacy, 'outfit-a', outfitA)!;
    const resolvedB = resolveLive2DPerformanceDirection(legacy, 'outfit-b', outfitB)!;
    expect(resolvedA.source).toBe('avatar-explicit-none');
    expect(resolvedA.direction.modelAction).toBeUndefined();
    expect(resolvedB.source).toBe('legacy-key-exact');
    expect(resolvedB.direction.modelAction).toBe('motion-2');
  });

  it('deletes only the current outfit override when the user chooses automatic matching', () => {
    const aPatch = patchLive2DPerformanceAction(baseDirection(), 'outfit-a', 'motion-9', outfitA);
    const withA = { ...baseDirection(), ...aPatch };
    const autoPatch = patchLive2DPerformanceAction(withA, 'outfit-a', LIVE2D_AUTO_ACTION, outfitA);
    expect(autoPatch.modelActionByAvatarAssetId).toBeUndefined();

    const legacy: AvatarPerformanceDirection = {
      ...baseDirection(),
      modelAction: 'motion-9',
      modelActionKey: live2dActionMatchKey('X_02_wenrou_idle'),
    };
    expect(selectLive2DPerformanceAction(legacy, 'outfit-b', outfitB)).toBe(LIVE2D_AUTO_ACTION);
  });

  it('does not fall back to a positional ID when a saved semantic key cannot resolve', () => {
    const saved: AvatarPerformanceDirection = {
      ...baseDirection(),
      modelAction: 'motion-0',
      modelActionKey: '悲伤#1#idle',
    };
    const resolved = resolveLive2DPerformanceDirection(saved, 'outfit-b', outfitB)!;
    expect(resolved.source).toBe('legacy-key-none');
    expect(resolved.direction.modelAction).toBeUndefined();
  });
});
