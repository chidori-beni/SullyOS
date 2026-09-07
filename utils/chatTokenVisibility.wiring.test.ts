import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, `file:///${root.replace(/\\/g, '/')}/`), 'utf8');

describe('聊天 Token 用量显示开关接线', () => {
  it('把开关按当前角色持久化，并保持旧角色默认显示', () => {
    const types = read('types.ts');
    const chat = read('apps/Chat.tsx');
    const modals = read('components/chat/ChatModals.tsx');

    expect(types).toContain('showTokenUsage?: boolean;');
    expect(chat).toContain('const [settingsShowTokenUsage, setSettingsShowTokenUsage] = useState(true);');
    expect(chat).toContain('setSettingsShowTokenUsage(char.showTokenUsage !== false);');
    expect(chat).toContain('showTokenUsage: settingsShowTokenUsage,');
    expect(chat).toContain('settingsShowTokenUsage={settingsShowTokenUsage} setSettingsShowTokenUsage={setSettingsShowTokenUsage}');
    expect(chat).toContain('showTokenUsage={char.showTokenUsage !== false}');
    expect(modals).toContain('settingsShowTokenUsage: boolean;');
    expect(modals).toContain('显示 Token 用量');
    expect(modals).toContain('aria-checked={settingsShowTokenUsage}');
  });

  it('顶栏的标准布局和居中布局都受同一个开关控制', () => {
    const header = read('components/chat/ChatHeaderShell.tsx');

    expect(header).toContain('showTokenUsage = true');
    expect(header).toContain('((showTokenUsage && lastTokenUsage) || isInstantSending');
    expect((header.match(/showTokenUsage && lastTokenUsage && \(/g) || []).length).toBe(2);
  });
});
