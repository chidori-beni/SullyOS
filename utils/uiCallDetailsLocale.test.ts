import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { UI_MESSAGES, translateUi, type UiLocale, type UiMessageKey, type UiMessageParams } from './uiLocale';
import { formatCallDetailText } from './callDetailLocale';
import Camera from '../components/call/UserCameraModePicker';
import Guide from '../components/call/CallSetupGuide';
import Presets from '../components/call/CallApiPresetSheet';
import Announcement from '../components/call/CallUpdateAnnouncement';
const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ t: (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params) }) }));
vi.mock('@phosphor-icons/react', () => Object.fromEntries('ArrowLeft ArrowRight Check Cube FileZip FolderOpen Gear ImageSquare X ChatCircleDots Phone SpeakerHigh'.split(' ').map(name => [name, () => null])));
const t = (key: UiMessageKey, params?: UiMessageParams) => translateUi(state.locale, key, params);
const noop = vi.fn();
it.each(['zh-CN', 'ja-JP'] as const)('renders camera privacy/modes, both guide steps, API and announcement in %s', locale => {
 state.locale = locale; noop.mockClear();
 const shared = { accentColor: '#334455', lightTheme: false, onClose: noop };
 const camera = renderToStaticMarkup(React.createElement(Camera, { ...shared, mode: 'off', hasFakeImage: false, onSelect: noop, onChooseFakeImage: noop, onRemoveFakeImage: noop }));
 for(const label of ['假摄像头','本地情绪','每轮快照']) expect(camera).toContain(formatCallDetailText(t, label));
 expect(camera).toContain('aria-modal="true"');
 const guideProps: React.ComponentProps<typeof Guide> = { ...shared, step: 'model', characterName: '角色{name}', modelName: '原模型{count}', avatarSource: 'model', hasDatePortraits: false, cameraMode: 'off', hasFakeImage: false, onStepChange: noop, onChooseModelFile: noop, onChooseLive2DFolder: noop, onChooseAvatarSource: noop, onChooseStaticImage: noop, onManageDatePortraits: noop, onCameraModeChange: noop, onChooseFakeImage: noop, onStart: noop };
 const model = renderToStaticMarkup(React.createElement(Guide, guideProps));
 expect(model).toContain('原模型{count}');
 expect(model).toContain(formatCallDetailText(t, '动态模型'));
 const guideCamera = renderToStaticMarkup(React.createElement(Guide, { ...guideProps, step: 'camera', cameraMode: 'fake', hasFakeImage: true }));
 expect(guideCamera).toContain(formatCallDetailText(t, '图片不发送'));
 const missingImage = renderToStaticMarkup(React.createElement(Guide, { ...guideProps, step: 'camera', cameraMode: 'fake', hasFakeImage: false }));
 expect(missingImage).toContain('disabled=""');
 const presets = renderToStaticMarkup(React.createElement(Presets, { ...shared, apiPresets: [], apiConfig: { baseUrl: 'https://example.invalid', apiKey: 'fake-not-real', model: '原模型{model}' }, onApply: noop }));
 expect(presets).toContain('原模型{model}');
 expect(presets).toContain(formatCallDetailText(t, '还没有保存过 API 预设。'));
 const announcement = renderToStaticMarkup(React.createElement(Announcement, { accentColor: '#334455', onDismiss: noop, onOpenSettings: noop }));
 expect(announcement).toContain(formatCallDetailText(t, '通话偏好现在有三项'));
 expect(noop).not.toHaveBeenCalled();
});
it('preserves all events, stable values, privacy/permission gates and main call lifecycle', () => {
 for(const file of ['apps/CallApp.tsx','components/call/UserCameraModePicker.tsx','components/call/CallSetupGuide.tsx','components/call/CallApiPresetSheet.tsx','components/call/CallUpdateAnnouncement.tsx']) {
  const actual = readFileSync(file,'utf8'), original = execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'});
  const attrs = (text: string) => {
   const sf = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), result:string[]=[];
   const visit=(node:ts.Node)=>{if(ts.isJsxAttribute(node)&&(/^on[A-Z]/.test(node.name.getText(sf))||['value','disabled','checked','aria-checked','type','data-testid','min','max'].includes(node.name.getText(sf)))) result.push(node.getText(sf).replace(/\r/g,'')); ts.forEachChild(node,visit);};visit(sf);return result;
  }; expect(attrs(actual)).toEqual(attrs(original));
  const sf=ts.createSourceFile(file,actual,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(sf)==='uiT'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){const key=node.arguments[0].text as UiMessageKey;expect(UI_MESSAGES['zh-CN'][key]).toBeDefined();expect(UI_MESSAGES['ja-JP'][key]).toBeDefined();}ts.forEachChild(node,visit);};visit(sf);
 }
});
it('keeps unknown labels, raw names, model IDs and interpolation text literal', () => {
 state.locale='ja-JP';
 for(const value of ['原名字{count}','model/raw-id','__proto__','constructor','[图片]']) expect(formatCallDetailText(t,value)).toBe(value);
 expect(translateUi('ja-JP','call.detail.deleteRecord',{name:'原名字{name}'})).toContain('原名字{name}');
 expect(translateUi('ja-JP','call.detail.manualApi',{model:'（raw/model{model}）'})).toContain('（raw/model{model}）');
 const camera=readFileSync('components/call/UserCameraModePicker.tsx','utf8');
 for(const id of ['off','fake','emotion','snapshot']) expect(camera).toContain(`id: '${id}'`);
});
