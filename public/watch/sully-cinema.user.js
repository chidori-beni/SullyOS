// ==UserScript==
// @name         Sully 影院 · 暂停同步
// @namespace    https://chidori-beni.github.io/SullyOS/
// @version      0.1.3
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

  const VERSION = '0.1.3';
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

  // ───────── 好几个标签页都开着视频时，只让一个报 ─────────
  // 09-30 实测：同时开了两个 B站 视频，共享的是 A、放的也是 A，B 暂停着，
  // 但 B 暂停中的心跳把 A 的进度盖掉了。现在「当班」的标签页才报：
  //   · 按了播放的标签页接班（你正在放的，就是你在看的）
  //   · 正在放的标签页，可以从「暂停着的」或「5 分钟没动静的」当班手里接班
  //   · 暂停着、又不当班的标签页，一声不吭
  // 当班记录放在油猴的存储里，所有标签页共用。
  const ACTIVE_KEY = 'sully-active-tab';
  const ACTIVE_STALE_MS = 5 * 60 * 1000;
  const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

  const readActive = () => {
    try {
      const raw = GM_getValue(ACTIVE_KEY, null);
      const active = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return active && typeof active.id === 'string' ? active : null;
    } catch (e) { return null; }
  };

  /** 这一次该不该我报；该的话顺手把当班记录写成我（刷新时间和暂停状态）。 */
  const mayReport = (event) => {
    const active = readActive();
    const playing = !!video && !video.paused && !video.ended;
    const mine = !!active && active.id === TAB_ID;
    const stale = !active || Date.now() - active.at > ACTIVE_STALE_MS;
    const take = mine
      || event === 'play'
      || (playing && (stale || active.paused))
      || (!active && event === 'found');
    if (take) GM_setValue(ACTIVE_KEY, JSON.stringify({ id: TAB_ID, at: Date.now(), paused: !playing }));
    return take;
  };

  const send = (event) => {
    const pair = readPair();
    if (!pair) {
      if (!warnedNoPair) console.info('[Sully 影院] 还没拿到配对：先在这个浏览器里打开一次观影端网页（watch.html）并配对');
      warnedNoPair = true;
      return;
    }
    if (!video) return;
    if (!mayReport(event)) return;
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
      // 当前这句字幕 + 上次报完以后新出现的几句（只有 B站 开着 CC / AI 字幕时才有）
      subtitle: lastSubtitle || undefined,
      subtitles: pendingSubtitles.length ? pendingSubtitles.splice(0) : undefined,
      subtitleProbe: pendingProbe || undefined,
    };
    pendingProbe = '';
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

  // ───────── B站 字幕 ─────────
  // B站 的 CC 字幕和 AI 字幕是叠在视频上的一段网页文字（不是画在画面里的），直接读文字，
  // 不用看图、不花 token。用户要在播放器里把字幕打开，关着就读不到。
  // 画面里自带的硬字幕读不到，那部分靠观影端截图 + 画面笔记。
  // 新出现的句子先攒着，随每 15 秒一次的进度一起带走，不单独多发请求。
  // 类名 2026-09-30 从 B站 播放器的代码里核对过：新版播放器是 bpx-player-subtitle-panel-*，
  // 另一套字幕组件是 bili-subtitle-x-subtitle-panel-*（AI 字幕带一个「AI」小角标）。
  // 中英双语字幕分主 / 副两组（major / minor），优先只读主字幕。
  const SUBTITLE_SELECTORS = [
    '.bpx-player-subtitle-panel-major-group .bpx-player-subtitle-panel-text',
    '.bili-subtitle-x-subtitle-panel-major-group .bili-subtitle-x-subtitle-panel-text',
    '.bpx-player-subtitle-panel-text',
    '.bili-subtitle-x-subtitle-panel-text',
    '.bilibili-player-video-subtitle .subtitle-item-text',
  ];
  const MAX_PENDING_SUBTITLES = 12;
  let lastSubtitle = '';
  const pendingSubtitles = [];

  /** 取一个字幕元素的字，跳过「AI」角标、图标这类附件。 */
  const textOf = (el) => {
    const nodes = el && el.childNodes ? Array.from(el.childNodes) : [];
    if (!nodes.length) return el.textContent || '';
    return nodes.map(node => {
      if (node.nodeType === 3) return node.textContent || '';
      const cls = typeof node.className === 'string' ? node.className : '';
      return /badge|icon/i.test(cls) ? '' : textOf(node);
    }).join('');
  };

  // 09-30 实测：日剧的 AI 字幕屏幕上有，却读不到。很可能是字幕组件把文字封在 shadow root
  // （「密封盒子」）里，document.querySelectorAll 伸不进去。所以在播放器里连盒子一起找。
  const playerRoot = () => (document.querySelector && (document.querySelector('.bpx-player-container')
    || document.querySelector('#bilibili-player'))) || document;

  /** 在 root 里（连同里面所有 shadow root）找 sel。 */
  const deepQueryAll = (root, sel) => {
    const out = [];
    const visit = (r, depth) => {
      if (!r || depth > 4) return;
      try { Array.from(r.querySelectorAll(sel) || []).forEach(el => out.push(el)); } catch (e) { /* 选择器不认 */ }
      let all = [];
      try { all = Array.from(r.querySelectorAll('*') || []); } catch (e) { return; }
      for (const el of all) if (el && el.shadowRoot) visit(el.shadowRoot, depth + 1);
    };
    visit(root, 0);
    return out;
  };

  const readSubtitle = () => {
    if (site !== 'B站') return '';
    const root = playerRoot();
    for (const sel of SUBTITLE_SELECTORS) {
      const els = deepQueryAll(root, sel);
      if (!els.length) continue;
      const text = els.map(textOf).join(' ').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 200);
    }
    return '';
  };

  // ───────── 字幕侦探 ─────────
  // 在放、却一直读不到字幕时，把播放器里所有名字带 subtitle / caption 的东西列个清单，
  // 随下一次进度一起报上去，观影端会显示出来。用户截那一行，就知道字幕藏在哪了。
  let noSubtitleSince = 0;
  let lastProbeAt = 0;
  let pendingProbe = '';

  const probeSubtitles = () => {
    const root = playerRoot();
    const items = [];
    const visit = (r, depth) => {
      if (!r || depth > 4) return;
      let all = [];
      try { all = Array.from(r.querySelectorAll('*') || []); } catch (e) { return; }
      for (const el of all) {
        const cls = typeof el.className === 'string' ? el.className : ((el.getAttribute && el.getAttribute('class')) || '');
        const tag = String(el.tagName || '').toLowerCase();
        if (/subtitle|caption/i.test(`${cls} ${tag}`)) {
          const text = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16);
          items.push(`${depth ? '[盒内]' : ''}${tag}.${cls.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}「${text}」`);
        }
        if (el.shadowRoot) visit(el.shadowRoot, depth + 1);
      }
    };
    visit(root, 0);
    let canvases = 0;
    try { canvases = (root.querySelectorAll('canvas') || []).length; } catch (e) { /* ignore */ }
    return `${items.slice(0, 10).join(' | ') || '播放器里没找到带 subtitle 的元素'}（canvas ${canvases} 个）`;
  };

  setInterval(() => {
    const text = readSubtitle();
    if (!text) {
      lastSubtitle = '';
      if (site === 'B站' && video && !video.paused) {
        if (!noSubtitleSince) noSubtitleSince = Date.now();
        if (Date.now() - noSubtitleSince > 20000 && Date.now() - lastProbeAt > 60000) {
          pendingProbe = probeSubtitles();
          lastProbeAt = Date.now();
        }
      }
      return;
    }
    noSubtitleSince = 0;
    if (text === lastSubtitle) return;
    lastSubtitle = text;
    pendingSubtitles.push({ time: video && isFinite(video.currentTime) ? Math.round(video.currentTime) : undefined, text });
    if (pendingSubtitles.length > MAX_PENDING_SUBTITLES) pendingSubtitles.shift();
  }, 1000);

  // 换集（地址变了）马上报一次新标题
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; report('navigate'); }
  }, 2000);
})();
