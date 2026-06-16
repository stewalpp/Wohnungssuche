/* ============================================================
   Wohnungssuche — js/feed.js
   window.Feed: load the listings.json produced by the Python scraper.

   Read-only data source. Caches the last good feed in localStorage so the
   app boots instantly (and works offline); then refreshes from the network
   in the background. Fires onChange whenever the in-memory feed changes.
   Classic script. No modules, no external libs.
   ============================================================ */
(function () {
  'use strict';

  var LS_FEED = 'ws.feed';

  var feed = { schema: 1, generated_at: null, criteria: {}, counts: {}, listings: [] };
  var lastError = null;
  var lastFetched = null;
  var listeners = [];

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.error('Feed-Listener fehlgeschlagen:', e); }
    }
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(LS_FEED);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return v && Array.isArray(v.listings) ? v : null;
    } catch (e) { return null; }
  }

  function writeCache(value) {
    try { localStorage.setItem(LS_FEED, JSON.stringify(value)); } catch (e) { /* quota */ }
  }

  // Only http(s) links are safe to put in an href; reject javascript:/data:/etc.
  function safeUrl(url) {
    if (typeof url !== 'string') return '';
    try {
      var u = new URL(url, location.href);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (e) { return ''; }
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.listings)) return null;
    return {
      schema: raw.schema || 1,
      generated_at: raw.generated_at || null,
      criteria: raw.criteria || {},
      counts: raw.counts || {},
      listings: raw.listings
        .filter(function (l) { return l && l.id; })
        .map(function (l) { return Object.assign({}, l, { url: safeUrl(l.url) }); })
    };
  }

  // Load the cached feed synchronously (so the first render has data).
  function init() {
    var cached = readCache();
    if (cached) feed = cached;
    return feed;
  }

  // Fetch the latest feed from the network. Resolves to a status object
  // { ok, changed, error } so callers can tell a failed fetch apart from an
  // unchanged one. Cache-busted so the SW/CDN never serves a stale copy.
  function refresh() {
    var url = (window.WS_CONFIG && WS_CONFIG.feedUrl) || 'data/listings.json';
    var bust = url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
    return fetch(bust, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) {
        var next = normalize(json);
        if (!next) throw new Error('Ungültiges Feed-Format');
        lastError = null;
        lastFetched = new Date().toISOString();
        var changed = JSON.stringify(next) !== JSON.stringify(feed);
        feed = next;
        writeCache(feed);
        if (changed) emit();
        return { ok: true, changed: changed, error: null };
      })
      .catch(function (e) {
        lastError = e;
        console.warn('Feed konnte nicht geladen werden:', e);
        return { ok: false, changed: false, error: e };
      });
  }

  window.Feed = {
    init: init,
    refresh: refresh,
    getListings: function () { return feed.listings.slice(); },
    getMeta: function () {
      return {
        generated_at: feed.generated_at,
        criteria: feed.criteria || {},
        counts: feed.counts || {},
        lastFetched: lastFetched,
        lastError: lastError
      };
    },
    onChange: function (fn) {
      if (typeof fn === 'function') listeners.push(fn);
      return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
    }
  };
})();
