import React, { Component, ErrorInfo } from 'react';
import { isChunkLoadError, tryAutoReloadForChunkError } from '../../utils/chunkLoadRecovery';
import { trackEvent } from '../../utils/analytics';
import { INSTALLED_APPS, HIDDEN_APP_NAMES } from '../../constants';
import { AppID } from '../../types';
import { useUiLocale } from '../../context/UiLocaleContext';
import type { UiMessageKey, UiMessageParams } from '../../utils/uiLocale';

const ERROR_COPY_LABEL = 'error.copy';
const ERROR_COPIED_LABEL = 'error.copied';
const ERROR_MANUAL_COPY_LABEL = 'error.manual';
const ERROR_PROMPT_LABEL = 'error.prompt';
const ERROR_TITLE = 'error.title';
const ERROR_RETURN_LABEL = 'common.backToHome';
const CHUNK_ERROR_TITLE = 'error.chunk.title';
const CHUNK_ERROR_HINT = 'error.chunk.hint';
const CHUNK_ERROR_RELOADING = 'error.chunk.reloading';
const CHUNK_ERROR_RELOAD_LABEL = 'error.chunk.reload';

type AppErrorBoundaryProps = {
    children: React.ReactNode;
    onCloseApp: () => void;
    resetKey: string;
};

type LocalizedBoundaryProps = AppErrorBoundaryProps & {
    t: (key: UiMessageKey, params?: UiMessageParams) => string;
};

type AppErrorBoundaryState = {
    hasError: boolean;
    error: Error | null;
    copyLabel: UiMessageKey;
    /** 懒加载 chunk 失败 (iOS Safari "Importing a module script failed." 等) — 走刷新恢复 UI */
    isChunkError: boolean;
    /** 已发起自动整页刷新, 页面即将重载 */
    autoReloading: boolean;
};

class AppErrorBoundary extends Component<LocalizedBoundaryProps, AppErrorBoundaryState> {
    private copyLabelTimer: number | null = null;

    constructor(props: LocalizedBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            copyLabel: ERROR_COPY_LABEL,
            isChunkError: false,
            autoReloading: false,
        };
    }

    static getDerivedStateFromError(error: Error): Partial<AppErrorBoundaryState> {
        return { hasError: true, error, isChunkError: isChunkLoadError(error) };
    }

    /**
     * 当前是哪个 App 崩的。resetKey 形如 `${activeApp}:${角色id}` — 冒号后面那截是角色 id,
     * 一个字都不能上报, 这里只取前半段的 AppID, 再换成 constants 里写死的中文 App 名。
     * 名字查不到（比如桌面）就返回 undefined, 让这一项在事件里直接缺席。
     */
    private currentAppName(): string | undefined {
        const appId = this.props.resetKey.split(':')[0] as AppID;
        return INSTALLED_APPS.find(a => a.id === appId)?.name ?? HIDDEN_APP_NAMES[appId];
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('App Crash:', error, errorInfo);
        // 使用统计: 只报「哪个 App 崩了 + 是哪一类崩」。报错文本留在 console, 不进上报。
        const appName = this.currentAppName();
        trackEvent('触发 App 崩溃兜底页', {
            错误类型: isChunkLoadError(error) ? '资源加载失败' : '运行错误',
            ...(appName ? { 所在App: appName } : {}),
        });
        // chunk 加载失败: Safari 会把失败缓存进模块表, 同一 URL 本页内重试必失败,
        // 只有整页 reload 能恢复 — 自动刷一次 (冷却期内返回 false, 留给手动按钮)。
        if (isChunkLoadError(error) && tryAutoReloadForChunkError()) {
            trackEvent('自动刷新恢复资源加载失败', { 恢复方式: '已自动刷新' });
            this.setState({ autoReloading: true });
        } else if (isChunkLoadError(error)) {
            // 走到这里 = 是 chunk 错但没自动刷（冷却期内 / sessionStorage 不可用），页面还在。
            trackEvent('自动刷新恢复资源加载失败', { 恢复方式: '冷却期内不刷' });
        }
    }

    componentDidUpdate(prevProps: AppErrorBoundaryProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({
                hasError: false,
                error: null,
                copyLabel: ERROR_COPY_LABEL,
                isChunkError: false,
                autoReloading: false,
            });
        }
    }

    componentWillUnmount() {
        if (this.copyLabelTimer) {
            window.clearTimeout(this.copyLabelTimer);
        }
    }

    private updateCopyLabel = (label: UiMessageKey) => {
        if (this.copyLabelTimer) {
            window.clearTimeout(this.copyLabelTimer);
        }

        this.setState({ copyLabel: label });
        this.copyLabelTimer = window.setTimeout(() => {
            this.setState({ copyLabel: ERROR_COPY_LABEL });
            this.copyLabelTimer = null;
        }, 1800);
    };

    private handleCopy = async () => {
        const errText = this.state.error?.stack || this.state.error?.message || 'Unknown Error';

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(errText);
                this.updateCopyLabel(ERROR_COPIED_LABEL);
                // 只报走了哪条复制路径, 报错文本本身一个字都不发。
                trackEvent('复制报错信息', { 复制结果: '剪贴板成功' });
                return;
            }
        } catch {
            // Fall back to the hidden textarea path below.
        }

        try {
            const textarea = document.createElement('textarea');
            textarea.value = errText;
            textarea.setAttribute('readonly', 'true');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);

            if (copied) {
                this.updateCopyLabel(ERROR_COPIED_LABEL);
                trackEvent('复制报错信息', { 复制结果: 'execCommand 兜底成功' });
                return;
            }
        } catch {
            // Fall back to manual copy prompt.
        }

        window.prompt(this.props.t(ERROR_PROMPT_LABEL), errText);
        this.updateCopyLabel(ERROR_MANUAL_COPY_LABEL);
        trackEvent('复制报错信息', { 复制结果: '需手动复制' });
    };

    private handleClose = () => {
        trackEvent('从崩溃页返回桌面', {
            错误类型: this.state.isChunkError ? '资源加载失败' : '运行错误',
        });
        this.setState({
            hasError: false,
            error: null,
            copyLabel: ERROR_COPY_LABEL,
            isChunkError: false,
            autoReloading: false,
        });
        this.props.onCloseApp();
    };

    private handleReload = () => {
        trackEvent('点刷新重试（资源加载失败）');
        window.location.reload();
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        if (this.state.isChunkError) {
            return (
                <div className="relative isolate z-[120] w-full h-full flex flex-col items-center justify-center bg-slate-900/95 text-white p-6 text-center space-y-4 pointer-events-auto">
                    <img
                        src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f635.png"
                        alt="error"
                        className="w-10 h-10"
                    />
                    <h2 className="text-lg font-bold">{this.props.t(CHUNK_ERROR_TITLE)}</h2>
                    <p className="text-xs text-slate-300 max-w-xs leading-relaxed">
                        {this.props.t(CHUNK_ERROR_HINT)}
                    </p>
                    <p className="text-xs text-slate-300 font-mono bg-black/30 p-3 rounded-2xl max-w-full overflow-auto max-h-40 select-text break-all whitespace-pre-wrap">
                        {this.state.error?.message || 'Unknown Error'}
                    </p>
                    {this.state.autoReloading ? (
                        <p className="text-sm font-bold text-slate-200">{this.props.t(CHUNK_ERROR_RELOADING)}</p>
                    ) : (
                        <div className="flex flex-col gap-3 w-full max-w-xs">
                            <button
                                type="button"
                                onClick={this.handleReload}
                                className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                            >
                                {this.props.t(CHUNK_ERROR_RELOAD_LABEL)}
                            </button>
                            <button
                                type="button"
                                onClick={this.handleCopy}
                                className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
                            >
                                {this.props.t(this.state.copyLabel)}
                            </button>
                            <button
                                type="button"
                                onClick={this.handleClose}
                                className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
                            >
                                {this.props.t(ERROR_RETURN_LABEL)}
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="relative isolate z-[120] w-full h-full flex flex-col items-center justify-center bg-slate-900/95 text-white p-6 text-center space-y-4 pointer-events-auto">
                <img
                    src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f635.png"
                    alt="error"
                    className="w-10 h-10"
                />
                <h2 className="text-lg font-bold">{this.props.t(ERROR_TITLE)}</h2>
                <p className="text-xs text-slate-300 font-mono bg-black/30 p-3 rounded-2xl max-w-full overflow-auto max-h-40 select-text break-all whitespace-pre-wrap">
                    {this.state.error?.message || 'Unknown Error'}
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                    <button
                        type="button"
                        onClick={this.handleCopy}
                        className="w-full px-4 py-2 bg-slate-700 rounded-full text-xs font-bold active:scale-95 transition-transform"
                    >
                        {this.props.t(this.state.copyLabel)}
                    </button>
                    <button
                        type="button"
                        onClick={this.handleClose}
                        className="w-full px-6 py-3 bg-red-600 rounded-full font-bold text-sm shadow-lg active:scale-95 transition-transform"
                    >
                        {this.props.t(ERROR_RETURN_LABEL)}
                    </button>
                </div>
            </div>
        );
    }
}

const LocalizedAppErrorBoundary: React.FC<AppErrorBoundaryProps> = props => {
    const { t } = useUiLocale();
    return <AppErrorBoundary {...props} t={t} />;
};

export default LocalizedAppErrorBoundary;
