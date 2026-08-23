import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_MESSAGE_BANNER_CSS } from '../../utils/messageBannerCss';
import { DB } from '../../utils/db';

interface Props {
  value: string;
  onChange: (css: string) => void;
}

interface MessageBannerPreset {
  name: string;
  css: string;
  updatedAt: number;
}

const MESSAGE_BANNER_PRESETS_KEY = 'appearance_message_banner_css_presets_v1';

const readPresets = (raw: unknown): MessageBannerPreset[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is MessageBannerPreset => {
    return !!item
      && typeof item === 'object'
      && typeof (item as MessageBannerPreset).name === 'string'
      && typeof (item as MessageBannerPreset).css === 'string';
  }).map(item => ({
    name: item.name.trim(),
    css: item.css,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
  })).filter(item => item.name && item.css.trim());
};

/**
 * 内部消息横幅的 CSS 编辑器。
 *
 * 选择器和变量刻意兼容糯叽机：从糯叽机复制 `.ios-notification-*`、
 * `.banner-*` 和 `--nuo-notif-*` 后可以直接粘贴/导入，不需要改名。
 */
const MessageBannerCssEditor: React.FC<Props> = ({ value, onChange }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [presets, setPresets] = useState<MessageBannerPreset[]>([]);

  useEffect(() => {
    let alive = true;
    void DB.getAssetRaw(MESSAGE_BANNER_PRESETS_KEY)
      .then(raw => { if (alive) setPresets(readPresets(raw)); })
      .catch(() => { /* 旧浏览器/无 IndexedDB 时仍可正常编辑 CSS */ });
    return () => { alive = false; };
  }, []);

  const persistPresets = async (next: MessageBannerPreset[]) => {
    setPresets(next);
    try {
      await DB.saveAssetRaw(MESSAGE_BANNER_PRESETS_KEY, next);
    } catch {
      window.alert('样式已暂时应用，但保存预设失败。请检查浏览器存储空间后重试。');
    }
  };

  const savePreset = () => {
    if (!value.trim()) {
      window.alert('请先导入或编辑一份 CSS，再保存预设。');
      return;
    }
    const name = window.prompt('给这份通知栏样式起个名字：', `样式 ${presets.length + 1}`)?.trim();
    if (!name) return;
    const next: MessageBannerPreset[] = [
      ...presets.filter(preset => preset.name !== name),
      { name, css: value, updatedAt: Date.now() },
    ];
    void persistPresets(next);
  };

  const deletePreset = (name: string) => {
    if (!window.confirm(`删除“${name}”预设？`)) return;
    void persistPresets(presets.filter(preset => preset.name !== name));
  };

  const importCss = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const css = (await file.text()).replace(/^\uFEFF/, '');
      if (!css.trim()) {
        window.alert('CSS 文件内容为空。');
        return;
      }
      onChange(css);
    } catch {
      window.alert('CSS 导入失败，请确认文件可以正常读取。');
    } finally {
      event.target.value = '';
    }
  };

  const exportCss = () => {
    if (!value.trim()) {
      window.alert('当前没有可导出的 CSS。');
      return;
    }
    const blob = new Blob([value], { type: 'text/css;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'sullyos-message-banner.css';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-slate-500">
          CSS 代码 <span className="font-normal text-slate-400">· 糯叽机格式兼容</span>
        </div>
        <div className="flex items-center gap-1">
          <input ref={fileRef} type="file" accept=".css,.txt,text/css,text/plain" className="hidden" onChange={importCss} />
          <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50">导入 CSS</button>
          <button type="button" onClick={exportCss} disabled={!value.trim()} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${value.trim() ? 'text-indigo-500 hover:bg-indigo-50' : 'text-slate-300'}`}>导出 CSS</button>
          <button type="button" onClick={() => onChange(DEFAULT_MESSAGE_BANNER_CSS)} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-violet-500 hover:bg-violet-50">示例</button>
          {value && <button type="button" onClick={() => onChange('')} className="rounded-lg px-2 py-1 text-[10px] font-semibold text-rose-400 hover:bg-rose-50">清空</button>}
        </div>
      </div>
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-bold text-indigo-700">我的样式预设 <span className="font-normal text-indigo-400">· 保存后可一键切换</span></div>
          <button type="button" onClick={savePreset} disabled={!value.trim()} className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold ${value.trim() ? 'bg-indigo-500 text-white hover:bg-indigo-600' : 'bg-slate-200 text-slate-400'}`}>保存当前样式</button>
        </div>
        {presets.length ? (
          <div className="flex flex-wrap gap-2">
            {presets.map(preset => (
              <div key={preset.name} className="flex items-center overflow-hidden rounded-xl border border-indigo-100 bg-white shadow-sm">
                <button type="button" onClick={() => onChange(preset.css)} title={`载入 ${preset.name}`} className="max-w-[170px] truncate px-2.5 py-1.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-50">{preset.name}</button>
                <button type="button" onClick={() => deletePreset(preset.name)} aria-label={`删除 ${preset.name}`} className="border-l border-indigo-100 px-1.5 py-1.5 text-[10px] text-slate-400 hover:bg-rose-50 hover:text-rose-500">×</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-indigo-400">还没有保存的样式。导入 CSS 后点击“保存当前样式”即可。</div>
        )}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={'可直接粘贴糯叽机的通知栏 CSS\n例如：.ios-notification-banner { ... }\n或设置 --nuo-notif-bg / --nuo-notif-radius 等变量'}
        spellCheck={false}
        rows={12}
        className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-200 outline-none focus:border-primary/50 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      />
      <div className="text-[10px] leading-relaxed text-slate-400">
        支持糯叽机原样选择器：<code className="rounded bg-slate-100 px-1 text-slate-500">.ios-notification-container</code>、<code className="rounded bg-slate-100 px-1 text-slate-500">.ios-notification-banner</code>、<code className="rounded bg-slate-100 px-1 text-slate-500">.banner-avatar / .banner-title / .banner-time / .banner-message</code>。
        也支持 <code className="rounded bg-slate-100 px-1 text-slate-500">--nuo-notif-*</code> 变量和装饰层。
      </div>
      <div className="rounded-2xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-[10px] leading-relaxed text-violet-600">
        这里的 CSS 只用于 APP 内部消息横幅；后台/彻底退出 APP 时的系统通知仍由系统通知样式控制。改完后无需更新 Worker，刷新前端页面即可预览。
      </div>
    </div>
  );
};

export default MessageBannerCssEditor;
