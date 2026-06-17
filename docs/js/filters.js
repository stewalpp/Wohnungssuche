/* ============================================================
   Wohnungssuche — js/filters.js
   window.ListFilter: client-side filtering & sorting of the feed.
   Filter state is per-device (localStorage). Pure functions otherwise.
   ============================================================ */
(function () {
  'use strict';

  var LS_FILTER = 'ws.filter';

  var DEFAULT = {
    scope: 'alle',      // 'alle'|'neu'|'match'|'review'|'favoriten'|'aussortiert'
    query: '',
    sort: 'neu',        // 'neu'|'score'|'preis'|'flaeche'
    priceMin: null,
    priceMax: null,
    areaMin: null,
    areaMax: null,
    roomsMin: null,
    roomsMax: null,
    ort: '',            // '' = alle; otherwise a town name (from the source)
    withImage: false,   // only listings that have a photo
    unratedOnly: false, // listings still missing at least one partner's rating
    groundFloorImportant: true,  // scoring preference (also used by Score)
    transitImportant: true       // scoring preference
  };

  // Coarse town/search-area for a listing, derived from its source name
  // (e.g. "Immowelt Gehrden 3 Zimmer" -> "Gehrden"). Reliable for grouping.
  function townOf(listing) {
    var s = (listing && listing.source) || '';
    s = s.replace(/^(Immowelt|Kleinanzeigen|Immobilo|Wohnungsb(?:ö|oe)rse|ImmoScout24)\s+/i, '');
    s = s.replace(/\s*\d+(?:[.,]\d+)?\s*Zimmer.*$/i, '');
    return s.trim();
  }

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

  function inRange(value, min, max) {
    var v = num(value);
    if (v === null) return true;   // unknown value → don't exclude
    if (min !== null && min !== undefined && v < min) return false;
    if (max !== null && max !== undefined && v > max) return false;
    return true;
  }

  // The WARM total the card headline and the score use, with the cold rent as a
  // fallback when warm can't be derived. The price filter and price sort must use
  // this — not the bare cold price_eur — so they agree with what the user sees.
  function warmRent(l) {
    var w = (window.Score && Score.effectiveRent) ? Score.effectiveRent(l) : null;
    return (w === null || w === undefined) ? l.price_eur : w;
  }

  function bothBad(r) { return r.p1 === 'schlecht' && r.p2 === 'schlecht'; }

  // listings: feed array; ctx: { ratings: id->rating, newIds: Set }
  function apply(listings, ctx) {
    ctx = ctx || {};
    var ratings = ctx.ratings || {};
    var newIds = ctx.newIds || new Set();
    var q = (state.query || '').trim().toLowerCase();

    var out = listings.filter(function (l) {
      var r = ratings[l.id] || {};

      // Dedicated bin for listings both partners rated "schlecht".
      if (state.scope === 'aussortiert') return bothBad(r);
      // Everywhere else they disappear automatically; hidden too (except favourites).
      if (bothBad(r)) return false;
      if (r.hidden && state.scope !== 'favoriten') return false;

      if (state.scope === 'match' && l.status !== 'match') return false;
      if (state.scope === 'review' && l.status !== 'review') return false;
      if (state.scope === 'neu' && !newIds.has(l.id)) return false;
      if (state.scope === 'favoriten' && !r.favorite) return false;

      if (!inRange(warmRent(l), state.priceMin, state.priceMax)) return false;
      if (!inRange(l.area_sqm, state.areaMin, state.areaMax)) return false;
      if (!inRange(l.rooms, state.roomsMin, state.roomsMax)) return false;

      if (state.withImage && !l.image) return false;
      // "Zu bewerten" = still needs at least one partner's vote. Matches the
      // dashboard "Zu bewerten" tile (!(p1 && p2)); a half-rated listing stays
      // visible so the other partner can finish it.
      if (state.unratedOnly && r.p1 && r.p2) return false;
      if (state.ort && townOf(l).toLowerCase() !== state.ort.toLowerCase()) return false;

      if (q) {
        var hay = ((l.title || '') + ' ' + (l.location || '') + ' ' + (l.source || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    out.sort(function (a, b) {
      if (state.sort === 'score' && window.Score) {
        return Score.score(b).total - Score.score(a).total;
      }
      if (state.sort === 'preis') {
        var pa = num(warmRent(a)), pb = num(warmRent(b));
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
    townOf: townOf,
    DEFAULT: DEFAULT
  };
})();
