import React, { useRef } from 'react';
import { DEFAULT_MESSAGE_BANNER_CSS } from '../../utils/messageBannerCss';

interface Props {
  value: string;
  onChange: (css: string) => void;
}

/**
 * 内部消息横幅的 CSS 编辑器。
 *
 * 选择器和变量刻意兼容糯叽机：从糯叽机复制 `.ios-notification-*`、
 * `.banner-*` 和 `--nuo-notif-*` 后可以直接粘贴/导入，不需要改名。
 */
const MessageBannerCssEditor: React.FC<Props> = ({ value, onChange }) => {
  const fileRef = useRef<HTMLInputElement>(null);

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
