/* ============================================================
   Wohnungssuche — js/views/settings.js
   Views.settings ("Mehr"): sync status, member names, appearance,
   feed refresh, notification link, info.
   ============================================================ */
(function () {
  'use strict';

  var Views = window.Views = window.Views || {};

  function card(title) {
    var c = App.el('div', 'card');
    if (title) c.appendChild(App.el('div', 'card-title', title));
    return c;
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
      dot.appendChild(App.el('span', null, 'Verbunden – Bewertungen werden geteilt'));
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
    syncToggleRow.appendChild(App.el('span', null, 'Bewertungen mit Partner teilen'));
    var sw = App.el('label', 'switch');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !Store.isLocalOnly();
    cb.addEventListener('change', function () {
      Store.setLocalOnly(!cb.checked).then(function () {
        App.toast(cb.checked ? 'Sync aktiviert' : 'Sync ausgeschaltet');
        render(container);
      });
    });
    sw.appendChild(cb);
    sw.appendChild(App.el('span', 'switch-track'));
    syncToggleRow.appendChild(sw);
    syncCard.appendChild(syncToggleRow);

    var hint = App.el('div', 'card-hint',
      'Beide Geräte öffnen dieselbe Adresse und teilen sich automatisch denselben Stand. Kostenlos über euer Firebase-Projekt.');
    syncCard.appendChild(hint);
    view.appendChild(syncCard);

    /* ---- Names ---- */
    var nameCard = card('Wer bewertet?');
    Store.getSettings().members.forEach(function (m) {
      var g = App.el('div', 'form-group');
      var lbl = App.el('label', 'form-label');
      var d = App.el('span', 'person-dot'); d.style.background = m.color; d.style.display = 'inline-block'; d.style.marginRight = '6px';
      lbl.appendChild(d);
      lbl.appendChild(document.createTextNode(m.id === 'p1' ? 'Du' : 'Partner/in'));
      g.appendChild(lbl);
      var inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'input'; inp.value = m.name; inp.placeholder = 'Vorname';
      inp.setAttribute('autocapitalize', 'words');
      inp.addEventListener('change', function () {
        var patch = { members: [{ id: m.id, name: inp.value.trim() }] };
        Store.updateSettings(patch);
        App.toast('Name gespeichert');
      });
      g.appendChild(inp);
      nameCard.appendChild(g);
    });
    view.appendChild(nameCard);

    /* ---- Appearance ---- */
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

    /* ---- Feed / data ---- */
    var meta = Feed.getMeta();
    var dataCard = card('Wohnungs-Daten');
    var c = meta.counts || {};
    dataCard.appendChild(kv('Wohnungen im Feed', String(c.total != null ? c.total : Feed.getListings().length)));
    dataCard.appendChild(kv('Davon „Passt"', String(c.match != null ? c.match : '–')));
    dataCard.appendChild(kv('Zuletzt aktualisiert', meta.generated_at ? App.fmtDateTime(meta.generated_at) : 'unbekannt'));
    if (meta.lastError) dataCard.appendChild(kv('Hinweis', 'Letzter Abruf fehlgeschlagen', 'warn'));
    var refresh = App.el('button', 'btn btn-secondary', 'Jetzt aktualisieren');
    refresh.type = 'button';
    refresh.style.marginTop = '10px';
    refresh.addEventListener('click', function () {
      refresh.disabled = true;
      refresh.textContent = 'Aktualisiere …';
      Feed.refresh().then(function (changed) {
        App.toast(changed ? 'Neue Daten geladen' : 'Bereits aktuell');
        render(container);
      });
    });
    dataCard.appendChild(refresh);
    var critHint = App.el('div', 'card-hint', criteriaText(meta.criteria));
    dataCard.appendChild(critHint);
    view.appendChild(dataCard);

    /* ---- Notifications ---- */
    var noteCard = card('Benachrichtigungen');
    noteCard.appendChild(App.el('div', 'card-hint',
      'Neue Wohnungen meldet GitHub weiterhin per Push (Issue „Neue Wohnungsangebote"). Aktiviere dafür GitHub-Mobile-Benachrichtigungen für das Repository.'));
    var repo = (window.WS_CONFIG && WS_CONFIG.issueRepo) || '';
    if (repo) {
      var link = App.el('a', 'btn btn-secondary', 'GitHub-Issue öffnen');
      link.href = 'https://github.com/' + repo + '/issues';
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.style.marginTop = '10px';
      link.appendChild(App.icon('external', 15));
      noteCard.appendChild(link);
    }
    view.appendChild(noteCard);

    /* ---- About ---- */
    var about = card('Über die App');
    about.appendChild(App.el('div', 'card-hint',
      'Wohnungssuche rund um Barsinghausen und Umgebung. Die Wohnungsliste wird automatisch mehrmals täglich von GitHub aktualisiert; eure Bewertungen und Notizen werden zwischen euch synchronisiert.'));
    view.appendChild(about);

    container.appendChild(view);
  }

  function kv(label, value, tone) {
    var row = App.el('div', 'kv-row');
    row.appendChild(App.el('span', null, label));
    row.appendChild(App.el('span', 'kv-value' + (tone ? ' tone-' + tone : ''), value));
    return row;
  }

  function criteriaText(crit) {
    crit = crit || {};
    var parts = [];
    if (crit.min_rooms) parts.push('ab ' + crit.min_rooms + ' Zimmer');
    if (crit.min_area_sqm) parts.push('ab ' + crit.min_area_sqm + ' m²');
    if (crit.max_total_rent_eur) parts.push('bis ' + crit.max_total_rent_eur + ' €');
    return parts.length ? 'Suchkriterien: ' + parts.join(', ') + '.' : '';
  }

  Views.settings = { title: 'Mehr', render: render };
})();
