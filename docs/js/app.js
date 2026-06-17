/* ============================================================
   Wohnungssuche — js/app.js
   Boot file, loaded last. Tab switching, header refresh action,
   "new since last visit" tracking, auto-refresh, onboarding,
   service-worker registration.
   ============================================================ */
(function () {
  'use strict';

  var App = window.App = window.App || {};

  App.currentTab = 'dashboard';
  App.lastSeen = null;   // high-water mark: newest first_seen the user acknowledged

  var REFRESH_MS = 5 * 60 * 1000;
  var refreshTimer = null;

  /* ---------------- tab switching ---------------- */

  App.switchTab = function (tabKey) {
    var view = window.Views && window.Views[tabKey];
    if (!view || typeof view.render !== 'function') return;
    App.currentTab = tabKey;

    var tabBar = document.getElementById('tab-bar');
    if (tabBar) {
      var items = tabBar.querySelectorAll('.tab-item');
      Array.prototype.forEach.call(items, function (btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
      });
    }

    var title = document.getElementById('page-title');
    if (title) title.textContent = view.title || '';

    renderHeaderAction(view);

    var root = document.getElementById('view-root');
    if (root) view.render(root);
    window.scrollTo(0, 0);
  };

  App.rerender = function () {
    var view = window.Views && window.Views[App.currentTab];
    if (!view || typeof view.render !== 'function') return;
    var root = document.getElementById('view-root');
    if (root) view.render(root);
    updateTabBadge();
  };

  function renderHeaderAction(view) {
    var actions = document.getElementById('header-actions');
    if (!actions) return;
    actions.innerHTML = '';
    if (App.currentTab === 'dashboard' || App.currentTab === 'listings' || App.currentTab === 'favorites') {
      var btn = App.el('button', 'icon-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Wohnungsliste aktualisieren');
      btn.title = 'Wohnungsliste aktualisieren';
      btn.appendChild(App.icon('refresh', 20));
      btn.addEventListener('click', function () {
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        btn.classList.add('spinning');
        Feed.refresh().then(function (res) {
          btn.classList.remove('spinning');
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
          App.rerender();
          App.toast(refreshToastText(res));
        });
      });
      actions.appendChild(btn);
    }
  }

  function refreshToastText(res) {
    if (!res || !res.ok) return 'Keine Verbindung – gespeicherte Liste bleibt sichtbar';
    if (res.changed) return 'Neue Daten geladen';
    var meta = Feed.getMeta();
    var stamp = meta.generated_at ? App.fmtDateTime(meta.generated_at) : (meta.lastFetched ? App.fmtDateTime(meta.lastFetched) : '');
    return stamp ? 'Liste geprüft · Stand ' + stamp : 'Liste geprüft';
  }

  App.refreshToastText = refreshToastText;

  App.refreshFeedNow = function () {
    return Feed.refresh().then(function (res) {
      App.rerender();
      App.toast(refreshToastText(res));
      return res;
    });
  };

  /* ---------------- "new since last visit" ---------------- */

  function newestFirstSeen() {
    var max = '';
    Feed.getListings().forEach(function (l) {
      if (l.first_seen && l.first_seen > max) max = l.first_seen;
    });
    return max;
  }

  // High-water mark of the newest first_seen the user has acknowledged. It is
  // NOT advanced on every app open (that would make "NEU" vanish instantly) —
  // only on the very first launch and when the user taps "Als gesehen markieren".
  function initNew() {
    var stored = null;
    try { stored = localStorage.getItem('ws.lastSeen'); } catch (e) {}
    if (stored) {
      App.lastSeen = stored;
    } else {
      App.lastSeen = newestFirstSeen() || new Date().toISOString();
      try { localStorage.setItem('ws.lastSeen', App.lastSeen); } catch (e) {}
    }
  }

  App.isNew = function (listing) {
    return !!(App.lastSeen && listing && listing.first_seen && listing.first_seen > App.lastSeen);
  };

  App.newCount = function () {
    var ratings = Store.getAllRatings();
    return Feed.getListings().filter(function (l) {
      var r = ratings[l.id] || {};
      return !r.hidden && App.isNew(l);
    }).length;
  };

  // Mark everything currently in the feed as seen (clears the NEU markers).
  App.markAllSeen = function () {
    var newest = newestFirstSeen();
    if (newest) {
      App.lastSeen = newest;
      try { localStorage.setItem('ws.lastSeen', newest); } catch (e) {}
    }
    App.rerender();
  };

  function updateTabBadge() {
    var tab = document.querySelector('.tab-item[data-tab="listings"]');
    if (!tab) return;
    var existing = tab.querySelector('.tab-badge');
    var n = App.newCount();
    if (n > 0) {
      if (!existing) {
        existing = App.el('span', 'tab-badge');
        tab.appendChild(existing);
      }
      existing.textContent = n > 9 ? '9+' : String(n);
    } else if (existing) {
      existing.remove();
    }
  }

  /* ---------------- onboarding (set names once) ---------------- */

  function showOnboarding() {
    var content = App.el('div', '');
    var intro = App.el('p', 'info-p',
      'Schön, dass ihr gemeinsam sucht! Tragt kurz eure Namen ein – dann seht ihr bei jeder Wohnung, wer sie wie bewertet hat.');
    content.appendChild(intro);

    var members = Store.getSettings().members;
    var inputs = {};
    members.forEach(function (m) {
      var g = App.el('div', 'form-group');
      g.appendChild(App.el('div', 'form-label', m.id === 'p1' ? 'Dein Name' : 'Name deiner Partnerin / deines Partners'));
      var inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'input'; inp.placeholder = 'Vorname';
      inp.value = (m.name && m.name !== 'Partnerin' && m.name !== 'Person 1' && m.name !== 'Person 2') ? m.name : '';
      inp.setAttribute('autocapitalize', 'words');
      g.appendChild(inp);
      content.appendChild(g);
      inputs[m.id] = inp;
    });

    var start = App.el('button', 'btn btn-primary', 'Los geht’s!');
    start.type = 'button';
    start.style.marginTop = '6px';
    start.addEventListener('click', function () {
      Store.updateSettings({
        onboarded: true,
        members: [
          { id: 'p1', name: inputs.p1.value.trim() },
          { id: 'p2', name: inputs.p2.value.trim() }
        ]
      });
      App.closeSheet();
      App.toast('Namen gespeichert ✓');
    });
    content.appendChild(start);

    App.showSheet({ title: 'Willkommen', content: content });
  }

  /* ---------------- wiring ---------------- */

  function wireTabBar() {
    var tabBar = document.getElementById('tab-bar');
    if (!tabBar) return;
    tabBar.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.tab-item') : null;
      if (!btn || !tabBar.contains(btn)) return;
      var key = btn.getAttribute('data-tab');
      if (key) App.switchTab(key);
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    var proto = window.location.protocol;
    if (proto !== 'http:' && proto !== 'https:') return;
    navigator.serviceWorker.register('./sw.js').catch(function (e) {
      console.warn('Service-Worker-Registrierung fehlgeschlagen:', e);
    });
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (document.visibilityState === 'visible') Feed.refresh();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') Feed.refresh();
    });
    // Re-fetch and re-render when connectivity returns (also updates the
    // offline banner in the listings view).
    window.addEventListener('online', function () { Feed.refresh().then(App.rerender); });
    window.addEventListener('offline', App.rerender);
  }

  /* ---------------- boot ---------------- */

  function start() {
    Feed.init();
    initNew();
    wireTabBar();
    Store.onChange(App.rerender);
    Feed.onChange(App.rerender);
    if (!Store.getSettings().onboarded) showOnboarding();
    App.switchTab('dashboard');
    updateTabBadge();
    Feed.refresh();
    startAutoRefresh();
    registerServiceWorker();
  }

  function boot() {
    Promise.resolve()
      .then(function () { return Store.init(); })
      .catch(function (e) { console.error('Store.init fehlgeschlagen:', e); })
      .then(start);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
