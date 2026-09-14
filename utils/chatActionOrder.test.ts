import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CHAT_ACTION_ORDER_STORAGE_KEY,
    DEFAULT_CHAT_ACTION_ORDER,
    loadChatActionOrder,
    moveChatAction,
    normalizeChatActionOrder,
    saveChatActionOrder,
} from './chatActionOrder';

beforeEach(() => localStorage.clear());

describe('聊天加号菜单顺序', () => {
    it('没有保存值或保存值损坏时使用默认顺序', () => {
        expect(loadChatActionOrder()).toEqual(DEFAULT_CHAT_ACTION_ORDER);
        localStorage.setItem(CHAT_ACTION_ORDER_STORAGE_KEY, '{bad json');
        expect(loadChatActionOrder()).toEqual(DEFAULT_CHAT_ACTION_ORDER);
        localStorage.setItem(CHAT_ACTION_ORDER_STORAGE_KEY, JSON.stringify({ order: [] }));
        expect(loadChatActionOrder()).toEqual(DEFAULT_CHAT_ACTION_ORDER);
    });

    it('过滤未知和重复项，并把缺失动作按默认顺序补到末尾', () => {
        const value = normalizeChatActionOrder(['favorites', 'not-real', 'favorites', 'image']);
        expect(value.slice(0, 2)).toEqual(['favorites', 'image']);
        expect(value).toEqual([
            'favorites',
            'image',
            ...DEFAULT_CHAT_ACTION_ORDER.filter(id => id !== 'favorites' && id !== 'image'),
        ]);
    });

    it('移动只交换相邻项，不修改原数组，越界时保持不变', () => {
        const original = [...DEFAULT_CHAT_ACTION_ORDER];
        const moved = moveChatAction(original, 'favorites', -1);
        expect(original).toEqual(DEFAULT_CHAT_ACTION_ORDER);
        expect(moved[moved.length - 2]).toBe('favorites');
        expect(moved[moved.length - 1]).toBe('memory-link');
        expect(moveChatAction(original, 'collaboration', -1)).toEqual(original);
        expect(moveChatAction(original, 'favorites', 1)).toEqual(original);
    });

    it('保存后可读回归一化后的顺序', () => {
        saveChatActionOrder(['schedule', 'schedule', 'unknown'] as any);
        expect(JSON.parse(localStorage.getItem(CHAT_ACTION_ORDER_STORAGE_KEY)!)).toEqual([
            'schedule',
            ...DEFAULT_CHAT_ACTION_ORDER.filter(id => id !== 'schedule'),
        ]);
        expect(loadChatActionOrder()[0]).toBe('schedule');
    });

    it('localStorage 读写异常时不让聊天页崩溃', () => {
        const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('storage read failed');
        });
        expect(loadChatActionOrder()).toEqual(DEFAULT_CHAT_ACTION_ORDER);
        getItem.mockRestore();

        const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('storage write failed');
        });
        expect(() => saveChatActionOrder(DEFAULT_CHAT_ACTION_ORDER)).not.toThrow();
        setItem.mockRestore();
    });
});
