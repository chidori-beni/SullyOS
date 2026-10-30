// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { elementToText, getMessageCopyText, htmlSourceToText } from './messageCopyText';
import type { Message } from '../types';

const msg = (over: Partial<Message>): Message => ({
    id: 1, charId: 'c', role: 'assistant', type: 'text', content: '', timestamp: 0, ...over,
});

describe('messageCopyText', () => {
    it('文字消息直接用 content', () => {
        expect(getMessageCopyText(msg({ content: '你好\n在吗' }))).toBe('你好\n在吗');
    });

    it('图片、表情包没有可复制的字', () => {
        expect(getMessageCopyText(msg({ type: 'image', content: 'data:xx' }))).toBe('');
        expect(getMessageCopyText(msg({ type: 'emoji', content: 'x' }))).toBe('');
    });

    it('HTML 卡片从源码取字，跳过样式和脚本，块级元素分行', () => {
        const html = '<style>.a{color:red}</style><div><h3>今日菜单</h3><p>番茄<b>炒蛋</b></p><p>米饭<br>两碗</p></div><script>x()</script>';
        expect(htmlSourceToText(html)).toBe('今日菜单\n番茄炒蛋\n米饭\n两碗');
        expect(getMessageCopyText(msg({ type: 'html_card', metadata: { htmlSource: html } }))).toBe('今日菜单\n番茄炒蛋\n米饭\n两碗');
    });

    it('页面上的卡片：只取 data-copy-root 里的字，跳过按钮和隐藏元素', () => {
        const el = document.createElement('div');
        el.innerHTML = '<span>心象</span><div data-copy-root=""><div>外卖订单</div><div>麦辣鸡腿堡 <span>×1</span></div><button>复制</button><div style="display:none">隐藏</div></div>';
        document.body.appendChild(el);
        expect(elementToText(el)).toBe('外卖订单\n麦辣鸡腿堡 ×1');
        expect(getMessageCopyText(msg({ type: 'mcd_card' }), el)).toBe('外卖订单\n麦辣鸡腿堡 ×1');
    });
});
