/**
 * 角色立绘 / 见面背景「瘦身」（2026-11-21）。
 *
 * 背景：见面立绘（sprites + 各皮肤套装）和见面背景都以 base64 内联在角色档案里。用户的萧逸
 * 档案 708 万字符，其中立绘 455 万、见面背景 105 万（通话 trace `call-baseline`）。每次读写
 * 这个角色（推送落库、记忆整理、存档）都要把这一整箱图搬一遍，iPhone 上通话时页面被系统杀掉。
 *
 * 做法：一张一张重新编码（能用 WebP 就用 WebP，保留透明；不透明的用 JPEG；都不行就把 PNG
 * 缩小一点），只有确实变小 15% 以上才替换。**原图不丢**：存进 blob_assets（独立的图片仓，
 * 不在角色档案里、平时不进内存），清单记在 assets 的 `char-image-slim-backup:<charId>`，
 * 「还原原图」时原样写回。
 *
 * 只动内联的 data:image；blobref 令牌、网络图片、渐变字符串一律不碰。
 */

import type { CharacterProfile, SkinSet } from '../types';
import { DB } from './db';
import { getBlobForRef, putImageBlob } from './blobRef';

export type SlimKind = 'sprite' | 'background';

export interface SlimTarget {
    /** 'sprites/<key>' | 'skin/<skinId>/<key>' | 'dateBackground' */
    path: string;
    /** 给人看的名字，例如「立绘 happy」「皮肤 夏装 · normal」「见面背景」 */
    label: string;
    kind: SlimKind;
    value: string;
}

export interface SlimBackupEntry {
    path: string;
    ref: string;
    label: string;
    savedAt: number;
}

export const slimBackupKey = (charId: string) => `char-image-slim-backup:${charId}`;

const isInlineImage = (value: unknown): value is string =>
    typeof value === 'string' && value.startsWith('data:image/') && !value.startsWith('data:image/gif');

/** 列出这个角色里可以瘦身的内联图片。 */
export function collectSlimTargets(char: Pick<CharacterProfile, 'sprites' | 'dateSkinSets' | 'dateBackground'>): SlimTarget[] {
    const targets: SlimTarget[] = [];
    for (const [key, value] of Object.entries(char.sprites || {})) {
        if (isInlineImage(value)) targets.push({ path: `sprites/${key}`, label: `立绘 ${key}`, kind: 'sprite', value });
    }
    for (const skin of char.dateSkinSets || []) {
        for (const [key, value] of Object.entries(skin.sprites || {})) {
            if (isInlineImage(value)) {
                targets.push({ path: `skin/${skin.id}/${key}`, label: `皮肤 ${skin.name} · ${key}`, kind: 'sprite', value });
            }
        }
    }
    if (isInlineImage(char.dateBackground)) {
        targets.push({ path: 'dateBackground', label: '见面背景', kind: 'background', value: char.dateBackground });
    }
    return targets;
}

/** 这些图一共多少字符（给界面显示「约 X MB」用）。 */
export const totalSlimChars = (targets: SlimTarget[]) => targets.reduce((sum, t) => sum + t.value.length, 0);

/** 把 path → 新值 的替换合成一份角色补丁（只含改动到的字段）。 */
export function buildSlimPatch(
    char: Pick<CharacterProfile, 'sprites' | 'dateSkinSets' | 'dateBackground'>,
    replacements: Map<string, string>,
): Partial<CharacterProfile> {
    const patch: Partial<CharacterProfile> = {};
    let sprites: Record<string, string> | undefined;
    let skins: SkinSet[] | undefined;
    for (const [path, next] of replacements) {
        if (path === 'dateBackground') {
            patch.dateBackground = next;
            continue;
        }
        const parts = path.split('/');
        if (parts[0] === 'sprites' && parts.length >= 2) {
            const key = parts.slice(1).join('/');
            sprites = sprites || { ...(char.sprites || {}) };
            if (key in sprites) sprites[key] = next;
            continue;
        }
        if (parts[0] === 'skin' && parts.length >= 3) {
            const skinId = parts[1];
            const key = parts.slice(2).join('/');
            skins = skins || (char.dateSkinSets || []).map(skin => ({ ...skin, sprites: { ...skin.sprites } }));
            const skin = skins.find(s => s.id === skinId);
            if (skin && key in skin.sprites) skin.sprites[key] = next;
        }
    }
    if (sprites) patch.sprites = sprites;
    if (skins) patch.dateSkinSets = skins;
    return patch;
}

// ─── 浏览器里的重新编码 ─────────────────────────────────

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = src;
});

let webpSupport: boolean | null = null;
const canEncodeWebp = (): boolean => {
    if (webpSupport !== null) return webpSupport;
    try {
        const c = document.createElement('canvas');
        c.width = c.height = 2;
        webpSupport = c.toDataURL('image/webp', 0.8).startsWith('data:image/webp');
    } catch {
        webpSupport = false;
    }
    return webpSupport;
};

const hasTransparency = (ctx: CanvasRenderingContext2D, width: number, height: number): boolean => {
    try {
        const data = ctx.getImageData(0, 0, width, height).data;
        // 每隔 16 个像素抽一个，够判断「是不是抠了底的立绘」
        for (let i = 3; i < data.length; i += 64) if (data[i] < 250) return true;
        return false;
    } catch {
        return true; // 读不到就当有透明，宁可保守
    }
};

/** 只有比原来小这么多才替换（小于 15% 的收益不值得冒画质风险）。 */
const MIN_SAVING_RATIO = 0.85;

/**
 * 重新编码一张图。返回 null = 不值得换（变不小 / 读不出来）。
 * 立绘最长边 1200（和上传时的压缩口径一致，不会比上传时更糊）；背景 1280。
 */
export async function slimOneImage(dataUrl: string, kind: SlimKind): Promise<string | null> {
    const img = await loadImage(dataUrl);
    const maxSide = kind === 'background' ? 1280 : 1200;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    try {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const transparent = kind === 'sprite' && hasTransparency(ctx, width, height);
        const candidates: string[] = [];
        if (canEncodeWebp()) candidates.push(canvas.toDataURL('image/webp', 0.88));
        if (!transparent) {
            candidates.push(canvas.toDataURL('image/jpeg', 0.85));
        } else if (!canEncodeWebp()) {
            // 透明立绘又编不了 WebP：只能保持 PNG，把最长边再收到 1024
            const s2 = Math.min(1, 1024 / Math.max(width, height));
            if (s2 < 1) {
                const c2 = document.createElement('canvas');
                c2.width = Math.max(1, Math.round(width * s2));
                c2.height = Math.max(1, Math.round(height * s2));
                const ctx2 = c2.getContext('2d');
                if (ctx2) {
                    ctx2.drawImage(canvas, 0, 0, c2.width, c2.height);
                    candidates.push(c2.toDataURL('image/png'));
                }
                c2.width = c2.height = 0;
            } else {
                candidates.push(canvas.toDataURL('image/png'));
            }
        }
        const best = candidates
            .filter(c => c.startsWith('data:image/'))
            .sort((a, b) => a.length - b.length)[0];
        if (!best || best.length > dataUrl.length * MIN_SAVING_RATIO) return null;
        return best;
    } finally {
        // iOS 上 canvas 不归零不会马上还显存
        canvas.width = canvas.height = 0;
    }
}

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => (await fetch(dataUrl)).blob();

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('原图读取失败'));
    reader.readAsDataURL(blob);
});

export async function readSlimBackup(charId: string): Promise<SlimBackupEntry[]> {
    try {
        const raw = await DB.getAsset(slimBackupKey(charId));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter(e => e && typeof e.path === 'string' && typeof e.ref === 'string') : [];
    } catch {
        return [];
    }
}

export interface SlimRunResult {
    patch: Partial<CharacterProfile>;
    changed: number;
    skipped: number;
    failed: number;
    beforeChars: number;
    afterChars: number;
}

/**
 * 跑一遍瘦身。先把原图存进图片仓、记好清单，再返回补丁——调用方拿补丁去 updateCharacter。
 * 同一位置已经备份过原图的（之前瘦过一次），保留最早那份原图，不拿压缩图覆盖它。
 */
export async function runCharImageSlim(
    char: CharacterProfile,
    onProgress?: (done: number, total: number, label: string) => void,
): Promise<SlimRunResult> {
    const targets = collectSlimTargets(char);
    const existing = await readSlimBackup(char.id);
    const backedUp = new Set(existing.map(e => e.path));
    const backup = [...existing];
    const replacements = new Map<string, string>();
    let skipped = 0;
    let failed = 0;
    let beforeChars = 0;
    let afterChars = 0;
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        onProgress?.(i, targets.length, target.label);
        beforeChars += target.value.length;
        let next: string | null = null;
        try {
            next = await slimOneImage(target.value, target.kind);
        } catch {
            failed += 1;
        }
        if (!next) {
            if (next === null) skipped += 1;
            afterChars += target.value.length;
            continue;
        }
        if (!backedUp.has(target.path)) {
            const ref = await putImageBlob(await dataUrlToBlob(target.value));
            backup.push({ path: target.path, ref, label: target.label, savedAt: Date.now() });
            backedUp.add(target.path);
        }
        replacements.set(target.path, next);
        afterChars += next.length;
    }
    onProgress?.(targets.length, targets.length, '');
    if (replacements.size > 0) {
        // 清单必须先落库，再改角色：改完角色却没记下原图在哪 = 原图丢了
        await DB.saveAsset(slimBackupKey(char.id), JSON.stringify(backup));
    }
    skipped -= failed;
    return {
        patch: buildSlimPatch(char, replacements),
        changed: replacements.size,
        skipped: Math.max(0, skipped),
        failed,
        beforeChars,
        afterChars,
    };
}

/** 把备份的原图写回。返回补丁；找不到的原图跳过（missing 计数）。 */
export async function restoreCharImageSlim(char: CharacterProfile): Promise<{ patch: Partial<CharacterProfile>; restored: number; missing: number }> {
    const backup = await readSlimBackup(char.id);
    const replacements = new Map<string, string>();
    let missing = 0;
    for (const entry of backup) {
        const blob = await getBlobForRef(entry.ref);
        if (!blob) { missing += 1; continue; }
        replacements.set(entry.path, await blobToDataUrl(blob));
    }
    return { patch: buildSlimPatch(char, replacements), restored: replacements.size, missing };
}

/** 还原成功、确认写回角色之后再调：清掉清单（原图 blob 留着，宁可占点空间也不冒丢图风险）。 */
export async function clearSlimBackup(charId: string): Promise<void> {
    try { await DB.deleteAsset(slimBackupKey(charId)); } catch { /* ignore */ }
}
