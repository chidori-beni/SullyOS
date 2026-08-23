import React, { lazy } from 'react';

export type PreloadableLazy = React.LazyExoticComponent<React.ComponentType<any>> & {
  preload: () => Promise<unknown>;
};

const SPECULATIVE_RETRY_DELAY_MS = 180;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 空闲预热和用户点击可能正好撞在 PWA 恢复/来电音频解码的瞬间。对一次短暂网络失败
 * 立即补一次，避免 Safari 把一次瞬断直接升级成整页 App Crash；真正的 404/旧 hash
 * 仍会在第二次失败后交给 AppErrorBoundary 的整页刷新护栏。
 */
const loadWithTransientRetry = async <T,>(factory: () => Promise<T>): Promise<T> => {
  try {
    return await factory();
  } catch (firstError) {
    await wait(SPECULATIVE_RETRY_DELAY_MS);
    try {
      return await factory();
    } catch {
      throw firstError;
    }
  }
};

/**
 * React.lazy with an explicit, retryable preload hook.
 *
 * Keep the module promise outside React's private lazy payload. A speculative
 * preload that fails can then be retried when the user actually opens the App,
 * instead of leaving React.lazy permanently rejected or pending.
 */
export const createPreloadableLazy = (
  factory: () => Promise<{ default: React.ComponentType<any> }>,
): PreloadableLazy => {
  let request: Promise<{ default: React.ComponentType<any> }> | null = null;

  const load = () => {
    if (!request) {
      const nextRequest = loadWithTransientRetry(factory);
      request = nextRequest;
      void nextRequest.catch(() => {
        if (request === nextRequest) request = null;
      });
    }
    return request;
  };

  const Component = lazy(load) as PreloadableLazy;
  Component.preload = load;
  return Component;
};
