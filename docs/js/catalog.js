/* ============================================================
   Möbelverkauf — js/catalog.js
   window.Catalog: gemeinsame Stammdaten (Kategorien, Status,
   Plattformen) + kleine Helfer. Wird nach core.js, vor store.js
   geladen, damit Store validieren und Views rendern können.
   ============================================================ */
(function () {
  'use strict';

  // Kategorien: key, Label, Emoji, Farb-CSS-Variable
  var CATEGORIES = [
    { key: 'moebel',     label: 'Möbel',      emoji: '🛋️', color: 'var(--indigo)' },
    { key: 'kueche',     label: 'Küche',      emoji: '🍳', color: 'var(--orange)' },
    { key: 'elektronik', label: 'Elektronik', emoji: '🔌', color: 'var(--tint)' },
    { key: 'haushalt',   label: 'Haushalt',   emoji: '🧺', color: 'var(--teal)' },
    { key: 'deko',       label: 'Deko',       emoji: '🖼️', color: 'var(--pink)' },
    { key: 'garten',     label: 'Garten',     emoji: '🪴', color: 'var(--green)' },
    { key: 'kleidung',   label: 'Kleidung',   emoji: '👕', color: 'var(--purple)' },
    { key: 'sonstiges',  label: 'Sonstiges',  emoji: '📦', color: 'var(--gray)' }
  ];

  // Status: key, Label, kurze Liste-Bezeichnung, CSS-Klasse (Farbe),
  //   counts: zählt als "erledigt" (raus aus aktiver Liste)?
  //   earns:  bringt Erlös (relevant für "Eingenommen")?
  //   expects: erwarteter künftiger Erlös (Potenzial)?
  var STATUSES = [
    { key: 'offen',      label: 'Zu verkaufen', short: 'Offen',      cls: 's-offen',      done: false, earns: false, expects: true  },
    { key: 'reserviert', label: 'Reserviert',   short: 'Reserviert', cls: 's-reserviert', done: false, earns: false, expects: true  },
    { key: 'verkauft',   label: 'Verkauft',     short: 'Verkauft',   cls: 's-verkauft',   done: true,  earns: true,  expects: false },
    { key: 'verschenkt', label: 'Verschenkt',   short: 'Verschenkt', cls: 's-verschenkt', done: true,  earns: false, expects: false },
    { key: 'entsorgt',   label: 'Entsorgt',     short: 'Entsorgt',   cls: 's-entsorgt',   done: true,  earns: false, expects: false },
    { key: 'behalten',   label: 'Behalten',     short: 'Behalten',   cls: 's-behalten',   done: true,  earns: false, expects: false }
  ];

  function findBy(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    return null;
  }

  window.Catalog = {
    categories: CATEGORIES,
    statuses: STATUSES,

    category: function (key) { return findBy(CATEGORIES, key) || findBy(CATEGORIES, 'sonstiges'); },
    status: function (key) { return findBy(STATUSES, key) || findBy(STATUSES, 'offen'); },

    isCategory: function (key) { return !!findBy(CATEGORIES, key); },
    isStatus: function (key) { return !!findBy(STATUSES, key); },

    categoryLabel: function (key) { var c = findBy(CATEGORIES, key); return c ? c.label : 'Sonstiges'; },
    statusLabel: function (key) { var s = findBy(STATUSES, key); return s ? s.label : 'Zu verkaufen'; }
  };
})();
