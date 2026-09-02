import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chatDetailLaunch } from './chatDetailLaunch';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('chatDetailLaunch', () => {
  it('意图只消费一次', () => {
    chatDetailLaunch.request({ charId: 'char-1', clearUnread: true });
    expect(chatDetailLaunch.peek()).toEqual({ charId: 'char-1', clearUnread: true });
    expect(chatDetailLaunch.consume()).toEqual({ charId: 'char-1', clearUnread: true });
    expect(chatDetailLaunch.consume()).toBeNull();
  });

  it('没有 charId 的请求直接忽略，不会污染下一次正常打开消息 App', () => {
    chatDetailLaunch.consume();
    chatDetailLaunch.request({ charId: '' });
    expect(chatDetailLaunch.peek()).toBeNull();
  });

  it('Messaging 已经挂载时靠事件即时切换', () => {
    // 默认测试环境没有 window（意图只走 pending），这里补一个最小事件总线
    // 来验证「消息 App 已经开着」那条路径。
    (globalThis as any).window = new EventTarget();
    chatDetailLaunch.consume();
    const seen: string[] = [];
    const unsubscribe = chatDetailLaunch.subscribe(intent => seen.push(intent.charId));
    chatDetailLaunch.request({ charId: 'char-2' });
    unsubscribe();
    chatDetailLaunch.request({ charId: 'char-3' });
    chatDetailLaunch.consume();
    delete (globalThis as any).window;
    expect(seen).toEqual(['char-2']);
  });
});

/**
 * 「点进去就该是这段对话」的入口全靠源码级接线：AppID.Chat 挂的是 Messaging，
 * 它内部的 view 每次挂载都从 'list' 起步，所以任何只调 openApp(AppID.Chat) 的
 * 入口都会把用户丢到好友列表。这类回归改别处时特别容易复发，钉在这里。
 */
describe('单聊直达接线', () => {
  it('Messaging 挂载时消费意图并进详情页', () => {
    const messaging = read('../apps/Messaging.tsx');
    expect(messaging).toContain('chatDetailLaunch.peek()');
    expect(messaging).toContain('chatDetailLaunch.subscribe(applyLaunchIntent)');
    expect(messaging).toContain('chatDetailLaunch.consume()');
  });

  it('推送横幅 / 桌面预览卡走的 active-msg-open 会带上意图', () => {
    expect(read('../context/OSContext.tsx')).toContain('chatDetailLaunch.request({ charId, clearUnread: true })');
  });

  it('三套桌面的消息预览卡都直达对话', () => {
    expect(read('../apps/Launcher.tsx')).toContain('chatDetailLaunch.request({ charId: widgetChar.id');
    expect(read('../components/os/MobileGameHome.tsx')).toContain('chatDetailLaunch.request({ charId: widgetChar.id');
    expect(read('../components/os/CompanionHome.tsx')).toContain('chatDetailLaunch.request({ charId: character.id');
  });

  it('通话记录卡片返回时回到同一段对话', () => {
    expect(read('../apps/CallApp.tsx')).toContain('chatDetailLaunch.request({ charId: selectedCharId })');
  });

  it('见面完结卡片声明返回目标，退出时回到同一段对话', () => {
    expect(read('../apps/Chat.tsx')).toContain("openHistory: true, returnTo: 'chat'");
    const dateApp = read('../apps/DateApp.tsx');
    expect(dateApp).toContain("setCameFromChat(intent.returnTo === 'chat')");
    expect(dateApp).toContain('chatDetailLaunch.request({ charId: backToCharId })');
    expect(dateApp).toContain('else if (cameFromChat) returnToChat();');
  });
});
