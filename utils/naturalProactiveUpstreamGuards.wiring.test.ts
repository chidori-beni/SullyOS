import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// 本 fork 的「自然主动」借用主动消息 2.0 的云端通道，但被设计成 2.0 关着也能跑。
// 上游 2026-09 的两次改动（e53907bf 关 2.0 时清云端、d486bebb 2.0 关着就跳过到点消息）
// 都不知道这件事，照搬会让自然主动悄悄失效。这两条守着合并时补上的口子。
describe('自然主动不被上游的 2.0 开关连带关掉', () => {
    it('worker：2.0 关着时，自然主动的脉冲不走 schedule-off 跳过', () => {
        const worker = read('../worker/amsg/src/index.ts');
        expect(worker).toContain('const naturalFire = taskMeta.amsgNaturalProactive === true;');
        expect(worker).toContain('((scheduleOff && !naturalFire) ||');
    });

    it('前端：关 2.0 时，自然主动开着就不清云端上下文和凭据', () => {
        const modal = read('../components/chat/ActiveMsg2SettingsModal.tsx');
        const at = modal.indexOf('const naturalStillLive = char.naturalProactiveConfig?.enabled === true;');
        expect(at).toBeGreaterThan(-1);
        const purgeAt = modal.indexOf('await purgeCharCloudState(', at);
        expect(purgeAt).toBeGreaterThan(at);
        expect(modal.slice(at, purgeAt)).toMatch(/naturalStillLive\s*\?\s*\{ status: 'skipped' as const \}/);
    });

    it('前端：打脏的门仍认自然主动（不是上游的「只看 2.0 AI 任务」）', () => {
        const sync = read('./amsgStateSync.ts');
        expect(sync).toContain('if (char.naturalProactiveConfig?.enabled) return true;');
        expect(sync).toContain('if (!needsCloudCharacterState(snapshot.char)) {');
    });
});
