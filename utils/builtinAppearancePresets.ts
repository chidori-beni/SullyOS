import type { AppearancePreset } from '../types';

/**
 * 内置外观只在这里登记轻量描述；真正的预设 JSON 和图片放在 public 下，
 * 点击「应用」时才加载，避免把 6MB 以上的图片塞进首屏 JS。
 */
export interface BuiltinAppearancePresetDescriptor {
  id: string;
  name: string;
  description: string;
  version: number;
  manifestPath: string;
  swatch: string;
}

export const BUILTIN_APPEARANCE_PRESETS: ReadonlyArray<BuiltinAppearancePresetDescriptor> = [
  {
    id: 'builtin:cocoa-dots',
    name: '可可点点',
    description: '奶油可可色调、俏皮圆点和柔软小组件，整机像一间温暖的轻松熊甜品屋。',
    version: 1,
    manifestPath: 'appearance-presets/cocoa-dots/v1/preset.json',
    swatch: 'linear-gradient(rgba(247,245,242,.18),rgba(74,59,49,.18)),url("./appearance-presets/cocoa-dots/v1/wallpaper-desktop.png") center/cover',
  },
];

const builtinManifestCache = new Map<string, Promise<AppearancePreset>>();

const isRecord = (value: unknown): value is Record<string, any> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const getManifestUrl = (descriptor: BuiltinAppearancePresetDescriptor): string => {
  const base = import.meta.env.BASE_URL || '/';
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  return new URL(`${baseWithSlash}${descriptor.manifestPath}`, document.baseURI).href;
};

const resolveResourceRef = (value: unknown, manifestUrl: string): unknown => (
  typeof value === 'string' && value.startsWith('./')
    ? new URL(value, manifestUrl).href
    : value
);

/** 只解析 manifest 的资源字段，不碰 CSS 文本里的 url() 和 data URL。 */
const resolveManifestResources = (raw: Record<string, any>, manifestUrl: string): AppearancePreset => {
  const theme = { ...(raw.theme as Record<string, any>) };

  for (const key of ['wallpaper', 'lockWallpaper', 'chatBackground', 'customFont']) {
    if (key in theme) theme[key] = resolveResourceRef(theme[key], manifestUrl);
  }

  if (isRecord(theme.launcherWidgets)) {
    theme.launcherWidgets = Object.fromEntries(
      Object.entries(theme.launcherWidgets).map(([slot, value]) => [slot, resolveResourceRef(value, manifestUrl)]),
    );
  }

  if (Array.isArray(theme.launcherUserWidgets)) {
    theme.launcherUserWidgets = theme.launcherUserWidgets.map((widget: any) => (
      isRecord(widget) && 'image' in widget
        ? { ...widget, image: resolveResourceRef(widget.image, manifestUrl) }
        : widget
    ));
  }

  if (Array.isArray(theme.desktopDecorations)) {
    theme.desktopDecorations = theme.desktopDecorations.map((decoration: any) => {
      if (!isRecord(decoration)) return decoration;
      const resolved = { ...decoration };
      if ('image' in resolved) resolved.image = resolveResourceRef(resolved.image, manifestUrl);
      if (resolved.type === 'image' && typeof resolved.content === 'string') {
        resolved.content = resolveResourceRef(resolved.content, manifestUrl);
      }
      return resolved;
    });
  }

  const customIcons = isRecord(raw.customIcons)
    ? Object.fromEntries(Object.entries(raw.customIcons).map(([appId, value]) => [appId, resolveResourceRef(value, manifestUrl)]))
    : undefined;

  return {
    ...raw,
    id: raw.id,
    name: raw.name,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    theme,
    ...(customIcons ? { customIcons } : {}),
  } as AppearancePreset;
};

const fetchBuiltinAppearancePreset = async (descriptor: BuiltinAppearancePresetDescriptor): Promise<AppearancePreset> => {
  const manifestUrl = getManifestUrl(descriptor);
  const response = await fetch(manifestUrl, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`内置外观「${descriptor.name}」加载失败（HTTP ${response.status}）`);
  }

  const raw: unknown = await response.json();
  if (!isRecord(raw) || raw.type !== 'sully_appearance_preset' || !isRecord(raw.theme)) {
    throw new Error(`内置外观「${descriptor.name}」的预设文件格式不正确`);
  }

  return {
    ...resolveManifestResources(raw, manifestUrl),
    id: descriptor.id,
    name: descriptor.name,
  };
};

export const loadBuiltinAppearancePreset = async (id: string): Promise<AppearancePreset> => {
  const descriptor = BUILTIN_APPEARANCE_PRESETS.find(preset => preset.id === id);
  if (!descriptor) throw new Error('内置外观预设不存在');

  const cached = builtinManifestCache.get(id);
  if (cached) return cached;

  const pending = fetchBuiltinAppearancePreset(descriptor);
  builtinManifestCache.set(id, pending);
  try {
    return await pending;
  } catch (error) {
    // 网络或资源部署失败时允许用户修复后重试，而不是永久缓存失败。
    builtinManifestCache.delete(id);
    throw error;
  }
};
