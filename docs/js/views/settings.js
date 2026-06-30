/* ============================================================
   Möbelverkauf — js/views/settings.js
   Views.settings ("Mehr"): Sync-Status, Personennamen, Darstellung,
   Daten-Übersicht/Export und Info.
   ============================================================ */
(function () {
  'use strict';

  var Views = window.Views = window.Views || {};

  function card(title) {
    var c = App.el('div', 'card');
    if (title) c.appendChild(App.el('div', 'card-title', title));
    return c;
  }

  function kv(label, value, tone) {
    var row = App.el('div', 'kv-row');
    row.appendChild(App.el('span', null, label));
    row.appendChild(App.el('span', 'kv-value' + (tone ? ' ' + tone : ''), value));
    return row;
  }

  // Lesbare Text-Liste aller Objekte (zum Teilen/Kopieren).
  function summaryText(items, s) {
    var lines = [];
    lines.push('Möbelverkauf – Stand ' + App.fmtDate(new Date().toISOString()));
    lines.push('Eingenommen: ' + App.fmtEUR(s.earned) + ' · ' + s.soldCount + ' verkauft · ' + s.total + ' Objekte');
    lines.push('');
    items.slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'de'); }).forEach(function (it) {
      var price;
      if (it.status === 'verkauft') {
        price = App.fmtEUR(it.soldPrice != null ? it.soldPrice : it.wishPrice) + ' (verkauft)';
      } else {
        var lo = it.minPrice, hi = it.wishPrice, p;
        if (lo != null && hi != null && lo !== hi) p = lo + '–' + hi + ' €';
        else if (hi != null) p = App.fmtEUR(hi);
        else if (lo != null) p = 'ab ' + App.fmtEUR(lo);
        else p = 'Preis offen';
        price = p + ' (' + Catalog.statusLabel(it.status) + ')';
      }
      lines.push('• ' + (it.name || 'Objekt') + ': ' + price);
    });
    return lines.join('\n');
  }

  function render(container) {
    container.innerHTML = '';
    var view = App.el('div', 'view');

    /* ---- Sync ---- */
    var sync = Store.syncStatus();
    var syncCard = card('Synchronisation');
    var statusRow = App.el('div', 'kv-row');
    statusRow.appendChild(App.el('span', null, 'Status'));
    var dot = App.el('span', 'sync-status');
    if (sync.connected) {
      dot.classList.add('ok');
      dot.appendChild(App.icon('cloud', 16));
      dot.appendChild(App.el('span', null, 'Verbunden – wird geteilt'));
    } else if (Store.isLocalOnly()) {
      dot.appendChild(App.icon('eyeOff', 16));
      dot.appendChild(App.el('span', null, 'Sync aus – nur dieses Gerät'));
    } else {
      dot.classList.add('warn');
      dot.appendChild(App.icon('cloud', 16));
      dot.appendChild(App.el('span', null, sync.error || 'Nicht verbunden'));
    }
    statusRow.appendChild(dot);
    syncCard.appendChild(statusRow);

    var syncToggleRow = App.el('label', 'kv-row switch-row');
    syncToggleRow.appendChild(App.el('span', null, 'Liste mit Partner teilen'));
    var sw = App.el('label', 'switch');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !Store.isLocalOnly();
    cb.addEventListener('change', function () {
      Store.setLocalOnly(!cb.checked).then(function () {
        if (!cb.checked) {
          App.toast('Sync ausgeschaltet');
        } else if (Store.getMode() === 'cloud') {
          App.toast('Sync aktiviert');
        } else {
          App.toast(Store.syncStatus().error || 'Sync nicht möglich');
        }
        render(container);
      });
    });
    sw.appendChild(cb);
    sw.appendChild(App.el('span', 'switch-track'));
    syncToggleRow.appendChild(sw);
    syncCard.appendChild(syncToggleRow);

    syncCard.appendChild(App.el('div', 'card-hint',
      'Beide Handys öffnen dieselbe Adresse und teilen sich automatisch denselben Stand. Kostenlos über euer Firebase-Projekt.'));
    view.appendChild(syncCard);

    /* ---- Darstellung ---- */
    var themeCard = card('Darstellung');
    var seg = App.el('div', 'segmented');
    [['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']].forEach(function (o) {
      var b = App.el('button', 'segment' + (App.getTheme() === o[0] ? ' active' : ''), o[1]);
      b.type = 'button';
      b.addEventListener('click', function () { App.setTheme(o[0]); render(container); });
      seg.appendChild(b);
    });
    themeCard.appendChild(seg);
    view.appendChild(themeCard);

    /* ---- Daten ---- */
    var items = Store.getItems();
    var s = Sales.summary(items);
    var dataCard = card('Daten');
    dataCard.appendChild(kv('Objekte gesamt', String(s.total)));
    dataCard.appendChild(kv('Verkauft', String(s.soldCount)));
    dataCard.appendChild(kv('Eingenommen', App.fmtEUR(s.earned), 'pos'));

    var exportBtn = App.el('button', 'btn btn-secondary', 'Daten exportieren (Backup)');
    exportBtn.type = 'button';
    exportBtn.style.marginTop = '12px';
    exportBtn.appendChild(App.icon('download', 15));
    exportBtn.addEventListener('click', function () {
      try {
        var payload = { exportedAt: new Date().toISOString(), items: Store.getItems() };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'moebelverkauf-backup.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        App.toast('Backup erstellt ✓');
      } catch (e) {
        App.toast('Export nicht möglich');
      }
    });
    dataCard.appendChild(exportBtn);

    if (s.total > 0) {
      var copyBtn = App.el('button', 'btn btn-secondary', 'Liste als Text kopieren');
      copyBtn.type = 'button';
      copyBtn.style.marginTop = '10px';
      copyBtn.appendChild(App.icon('copy', 15));
      copyBtn.addEventListener('click', function () {
        var text = summaryText(Store.getItems(), s);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { App.toast('Liste kopiert ✓'); })
            .catch(function () { App.toast('Kopieren nicht möglich'); });
        } else { App.toast('Kopieren nicht möglich'); }
      });
      dataCard.appendChild(copyBtn);
    }

    if (s.total > 0) {
      var clearBtn = App.el('button', 'btn btn-destructive', 'Alle Objekte löschen');
      clearBtn.type = 'button';
      clearBtn.style.marginTop = '10px';
      clearBtn.addEventListener('click', function () {
        App.confirm({
          title: 'Wirklich alles löschen?',
          message: 'Alle ' + s.total + ' Objekte werden auf beiden Geräten entfernt. Das lässt sich nicht rückgängig machen.',
          confirmText: 'Alles löschen',
          cancelText: 'Abbrechen',
          destructive: true
        }).then(function (ok) {
          if (!ok) return;
          Store.clearAllItems();
          App.toast('Alles gelöscht');
          render(container);
        });
      });
      dataCard.appendChild(clearBtn);
    }
    view.appendChild(dataCard);

    /* ---- Über ---- */
    var about = card('Über die App');
    about.appendChild(App.el('div', 'card-hint',
      'Möbelverkauf – eure gemeinsame Übersicht beim Umzug. Tragt ein, was raus soll, zu welchem Wunschpreis, und was am Ende tatsächlich dabei rumgekommen ist. Alles wird zwischen euren beiden Handys synchronisiert.'));
    view.appendChild(about);

    container.appendChild(view);
  }

  Views.settings = { title: 'Mehr', render: render };
})();
