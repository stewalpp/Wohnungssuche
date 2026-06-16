/* ============================================================
   Wohnungssuche — js/filters.js
   window.ListFilter: client-side filtering & sorting of the feed.
   Filter state is per-device (localStorage). Pure functions otherwise.
   ============================================================ */
(function () {
  'use strict';

  var LS_FILTER = 'ws.filter';

  var DEFAULT = {
    scope: 'alle',      // 'alle' | 'neu' | 'match' | 'review' | 'favoriten'
    query: '',
    sort: 'neu',        // 'neu' | 'preis' | 'flaeche'
    maxPrice: null      // number or null
  };

  var state = load();

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_FILTER) || '{}');
      return Object.assign({}, DEFAULT, raw && typeof raw === 'object' ? raw : {});
    } catch (e) { return Object.assign({}, DEFAULT); }
  }
  function save() { try { localStorage.setItem(LS_FILTER, JSON.stringify(state)); } catch (e) {} }

  function getState() { return Object.assign({}, state); }
  function setState(patch) { state = Object.assign({}, state, patch || {}); save(); return getState(); }
  function reset() { state = Object.assign({}, DEFAULT); save(); return getState(); }

  function num(v) { return (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v); }

  // listings: feed array; ctx: { ratings: id->rating, newIds: Set }
  function apply(listings, ctx) {
    ctx = ctx || {};
    var ratings = ctx.ratings || {};
    var newIds = ctx.newIds || new Set();
    var q = (state.query || '').trim().toLowerCase();

    var out = listings.filter(function (l) {
      var r = ratings[l.id] || {};
      // hidden listings are only shown via the favourites scope (never otherwise)
      if (r.hidden && state.scope !== 'favoriten') return false;

      if (state.scope === 'match' && l.status !== 'match') return false;
      if (state.scope === 'review' && l.status !== 'review') return false;
      if (state.scope === 'neu' && !newIds.has(l.id)) return false;
      if (state.scope === 'favoriten' && !r.favorite) return false;

      if (state.maxPrice !== null && state.maxPrice !== undefined) {
        var p = num(l.price_eur);
        if (p !== null && p > state.maxPrice) return false;
      }

      if (q) {
        var hay = ((l.title || '') + ' ' + (l.location || '') + ' ' + (l.source || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    out.sort(function (a, b) {
      if (state.sort === 'preis') {
        var pa = num(a.price_eur), pb = num(b.price_eur);
        if (pa === null && pb === null) return cmpNew(b, a);
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pa - pb;
      }
      if (state.sort === 'flaeche') {
        var aa = num(a.area_sqm), ab = num(b.area_sqm);
        if (aa === null && ab === null) return cmpNew(b, a);
        if (aa === null) return 1;
        if (ab === null) return -1;
        return ab - aa;
      }
      return cmpNew(b, a); // 'neu' — newest first
    });

    return out;
  }

  function cmpNew(a, b) {
    var sa = a.first_seen || '', sb = b.first_seen || '';
    return sa < sb ? -1 : sa > sb ? 1 : (a.id < b.id ? -1 : 1);
  }

  window.ListFilter = {
    getState: getState,
    setState: setState,
    reset: reset,
    apply: apply,
    DEFAULT: DEFAULT
  };
})();
