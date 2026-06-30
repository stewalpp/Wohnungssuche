/* ============================================================
   Möbelverkauf — js/app.js
   Boot-Datei, zuletzt geladen. Tab-Wechsel, „+"-Aktion zum Anlegen,
   einmaliges Onboarding (Namen), Service-Worker-Registrierung.
   ============================================================ */
(function () {
  'use strict';

  var App = window.App = window.App || {};

  App.currentTab = 'items';

  // Tabs, auf denen der „+"-Button (FAB) sichtbar ist.
  var FAB_TABS = { items: 1 };

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

    updateFab();

    var root = document.getElementById('view-root');
    if (root) view.render(root);
    window.scrollTo(0, 0);
  };

  App.rerender = function () {
    var view = window.Views && window.Views[App.currentTab];
    if (!view || typeof view.render !== 'function') return;
    var root = document.getElementById('view-root');
    if (!root) return;
    // Wenn die Ansicht eine update()-Funktion hat (z. B. die Objekte-Liste),
    // nur den dynamischen Teil aktualisieren, damit ein Sync-Update während
    // des Tippens nicht den Fokus aus dem Suchfeld klaut.
    if (typeof view.update === 'function' && view.update() === true) return;
    view.render(root);
  };

  /* ---------------- FAB (neues Objekt) ---------------- */

  var fab = null;
  function ensureFab() {
    if (fab) return fab;
    fab = App.el('button', 'fab');
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Neues Objekt hinzufügen');
    fab.appendChild(App.icon('plus', 26));
    fab.addEventListener('click', function () {
      if (window.Views && Views.items && Views.items.openEditor) Views.items.openEditor(null);
    });
    document.body.appendChild(fab);
    return fab;
  }
  function updateFab() {
    ensureFab().classList.toggle('hidden', !FAB_TABS[App.currentTab]);
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

  /* ---------------- boot ---------------- */

  function start() {
    wireTabBar();
    Store.onChange(App.rerender);
    App.switchTab('items');
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
