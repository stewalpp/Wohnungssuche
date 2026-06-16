/* ============================================================
   Wohnungssuche — js/app.js
   Boot file, loaded last. Tab switching, header refresh action,
   "new since last visit" tracking, auto-refresh, onboarding,
   service-worker registration.
   ============================================================ */
(function () {
  'use strict';

  var App = window.App = window.App || {};

  App.currentTab = 'listings';
  App.newSince = null;

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
    if (App.currentTab === 'listings' || App.currentTab === 'favorites') {
      var btn = App.el('button', 'icon-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Aktualisieren');
      btn.appendChild(App.icon('refresh', 20));
      btn.addEventListener('click', function () {
        btn.classList.add('spinning');
        Feed.refresh().then(function (changed) {
          btn.classList.remove('spinning');
          App.toast(changed ? 'Aktualisiert' : 'Bereits aktuell');
        });
      });
      actions.appendChild(btn);
    }
  }

  /* ---------------- "new since last visit" ---------------- */

  function initNewSince() {
    var prev = null;
    try { prev = localStorage.getItem('ws.lastVisit'); } catch (e) {}
    App.newSince = prev || null;
    try { localStorage.setItem('ws.lastVisit', new Date().toISOString()); } catch (e) {}
  }

  function newCount() {
    if (!App.newSince) return 0;
    var ratings = Store.getAllRatings();
    return Feed.getListings().filter(function (l) {
      var r = ratings[l.id] || {};
      return !r.hidden && l.first_seen && l.first_seen > App.newSince;
    }).length;
  }

  function updateTabBadge() {
    var tab = document.querySelector('.tab-item[data-tab="listings"]');
    if (!tab) return;
    var existing = tab.querySelector('.tab-badge');
    var n = newCount();
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
  }

  /* ---------------- boot ---------------- */

  function start() {
    initNewSince();
    Feed.init();
    wireTabBar();
    Store.onChange(App.rerender);
    Feed.onChange(App.rerender);
    if (!Store.getSettings().onboarded) showOnboarding();
    App.switchTab('listings');
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
