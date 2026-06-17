/* ============================================================
   Wohnungssuche — js/views/dashboard.js
   Views.dashboard ("Übersicht"): a self-explanatory overview —
   key numbers, top matches by score, "both like it", status
   overview and the sorted-out bin. Reuses the listing card.
   ============================================================ */
(function () {
  'use strict';

  var Views = window.Views = window.Views || {};

  // Open the listings tab showing exactly the set a dashboard tile counted.
  // The tile counts are computed over the whole active set, so we clear the
  // per-device advanced filters (price/area/rooms/ort/photo/zu-bewerten/query)
  // first — otherwise a left-over filter would make the destination list show
  // fewer items than the number on the tile.
  function openList(patch) {
    ListFilter.setState(Object.assign({
      query: '', priceMin: null, priceMax: null, areaMin: null, areaMax: null,
      roomsMin: null, roomsMax: null, ort: '', withImage: false, unratedOnly: false
    }, patch));
    App.switchTab('listings');
  }

  function statTile(value, label, tone, onClick) {
    var t = App.el('div', 'stat' + (onClick ? ' tappable' : ''));
    var v = App.el('div', 'stat-value' + (tone ? ' ' + tone : ''), value);
    t.appendChild(v);
    t.appendChild(App.el('div', 'stat-label', label));
    if (onClick) {
      t.setAttribute('role', 'button');
      t.addEventListener('click', onClick);
    }
    return t;
  }

  // Top bar: when the list was last refreshed + a prominent-but-subtle button
  // to start a fresh search (via the Cloudflare trigger; falls back to the
  // GitHub Actions page when no trigger proxy is configured).
  function buildUpdateBar() {
    var meta = Feed.getMeta();
    var bar = App.el('div', 'dash-updatebar');

    var info = App.el('div', 'dash-updated');
    info.appendChild(App.icon('refresh', 14));
    info.appendChild(App.el('span', null,
      meta.generated_at ? 'Aktualisiert ' + App.fmtRelTime(meta.generated_at) : 'Noch nicht aktualisiert'));
    bar.appendChild(info);

    var btn = App.makeSearchTriggerButton({
      className: 'btn btn-primary btn-small dash-update-btn',
      label: 'Aktualisieren',
      iconSize: 14
    });
    if (!btn) {
      var repo = (window.WS_CONFIG && WS_CONFIG.issueRepo) || '';
      if (repo) {
        btn = App.el('a', 'btn btn-primary btn-small dash-update-btn');
        btn.href = 'https://github.com/' + repo + '/actions/workflows/daily-search.yml';
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
        btn.appendChild(App.el('span', null, 'Aktualisieren'));
        btn.appendChild(App.icon('external', 14));
      }
    }
    if (btn) bar.appendChild(btn);
    return bar;
  }

  function render(container) {
    container.innerHTML = '';
    var view = App.el('div', 'view');

    view.appendChild(buildUpdateBar());

    var listings = Feed.getListings();
    var ratings = Store.getAllRatings();
    var newIds = Views.listings.newIdSet();

    function bothBad(l) { var r = ratings[l.id] || {}; return r.p1 === 'schlecht' && r.p2 === 'schlecht'; }
    function bothGood(l) { var r = ratings[l.id] || {}; return r.p1 === 'gut' && r.p2 === 'gut'; }
    var active = listings.filter(function (l) { var r = ratings[l.id] || {}; return !bothBad(l) && !r.hidden; });

    if (!listings.length) {
      view.appendChild(Views.listings.emptyState(
        'building',
        'Noch keine Wohnungen',
        'Die Suche läuft automatisch mehrmals täglich. Sobald passende Inserate gefunden werden, erscheinen sie hier.'
      ));
      container.appendChild(view);
      return;
    }

    // key numbers
    var newCount = App.newCount();
    // Favoriten = starred and not both-rejected (hidden ones still count, matching
    // the Favoriten tab and the 'favoriten' listing scope).
    var favCount = listings.filter(function (l) { return (ratings[l.id] || {}).favorite && !bothBad(l); }).length;
    var toRate = active.filter(function (l) { var r = ratings[l.id] || {}; return !(r.p1 && r.p2); }).length;

    var stats = App.el('div', 'stat-grid');
    stats.appendChild(statTile(String(active.length), 'Wohnungen', null, function () {
      openList({ scope: 'alle' });
    }));
    stats.appendChild(statTile(String(newCount), 'Neu', newCount > 0 ? 'pos' : null, function () {
      openList({ scope: 'neu' });
    }));
    stats.appendChild(statTile(String(favCount), 'Favoriten', null, function () { App.switchTab('favorites'); }));
    stats.appendChild(statTile(String(toRate), 'Zu bewerten', null, function () {
      openList({ scope: 'alle', unratedOnly: true });
    }));
    view.appendChild(stats);

    // top matches by score
    var top = active.slice().sort(function (a, b) { return Score.score(b).total - Score.score(a).total; }).slice(0, 4);
    if (top.length) {
      view.appendChild(App.el('div', 'section-title', 'Eure Top-Treffer'));
      top.forEach(function (l) { view.appendChild(Views.listings.card(l, newIds)); });
    }

    // both like it — same set as the Favoriten tab's "Beide mögen sie" section
    // (both rated "Gut", not already a starred favourite), so the count here and
    // the section it links to always agree.
    var both = active.filter(function (l) { return bothGood(l) && !(ratings[l.id] || {}).favorite; });
    if (both.length) {
      var bg = App.el('div', 'card tappable');
      var bgHead = App.el('div', 'dash-row');
      var bgLeft = App.el('div', 'dash-row-main');
      bgLeft.appendChild(App.el('div', 'dash-row-title', 'Beide mögen sie'));
      bgLeft.appendChild(App.el('div', 'dash-row-sub', both.length + (both.length === 1 ? ' Wohnung – eure engere Auswahl' : ' Wohnungen – eure engere Auswahl')));
      bgHead.appendChild(bgLeft);
      var chev = App.icon('chevron', 20); chev.style.color = 'var(--text-3)';
      bgHead.appendChild(chev);
      bg.appendChild(bgHead);
      bg.addEventListener('click', function () { App.switchTab('favorites'); });
      view.appendChild(bg);
    }

    // status overview
    var STATUS = [['angefragt', 'Angefragt'], ['besichtigung', 'Besichtigung'], ['zusage', 'Zusage'], ['absage', 'Absage']];
    var counts = {};
    active.forEach(function (l) { var s = (ratings[l.id] || {}).status; if (s) counts[s] = (counts[s] || 0) + 1; });
    if (STATUS.some(function (o) { return counts[o[0]]; })) {
      var sc = App.el('div', 'card');
      sc.appendChild(App.el('div', 'card-title', 'Status der Inserate'));
      STATUS.forEach(function (o) {
        if (!counts[o[0]]) return;
        var row = App.el('div', 'kv-row');
        var left = App.el('span', null);
        var dot = App.el('span', 'dot'); dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;vertical-align:middle;';
        dot.classList.add('status-' + o[0]);
        left.appendChild(dot); left.appendChild(document.createTextNode(o[1]));
        row.appendChild(left);
        row.appendChild(App.el('span', 'kv-value', String(counts[o[0]])));
        sc.appendChild(row);
      });
      view.appendChild(sc);
    }

    // sorted-out bin
    var sortedOut = listings.filter(bothBad).length;
    if (sortedOut) {
      var so = App.el('button', 'link-row');
      so.type = 'button';
      so.textContent = sortedOut + (sortedOut === 1 ? ' aussortierte Wohnung ansehen' : ' aussortierte Wohnungen ansehen');
      so.addEventListener('click', function () { openList({ scope: 'aussortiert' }); });
      view.appendChild(so);
    }

    container.appendChild(view);
  }

  Views.dashboard = { title: 'Übersicht', render: render };
})();
