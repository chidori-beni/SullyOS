// ==UserScript==
// @name         Sully 影院 · 暂停同步
// @namespace    https://chidori-beni.github.io/SullyOS/
// @version      0.1.0
// @description  在 B站 / 腾讯视频 / 优酷 / 爱奇艺 看片时，把播放进度、暂停、第几集告诉手机上 Sully 影院里的角色。
// @author       SullyOS
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @match        *://www.bilibili.com/list/*
// @match        *://v.qq.com/x/cover/*
// @match        *://v.qq.com/x/page/*
// @match        *://v.youku.com/*
// @match        *://www.youku.com/*
// @match        *://www.iqiyi.com/*
// @match        https://chidori-beni.github.io/SullyOS/watch.html*
// @match        http://localhost/*watch.html*
// @match        http://localhost:*/*watch.html*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @connect      workers.dev
// @connect      *
// @noframes
// @run-at       document-idle
// @downloadURL  https://chidori-beni.github.io/SullyOS/watch/sully-cinema.user.js
// @updateURL    https://chidori-beni.github.io/SullyOS/watch/sully-cinema.user.js
// ==/UserScript==

/*
 * 这个脚本做两件事：
 *
 * 1. 在「观影端」网页（watch.html）上：把那一页记住的配对信息（Worker 地址 + 房间码 + 密钥）
 *    抄一份到油猴自己的存储里，别的网站上的这个脚本才知道往哪报。顺便在页面上留个记号，
 *    观影端据此显示「小插件已装好」。
 *
 * 2. 在视频网站上：找到正在放的那个 <video>，暂停 / 播放 / 拖进度时马上报一次，播放中每 15 秒报一次，
 *    POST 到 Worker 的 /watch-room/report，由放映室转给手机。
 *
 * 用 GM_xmlhttpRequest 而不是 fetch：视频网站的 CSP 可能不让页面连外面的地址，油猴的请求不受它管。
 * 不看、不传画面，只传进度、暂停、网页标题和地址。
 */
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const PAIR_KEY = 'sully-watch-pair';
  const TICK_MS = 15000;
  const MIN_GAP_MS = 1500;

  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const isWatchPage = /\/watch\.html/.test(location.pathname);

  // ───────── 观影端：抄配对信息 ─────────
  if (isWatchPage) {
    const sync = () => {
      let raw = null;
      try { raw = pageWindow.localStorage.getItem(PAIR_KEY); } catch (e) { /* ignore */ }
      const saved = GM_getValue(PAIR_KEY, null);
      if (raw && raw !== saved) GM_setValue(PAIR_KEY, raw);
      if (!raw && saved) GM_setValue(PAIR_KEY, null); // 观影端解除了配对
      document.documentElement.setAttribute('data-sully-userscript', VERSION);
      document.documentElement.setAttribute('data-sully-userscript-paired', raw ? '1' : '0');
    };
    sync();
    setInterval(sync, 2000);
    return;
  }

  // ───────── 视频网站：报进度 ─────────
  const SITES = [
    { re: /bilibili\.com$/, name: 'B站' },
    { re: /v\.qq\.com$/, name: '腾讯视频' },
    { re: /youku\.com$/, name: '优酷' },
    { re: /iqiyi\.com$/, name: '爱奇艺' },
  ];
  const site = (SITES.find(s => s.re.test(location.hostname)) || { name: location.hostname }).name;

  /** 网页标题去掉平台尾巴，剩下的一般就是「片名 第N集」。 */
  const cleanTitle = (raw) => String(raw || '')
    .replace(/[_\-|–—\s]*(哔哩哔哩|bilibili|腾讯视频|优酷|爱奇艺|高清完整正版视频在线观看|在线观看).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  const readPair = () => {
    try {
      const raw = GM_getValue(PAIR_KEY, null);
      const pair = raw ? JSON.parse(raw) : null;
      return pair && pair.workerUrl && pair.code && pair.secret ? pair : null;
    } catch (e) { return null; }
  };

  /** 页面上可能有好几个 video（广告、预览小窗）：挑时长最长、面积够大的那个。 */
  const pickVideo = () => {
    let best = null;
    let bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area < 200 * 100) continue;
      const dur = isFinite(v.duration) ? v.duration : 0;
      const score = dur * 1000 + area / 1000;
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  };

  let video = null;
  let lastSentAt = 0;
  let pending = null;
  let warnedNoPair = false;

  const send = (event) => {
    const pair = readPair();
    if (!pair) {
      if (!warnedNoPair) console.info('[Sully 影院] 还没拿到配对：先在这个浏览器里打开一次观影端网页（watch.html）并配对');
      warnedNoPair = true;
      return;
    }
    if (!video) return;
    const payload = {
      source: 'userscript',
      version: VERSION,
      event,
      site,
      title: cleanTitle(document.title),
      url: location.href.split('#')[0],
      time: isFinite(video.currentTime) ? Math.round(video.currentTime * 10) / 10 : undefined,
      duration: isFinite(video.duration) ? Math.round(video.duration) : undefined,
      paused: !!video.paused || !!video.ended,
      ended: !!video.ended,
    };
    lastSentAt = Date.now();
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${String(pair.workerUrl).replace(/\/+$/, '')}/watch-room/report`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ room: pair.code, secret: pair.secret, payload }),
      timeout: 10000,
      onload: (res) => {
        if (res.status >= 400) console.warn('[Sully 影院] 报进度失败', res.status, res.responseText);
      },
      onerror: (err) => console.warn('[Sully 影院] 连不上 Worker', err),
    });
  };

  /** 事件来得很密（拖进度条会连着触发好几次），合并成一次。 */
  const report = (event) => {
    clearTimeout(pending);
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastSentAt));
    pending = setTimeout(() => send(event), wait);
  };

  const EVENTS = ['play', 'pause', 'seeked', 'ended', 'ratechange'];
  const onEvent = (e) => report(e.type);

  const attach = () => {
    const next = pickVideo();
    if (next === video) return;
    if (video) EVENTS.forEach(ev => video.removeEventListener(ev, onEvent));
    video = next;
    if (video) {
      EVENTS.forEach(ev => video.addEventListener(ev, onEvent));
      report('found');
    }
  };

  // 这些网站都是单页应用：换集时 video 可能被整个换掉，定时重新找一遍
  setInterval(attach, 3000);
  attach();

  // 播放中定时报；暂停中两分钟报一次，让手机知道还开着
  setInterval(() => {
    if (!video) return;
    const since = Date.now() - lastSentAt;
    if (!video.paused && since >= TICK_MS) send('tick');
    else if (video.paused && since >= 120000) send('tick');
  }, 5000);

  // 换集（地址变了）马上报一次新标题
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; report('navigate'); }
  }, 2000);
})();
