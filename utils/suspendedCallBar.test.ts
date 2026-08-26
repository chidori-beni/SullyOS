import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('suspended call return affordance', () => {
  it('renders the return action in a portal above notification previews', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/os/SuspendedCallBar.tsx'), 'utf8');

    expect(source).toContain('createPortal');
    expect(source).toContain('z-[1400]');
    expect(source).toContain('pointer-events-auto');
    expect(source).toContain('type="button"');
    expect(source).toContain('data-testid="suspended-call-return"');
    expect(source).toContain('event.stopPropagation()');
  });

  it('uses the standalone return component from PhoneShell', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/PhoneShell.tsx'), 'utf8');

    expect(source).toContain("import SuspendedCallBar from './os/SuspendedCallBar'");
    expect(source).toContain('<SuspendedCallBar charName={suspendedCall.charName} onResume={resumeCall} />');
    expect(source).not.toContain('onClick={resumeCall}');
  });
});
