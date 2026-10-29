import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { BOOK_CINEMA_JA, describeCinemaUiStatus, formatBookCinemaText } from './bookCinemaLocale';
import { describeStatus, type CinemaStatus } from './cinema/cinema';
import type { UiLocale } from './uiLocale';
import { ShelfView, FriendsView } from '../apps/bookroom/HomeTabs';
import { Stars, SubTabs } from '../apps/bookroom/shared';
import { WaitingLine } from '../apps/bookroom/BookParts';
import { ImportSheet } from '../apps/bookroom/sheets';
const state = vi.hoisted(() => ({ locale: 'zh-CN' as UiLocale }));
vi.mock('../context/UiLocaleContext', () => ({ useUiLocale: () => ({ locale: state.locale }) }));
const files = ['apps/BookroomApp.tsx','apps/CinemaApp.tsx','apps/bookroom/BookDetail.tsx','apps/bookroom/BookParts.tsx','apps/bookroom/CharacterShelf.tsx','apps/bookroom/Footprints.tsx','apps/bookroom/HomeTabs.tsx','apps/bookroom/shared.tsx','apps/bookroom/sheets.tsx','components/reader/NovelReader.tsx'];
it('provides complete fixed-copy translations and preserves parameter identity and unknown content', () => {
  expect(Object.keys(BOOK_CINEMA_JA).length).toBeGreaterThan(400);
  for (const [zh, ja] of Object.entries(BOOK_CINEMA_JA)) {
    expect(ja.trim()).not.toBe('');
    expect([...zh.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort()).toEqual([...ja.matchAll(/\{\d+\}/g)].map(x=>x[0]).sort());
    expect(formatBookCinemaText('zh-CN', zh)).toBe(zh);
    expect(formatBookCinemaText('ja-JP', zh)).toBe(ja);
  }
  expect(formatBookCinemaText('ja-JP', '未知书名{0}')).toBe('未知书名{0}');
  expect(formatBookCinemaText('ja-JP', '__proto__')).toBe('__proto__');
  expect(formatBookCinemaText('ja-JP', '  {0} 正在看… ', '书架{1}')).toBe('  书架{1}が読んでいます… ');
});
it.each(['zh-CN','ja-JP'] as const)('renders real shelf/import/tabs/waiting panels in %s without actions', locale => {
  state.locale = locale; const noop = vi.fn();
  const t = (text: string) => formatBookCinemaText(locale, text);
  const shelf = renderToStaticMarkup(React.createElement(ShelfView, { books: [], characters: [], categories: [], loaded: true, onOpen: noop, onImport: noop }));
  expect(shelf).toContain(t('书架还空着。'));
  const friends = renderToStaticMarkup(React.createElement(FriendsView, { books: [], characters: [], onChar: noop }));
  expect(friends).toContain(t('还没有角色读过书架上的书。'));
  const tabs = renderToStaticMarkup(React.createElement(SubTabs, { tabs: [{id:'notes',label:'笔记'}], value:'notes', onChange:noop }));
  expect(tabs).toContain(t('笔记'));
  const stars = renderToStaticMarkup(React.createElement(Stars, { n: 4 }));
  expect(stars).toContain(formatBookCinemaText(locale, '{0} 星',4));
  const wait = { charName:'原角色{0}', since:1 } as React.ComponentProps<typeof WaitingLine>['w'];
  expect(renderToStaticMarkup(React.createElement(WaitingLine,{w:wait,what:'回你',onCancel:noop}))).toContain('原角色{0}');
  const props = { books: [], records: [], onClose: noop, onImported: noop, onError: noop } as unknown as React.ComponentProps<typeof ImportSheet>;
  const imported = renderToStaticMarkup(React.createElement(ImportSheet,props));
  expect(imported).toContain(t('导入一本书'));
  expect(noop).not.toHaveBeenCalled();
});
it('keeps Chinese playback status identical and never translates site titles', () => {
  for (const mode of ['local','site','share'] as const) for (const paused of [true,false]) {
    const status = { mode,paused,time:65,duration:120,site:'原站点{0}',sharing:paused } as CinemaStatus;
    expect(describeCinemaUiStatus(status,text=>formatBookCinemaText('zh-CN',text))).toBe(describeStatus(status));
    const ja = describeCinemaUiStatus(status,text=>formatBookCinemaText('ja-JP',text));
    expect(ja).not.toMatch(/播放中|电脑|暂停/);
    if(mode==='site')expect(ja).toContain('原站点{0}');
  }
});

// Canonicalize only display wrappers back to their Chinese source expressions.
const canonical = (n: ts.Node): unknown => {
  if(ts.isCallExpression(n) && n.expression.getText()==='uiText') {
    const [template,...args] = n.arguments;
    if(!ts.isStringLiteral(template))return canonical(template);
    if(!args.length)return ['str',template.text];
    const parts = template.text.split(/\{\d+\}/g), matches=[...template.text.matchAll(/\{(\d+)\}/g)];
    return ['tpl',parts[0],...matches.flatMap((m,i)=>[canonical(args[Number(m[1])]),parts[i+1]])];
  }
  if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return ['str',n.text];
  if(ts.isTemplateExpression(n))return ['tpl',n.head.text,...n.templateSpans.flatMap(s=>[canonical(s.expression),s.literal.text])];
  if(ts.isIdentifier(n)||ts.isNumericLiteral(n))return [n.kind,n.text];
  const children:unknown[]=[];ts.forEachChild(n,c=>{children.push(canonical(c));});return [n.kind,...children];
};
it('preserves original event handlers, stable values and API/database payloads', () => {
  for(const file of files){
    const actual=readFileSync(file,'utf8'), original=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'});
    const signatures=(text:string)=>{
      const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), results:unknown[]=[];
      const visit=(n:ts.Node)=>{
        if(ts.isJsxAttribute(n)&&(/^on[A-Z]/.test(n.name.getText(sf))||['value','checked','disabled','type','min','max','step','data-testid','aria-selected','aria-pressed'].includes(n.name.getText(sf))))results.push(canonical(n));
        if(ts.isCallExpression(n)&&/^(DB\.|askCharacter|safeFetchJson|saveCinemaSession|saveBookroom|deleteCinema|backfillSession|removeSessionFromChat|removeLinesFromChat|startStt|startAmsg)/.test(n.expression.getText(sf)))results.push(canonical(n));
        ts.forEachChild(n,visit);
      };visit(sf);return results;
    };
    expect(signatures(actual),file).toEqual(signatures(original));
    const sf=ts.createSourceFile(file,actual,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const visit=(n:ts.Node)=>{if(ts.isCallExpression(n)&&n.expression.getText(sf)==='uiText'&&n.arguments[0]&&ts.isStringLiteral(n.arguments[0]))expect(BOOK_CINEMA_JA[n.arguments[0].text.trim()],file+': '+n.arguments[0].text).toBeDefined();ts.forEachChild(n,visit);};visit(sf);
  }
});
