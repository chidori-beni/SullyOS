import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { isVRDynamicRecipient } from './participation';

it('busy/sleep activity blocking does not remove enabled roles from user dynamic delivery', () => {
    expect(isVRDynamicRecipient({ vrState: { enabled: true, activityMode: 'scheduled' } })).toBe(true);
    expect(isVRDynamicRecipient({ vrState: { enabled: true, activityMode: 'manual' } })).toBe(true);
    expect(isVRDynamicRecipient({ vrState: { enabled: false } })).toBe(false);
});

it('VRWorld broadcasts user dynamics to connected roles, not only currently active roles', () => {
    const source = readFileSync(new URL('../../apps/VRWorldApp.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const connectedVRCharacters = useMemo(');
    expect(source).toMatch(/const onUserBoardPost[\s\S]*?const enabled = connectedVRCharacters;/);
    expect(source).toMatch(/const onUserVRBroadcast[\s\S]*?const enabled = connectedVRCharacters;/);
});
