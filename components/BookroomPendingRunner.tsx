/**
 * 书房「等回复」的后台跑腿：小手机开着时，隔几分钟（以及切回前台时）看一眼队列，
 * 角色按日程有空了就补上 ta 欠的回复（utils/bookroom/pendingReplies.ts）。不渲染任何东西。
 * 挂在 App 根部 OSProvider 里面，不管书房开没开都在跑。
 */
import React, { useEffect, useRef } from 'react';
import { useOS } from '../context/OSContext';
import { processPendingReplies, type PendingContext } from '../utils/bookroom/pendingReplies';

const INTERVAL_MS = 3 * 60 * 1000;
const FIRST_DELAY_MS = 15 * 1000;
export const BOOKROOM_UPDATED_EVENT = 'bookroom-updated';
/** 书房里刚记了一笔「等回复」时发这个，跑腿会马上看一眼（万一日程刚好换了时段） */
export const BOOKROOM_PENDING_ADDED_EVENT = 'bookroom-pending-added';

let running = false;

const BookroomPendingRunner: React.FC = () => {
    const { characters, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig, addToast } = useOS();
    const ctxRef = useRef<PendingContext>({ characters, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig });
    ctxRef.current = { characters, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig };
    const toastRef = useRef(addToast);
    toastRef.current = addToast;

    useEffect(() => {
        const run = async () => {
            if (running || document.visibilityState === 'hidden') return;
            running = true;
            const work = async () => {
                const done = await processPendingReplies(ctxRef.current);
                if (!done.length) return;
                window.dispatchEvent(new CustomEvent(BOOKROOM_UPDATED_EVENT));
                for (const d of done) {
                    toastRef.current(`${d.charName} 忙完了，回了你在《${d.bookTitle}》${d.kind === 'review' ? '的书评' : '划的那句'}`, 'success');
                }
            };
            try {
                // 开着好几个页面时只让一个去补，免得同一条回两遍
                const locks = (navigator as any).locks;
                if (locks?.request) await locks.request('bookroom-pending-replies', { ifAvailable: true }, async (lock: unknown) => { if (lock) await work(); });
                else await work();
            } catch (e) {
                console.warn('[Bookroom] 补回复失败', e);
            } finally {
                running = false;
            }
        };
        const first = setTimeout(() => void run(), FIRST_DELAY_MS);
        const timer = setInterval(() => void run(), INTERVAL_MS);
        const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
        const onAdded = () => void run();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener(BOOKROOM_PENDING_ADDED_EVENT, onAdded);
        return () => {
            clearTimeout(first); clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener(BOOKROOM_PENDING_ADDED_EVENT, onAdded);
        };
    }, []);

    return null;
};

export default BookroomPendingRunner;
