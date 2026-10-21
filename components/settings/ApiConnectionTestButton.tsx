import React, { useEffect, useRef, useState } from 'react';
import { testApiConnection, type ApiConnectionResult, type ApiConnectionTarget } from '../../utils/apiConnectionTest';

/**
 * 就地「测试连接」：聊天设置、通话、见面里都能直接测当前在用的 API，不用退回设置页。
 * tone="dark" 用 text-white/xx 这类类名，通话浅色主题（callLightTheme.ts）会自动翻成墨色。
 */
export default function ApiConnectionTestButton({ api, label = '测试当前 API 连接', tone = 'light', className = '' }: {
  api: ApiConnectionTarget;
  label?: string;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ApiConnectionResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const identity = `${api.baseUrl}\n${api.apiKey}\n${api.model}`;

  // 换了 API 就把上一条的结果和没跑完的请求都扔掉，免得把旧结果当成新 API 的
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTesting(false);
    setResult(null);
  }, [identity]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setTesting(true);
    setResult(null);
    const next = await testApiConnection(api, controller.signal);
    if (controller.signal.aborted) return;
    abortRef.current = null;
    setTesting(false);
    setResult(next);
  };

  const disabled = testing || !api.baseUrl.trim() || !api.model.trim();
  const dark = tone === 'dark';
  return <div className={`space-y-1.5 ${className}`}>
    <button type="button" onClick={run} disabled={disabled}
      className={`w-full rounded-xl border py-2 text-xs font-bold transition active:scale-[0.98] disabled:opacity-40 ${dark
        ? 'border-white/15 bg-white/[0.04] text-white/80'
        : 'border-primary/30 bg-white/70 text-primary'}`}>
      {testing ? '测试中…' : label}
    </button>
    {result && <p role="status" className={`break-words text-[11px] leading-relaxed ${result.ok
      ? (dark ? 'text-emerald-300' : 'text-emerald-600')
      : (dark ? 'text-rose-300' : 'text-red-500')}`}>
      {result.ok ? '✓ 连接成功' : '✕ 连接失败'}
      {result.ms > 0 && ` · ${(result.ms / 1000).toFixed(1)} 秒`}
      {api.model && ` · ${api.model}`}
      <br />{result.message}
    </p>}
  </div>;
}
