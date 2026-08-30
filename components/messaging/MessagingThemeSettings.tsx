import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    BUILT_IN_MESSAGING_THEMES,
    makeMessagingPresetId,
    MessagingThemePreset,
    MessagingThemeState,
    validateMessagingCss,
} from '../../utils/messagingTheme';

interface MessagingThemeSettingsProps {
    state: MessagingThemeState;
    onPreview: (css: string) => void;
    onPersist: (state: MessagingThemeState) => Promise<void>;
    onClose: () => void;
    notify: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const safeFileName = (name: string): string => (
    (name || 'theme').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'theme'
);

const MessagingThemeSettings: React.FC<MessagingThemeSettingsProps> = ({ state, onPreview, onPersist, onClose, notify }) => {
    const [draftCss, setDraftCss] = useState(state.css);
    const [activePresetId, setActivePresetId] = useState<string | null>(state.activePresetId);
    const [presets, setPresets] = useState<MessagingThemePreset[]>(state.presets);
    const [saving, setSaving] = useState(false);
    const [showReference, setShowReference] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const activePreset = useMemo(() => presets.find(item => item.id === activePresetId) || null, [activePresetId, presets]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            const result = validateMessagingCss(draftCss);
            if (result.valid) onPreview(draftCss);
        }, 250);
        return () => window.clearTimeout(timer);
    }, [draftCss, onPreview]);

    const persist = async (next: MessagingThemeState, successMessage: string) => {
        setSaving(true);
        try {
            await onPersist(next);
            setPresets(next.presets);
            setActivePresetId(next.activePresetId);
            setDraftCss(next.css);
            onPreview(next.css);
            notify(successMessage, 'success');
        } catch (error: any) {
            notify(error?.message || '保存失败，请稍后重试。', 'error');
        } finally {
            setSaving(false);
        }
    };

    const saveAndApply = async () => {
        const validation = validateMessagingCss(draftCss);
        if (!validation.valid) return notify(validation.error, 'error');
        const now = Date.now();
        const nextPresets = activePreset
            ? presets.map(item => item.id === activePreset.id ? { ...item, css: draftCss, updatedAt: now } : item)
            : presets;
        await persist({ version: 1, css: draftCss, activePresetId, presets: nextPresets }, '好友列表美化已保存并应用');
    };

    const saveAsPreset = async () => {
        const css = draftCss.trim();
        if (!css) return notify('请先写入或导入 CSS。', 'info');
        const validation = validateMessagingCss(css);
        if (!validation.valid) return notify(validation.error, 'error');
        const name = window.prompt('给这套预设起个名字', activePreset?.name || '我的好友列表');
        if (name === null) return;
        const now = Date.now();
        const preset: MessagingThemePreset = {
            id: makeMessagingPresetId(),
            name: name.trim() || '未命名预设',
            css,
            createdAt: now,
            updatedAt: now,
        };
        await persist({ version: 1, css, activePresetId: preset.id, presets: [...presets, preset] }, '已保存为新预设');
    };

    const activatePreset = async (preset: MessagingThemePreset) => {
        await persist({ version: 1, css: preset.css, activePresetId: preset.id, presets }, `已切换到「${preset.name}」`);
    };

    const renamePreset = async (preset: MessagingThemePreset) => {
        const name = window.prompt('重命名预设', preset.name);
        if (name === null) return;
        const next = presets.map(item => item.id === preset.id ? { ...item, name: name.trim() || item.name, updatedAt: Date.now() } : item);
        await persist({ version: 1, css: draftCss, activePresetId, presets: next }, '预设已重命名');
    };

    const deletePreset = async (preset: MessagingThemePreset) => {
        if (!window.confirm(`删除预设「${preset.name}」？`)) return;
        const next = presets.filter(item => item.id !== preset.id);
        const deletingActive = preset.id === activePresetId;
        await persist({
            version: 1,
            css: deletingActive ? '' : draftCss,
            activePresetId: deletingActive ? null : activePresetId,
            presets: next,
        }, '预设已删除');
    };

    const exportPreset = (preset: MessagingThemePreset) => {
        const blob = new Blob([`/* ${preset.name} — SullyOS / 糯叽机消息 App 兼容主题 */\n\n${preset.css}`], { type: 'text/css;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${safeFileName(preset.name)}.css`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 500);
    };

    const importCss = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            const css = (await file.text()).trim();
            if (!css) return notify('导入的 CSS 是空的。', 'error');
            const validation = validateMessagingCss(css);
            if (!validation.valid) return notify(validation.error, 'error');
            const fallbackName = file.name.replace(/\.(css|txt)$/i, '').replace(/^nuojiji_messaging_theme_/i, '') || '导入主题';
            const name = window.prompt('导入后保存为预设', fallbackName);
            if (name === null) return;
            const now = Date.now();
            const preset: MessagingThemePreset = {
                id: makeMessagingPresetId(),
                name: name.trim() || fallbackName,
                css,
                createdAt: now,
                updatedAt: now,
            };
            await persist({ version: 1, css, activePresetId: preset.id, presets: [...presets, preset] }, 'CSS 已导入、保存并应用');
        } catch (error: any) {
            notify(`导入失败：${error?.message || error}`, 'error');
        }
    };

    const clearTheme = async () => {
        if (!draftCss && !activePresetId) return;
        if (!window.confirm('清空当前好友列表美化？已保存的其他预设不会删除。')) return;
        await persist({ version: 1, css: '', activePresetId: null, presets }, '已恢复默认好友列表');
    };

    return (
        <div className="sully-msg-theme-layer" role="dialog" aria-modal="true" aria-label="好友列表美化">
            <button type="button" className="sully-msg-theme-mask" aria-label="关闭美化设置" onClick={onClose} />
            <section className="sully-msg-theme-sheet">
                <div className="sully-msg-theme-handle" />
                <header className="sully-msg-theme-header">
                    <button type="button" onClick={onClose}>取消</button>
                    <div><strong>好友列表美化</strong><span>糯叽机消息 App CSS 兼容</span></div>
                    <button type="button" disabled={saving} onClick={saveAndApply}>保存</button>
                </header>

                <div className="sully-msg-theme-scroll">
                    <section className="sully-msg-theme-section">
                        <div className="sully-msg-theme-section-title"><span>内建模板</span><small>点一下立即预览</small></div>
                        <div className="sully-msg-theme-chips">
                            {BUILT_IN_MESSAGING_THEMES.map(template => (
                                <button key={template.id} type="button" onClick={() => { setDraftCss(template.css); setActivePresetId(null); }}>
                                    {template.name}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="sully-msg-theme-section">
                        <div className="sully-msg-theme-section-title">
                            <span>我的预设</span>
                            <div className="sully-msg-theme-inline-actions">
                                <button type="button" onClick={() => fileRef.current?.click()}>导入 CSS</button>
                                <button type="button" onClick={saveAsPreset}>保存为预设</button>
                            </div>
                        </div>
                        <input ref={fileRef} type="file" accept=".css,.txt,text/css,text/plain" hidden onChange={importCss} />
                        {presets.length === 0 ? (
                            <p className="sully-msg-theme-empty">还没有预设。可直接导入你已有的糯叽机 CSS。</p>
                        ) : (
                            <div className="sully-msg-theme-presets">
                                {presets.map(preset => {
                                    const active = preset.id === activePresetId;
                                    return (
                                        <div key={preset.id} className={active ? 'is-active' : ''}>
                                            <button type="button" onClick={() => activatePreset(preset)}>{active ? '✓ ' : ''}{preset.name}</button>
                                            <button type="button" aria-label={`重命名 ${preset.name}`} onClick={() => renamePreset(preset)}>✎</button>
                                            <button type="button" aria-label={`导出 ${preset.name}`} onClick={() => exportPreset(preset)}>⇩</button>
                                            <button type="button" aria-label={`删除 ${preset.name}`} onClick={() => deletePreset(preset)}>×</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className="sully-msg-theme-section">
                        <div className="sully-msg-theme-section-title"><span>自定义 CSS</span><small>输入后 250ms 即时预览</small></div>
                        <textarea
                            value={draftCss}
                            onChange={event => setDraftCss(event.target.value)}
                            spellCheck={false}
                            placeholder={'#messaging-chat-tab {\n  --nj-msg-bg: #fffaf3;\n}\n\n.nj-chat-item { border-radius: 16px; }'}
                        />
                        <p className="sully-msg-theme-hint">支持糯叽机原版 <code>#messaging-*-tab</code>、<code>.nj-*</code> 与 74 个变量；四个 tab 会一起换肤，聊天详情页不受影响。</p>
                    </section>

                    <section className="sully-msg-theme-section sully-msg-theme-reference">
                        <button type="button" className="sully-msg-theme-reference-toggle" onClick={() => setShowReference(value => !value)}>
                            <span>选择器与变量速查</span><b>{showReference ? '收起' : '展开'}</b>
                        </button>
                        {showReference && (
                            <div className="sully-msg-theme-reference-body">
                                <p><code>#messaging-chat-tab</code> 聊天列表 · <code>.nj-chat-item</code> 单项 · <code>.nj-chat-item-avatar</code> 头像</p>
                                <p><code>#messaging-moments-tab</code> 朋友圈 · <code>.nj-moments-post</code> 动态</p>
                                <p><code>#messaging-profile-tab</code> 个人主页 · <code>#messaging-favorites-tab</code> 收藏</p>
                                <p><code>#messaging-bottom-bar</code> / <code>.nj-tab-bottom-bar</code> 底栏</p>
                                <p>常用变量：<code>--nj-msg-bg</code>、<code>--nj-msg-card-bg</code>、<code>--nj-msg-text</code>、<code>--nj-msg-avatar-radius</code>、<code>--nj-msg-tabbar-bg</code>。</p>
                            </div>
                        )}
                    </section>
                </div>

                <footer className="sully-msg-theme-footer">
                    <button type="button" onClick={clearTheme} disabled={saving || (!draftCss && !activePresetId)}>清空当前美化</button>
                    <button type="button" onClick={saveAndApply} disabled={saving}>{saving ? '保存中…' : '保存并应用'}</button>
                </footer>
            </section>
        </div>
    );
};

export default MessagingThemeSettings;
