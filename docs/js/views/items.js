/* ============================================================
   Möbelverkauf — js/views/items.js
   Views.items ("Objekte"): schlanke Liste aller Verkaufsobjekte mit
   Kopfzeile (eingenommen + Anzahl), Suche, drei Status-Filtern,
   Ein-Tap-Verkauf und einem reduzierten Anlegen-/Bearbeiten-Sheet.
   ============================================================ */
(function () {
  'use strict';

  var Views = window.Views = window.Views || {};

  // Drei einfache Filter. Default: nur aktive (noch zu verkaufende) Objekte.
  var SCOPES = [
    { key: 'aktiv', label: 'Aktiv', match: function (it) { return it.status === 'offen' || it.status === 'reserviert'; } },
    { key: 'verkauft', label: 'Verkauft', match: function (it) { return it.status === 'verkauft'; } },
    { key: 'alle', label: 'Alle', match: function () { return true; } }
  ];

  var filterState = { query: '', scope: 'aktiv' };

  // -------- Formatierungs-Helfer

  // Zahl ohne Währungszeichen ("1.200")
  function plain(n) { return App.fmtEUR(n).replace(/\s?€/, ''); }

  // Preis-Spanne als Text: "80–120 €", "120 €", "ab 80 €" oder null.
  function rangeText(lo, hi) {
    if (lo != null && hi != null) return (lo === hi) ? App.fmtEUR(lo) : (plain(lo) + '–' + App.fmtEUR(hi));
    if (hi != null) return App.fmtEUR(hi);
    if (lo != null) return 'ab ' + App.fmtEUR(lo);
    return null;
  }

  // -------- Liste

  function applyFilter(items) {
    var scope = SCOPES.find(function (s) { return s.key === filterState.scope; }) || SCOPES[0];
    var q = filterState.query.trim().toLowerCase();
    var out = items.filter(function (it) {
      if (!scope.match(it)) return false;
      if (q) {
        var hay = (it.name + ' ' + it.buyer).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    // Feste Sortierung: Verkauftes nach Verkaufsdatum, sonst nach Anlagedatum.
    if (filterState.scope === 'verkauft') {
      out.sort(function (a, b) { return (b.soldAt || b.updatedAt || '').localeCompare(a.soldAt || a.updatedAt || ''); });
    } else {
      out.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    }
    return out;
  }

  function statusPill(status) {
    var s = Catalog.status(status);
    return App.el('span', 'status-pill ' + s.cls, s.short);
  }

  function priceNumber(it) {
    if (it.status === 'verkauft') return it.soldPrice != null ? it.soldPrice : null;
    if (it.status === 'offen' || it.status === 'reserviert') return it.wishPrice != null ? it.wishPrice : it.minPrice;
    return null;
  }

  function wishNumber(it) {
    return it.wishPrice != null ? it.wishPrice : it.minPrice;
  }

  function sumVisible(items) {
    return items.reduce(function (acc, it) {
      var value = priceNumber(it);
      var wish = wishNumber(it);
      if (value != null) {
        acc.value += value;
        acc.wish += wish != null ? wish : 0;
      } else {
        acc.withoutPrice++;
      }
      return acc;
    }, { value: 0, wish: 0, withoutPrice: 0 });
  }

  function sumLabel() {
    if (filterState.query.trim()) return 'Summe Treffer';
    if (filterState.scope === 'verkauft') return 'Erlös verkauft';
    if (filterState.scope === 'alle') return 'Aktueller Wert';
    return 'Summe aktiv';
  }

  function priceEl(it) {
    var wrap = App.el('div', 'price-stack');

    if (it.status === 'verkauft') {
      var v = it.soldPrice != null ? it.soldPrice : it.wishPrice;
      if (v != null) wrap.appendChild(App.el('span', 'item-price amount-pos', App.fmtEUR(v)));
      else wrap.appendChild(App.el('span', 'item-price-muted', 'Preis offen'));

      if (it.soldPrice != null && it.wishPrice != null && it.soldPrice !== it.wishPrice) {
        var diff = it.soldPrice - it.wishPrice;
        var note = (diff > 0 ? '+' : '−') + App.fmtEUR(Math.abs(diff)) + ' zum Wunsch';
        wrap.appendChild(App.el('span', 'price-note ' + (diff > 0 ? 'pos' : 'neg'), note));
      } else if (it.soldPrice == null && it.wishPrice != null) {
        wrap.appendChild(App.el('span', 'price-note', 'Wunschpreis'));
      }
      return wrap;
    }
    if (it.status === 'offen' || it.status === 'reserviert') {
      if (it.wishPrice != null) {
        wrap.appendChild(App.el('span', 'item-price', App.fmtEUR(it.wishPrice)));
        return wrap;
      }
      if (it.minPrice != null) {
        wrap.appendChild(App.el('span', 'item-price', 'ab ' + App.fmtEUR(it.minPrice)));
        return wrap;
      }
      return App.el('span', 'item-price-muted', 'Preis offen');
    }
    return App.el('span', 'item-price-muted', '—');
  }

  function thumb(it) {
    if (it.photo) {
      var wrap = App.el('div', 'item-thumb');
      var img = document.createElement('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = it.photo;
      img.addEventListener('error', function () { wrap.innerHTML = ''; wrap.appendChild(App.catIcon(Catalog.category(it.category))); });
      wrap.appendChild(img);
      return wrap;
    }
    return App.catIcon(Catalog.category(it.category));
  }

  function itemRow(it) {
    var row = App.el('div', 'list-row item-row');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;

    row.appendChild(thumb(it));

    var main = App.el('div', 'row-main');
    main.appendChild(App.el('div', 'row-title', it.name || 'Ohne Namen'));
    row.appendChild(main);

    var trailing = App.el('div', 'row-trailing');
    trailing.appendChild(priceEl(it));
    trailing.appendChild(statusPill(it.status));
    row.appendChild(trailing);

    // Ein-Tap-Verkauf nur für noch aktive Objekte
    if (it.status === 'offen' || it.status === 'reserviert') {
      var sell = App.el('button', 'row-sell-btn');
      sell.type = 'button';
      sell.setAttribute('aria-label', 'Als verkauft eintragen');
      sell.title = 'Als verkauft eintragen';
      sell.appendChild(App.icon('check', 18));
      sell.addEventListener('click', function (e) { e.stopPropagation(); sellQuick(it); });
      row.appendChild(sell);
    }

    row.addEventListener('click', function () { openEditor(it); });
    return row;
  }

  // -------- Ein-Tap-Verkauf (ein einziges Feld: der Erlös)

  function sellQuick(it) {
    var c = App.el('div', 'sell-quick');
    c.appendChild(App.el('p', 'info-p', 'Was habt ihr für „' + (it.name || 'das Objekt') + '" bekommen?'));

    var g = App.el('div', 'form-group');
    g.appendChild(App.el('label', 'form-label', 'Tatsächlicher Erlös (€)'));
    var input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.className = 'input';
    input.placeholder = 'z. B. ' + (it.wishPrice != null ? it.wishPrice : '50');
    if (it.wishPrice != null) input.value = String(it.wishPrice).replace('.', ',');
    g.appendChild(input);
    c.appendChild(g);

    var save = App.el('button', 'btn btn-primary', 'Als verkauft eintragen');
    save.type = 'button';
    save.addEventListener('click', function () {
      Store.updateItem(it.id, { status: 'verkauft', soldPrice: App.parseNum(input.value) });
      App.closeSheet();
      App.toast('Verkauft ✓');
    });
    c.appendChild(save);

    if (it.wishPrice != null) {
      var wish = App.el('button', 'btn btn-secondary', 'Zum Wunschpreis (' + App.fmtEUR(it.wishPrice) + ')');
      wish.type = 'button';
      wish.style.marginTop = '10px';
      wish.addEventListener('click', function () {
        Store.updateItem(it.id, { status: 'verkauft', soldPrice: it.wishPrice });
        App.closeSheet();
        App.toast('Verkauft ✓');
      });
      c.appendChild(wish);
    }

    App.showSheet({ title: 'Verkauft eintragen', content: c });
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 250);
  }

  // -------- Foto einlesen & komprimieren (data-URL, gratis in Firestore)

  function compressPhoto(file, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(null); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null); };
      img.onload = function () {
        var max = 1024;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * scale));
        var ch = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
        var q = 0.72;
        var data;
        try { data = canvas.toDataURL('image/jpeg', q); } catch (e) { cb(null); return; }
        while (data.length > 400000 && q > 0.4) { q -= 0.12; data = canvas.toDataURL('image/jpeg', q); }
        cb(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // -------- Anlegen & Bearbeiten (reduziertes Sheet)

  function openEditor(existing) {
    var isEdit = !!existing;
    var draft = existing
      ? Object.assign({}, existing)
      : { name: '', wishPrice: null, minPrice: null, soldPrice: null, status: 'offen', buyer: '', note: '', photo: '' };

    var c = App.el('div', 'editor');

    /* Name */
    var nameGroup = App.el('div', 'form-group');
    nameGroup.appendChild(App.el('label', 'form-label', 'Was wird verkauft?'));
    var nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.className = 'input';
    nameInput.placeholder = 'z. B. Esstisch, Sofa, Waschmaschine …';
    nameInput.value = draft.name;
    nameInput.setAttribute('autocapitalize', 'sentences');
    nameInput.addEventListener('input', function () { draft.name = nameInput.value; });
    nameGroup.appendChild(nameInput);
    c.appendChild(nameGroup);

    /* Preise: Wunschpreis + optionale Untergrenze */
    var priceRow = App.el('div', 'form-row');

    var wishGroup = App.el('div', 'form-group');
    wishGroup.appendChild(App.el('label', 'form-label', 'Wunschpreis (€)'));
    var wishInput = document.createElement('input');
    wishInput.type = 'text'; wishInput.inputMode = 'decimal'; wishInput.className = 'input';
    wishInput.placeholder = 'z. B. 120';
    wishInput.value = draft.wishPrice != null ? String(draft.wishPrice).replace('.', ',') : '';
    wishInput.addEventListener('input', function () { draft.wishPrice = App.parseNum(wishInput.value); });
    wishGroup.appendChild(wishInput);
    priceRow.appendChild(wishGroup);

    var minGroup = App.el('div', 'form-group');
    minGroup.appendChild(App.el('label', 'form-label', 'Mindestpreis (optional)'));
    var minInput = document.createElement('input');
    minInput.type = 'text'; minInput.inputMode = 'decimal'; minInput.className = 'input';
    minInput.placeholder = 'nur wenn wichtig';
    minInput.value = draft.minPrice != null ? String(draft.minPrice).replace('.', ',') : '';
    minInput.addEventListener('input', function () { draft.minPrice = App.parseNum(minInput.value); });
    minGroup.appendChild(minInput);
    priceRow.appendChild(minGroup);

    c.appendChild(priceRow);

    /* Status */
    var statusGroup = App.el('div', 'form-group');
    statusGroup.appendChild(App.el('label', 'form-label', 'Status'));
    var statusRow = App.el('div', 'chip-row chip-row-wrap');
    var statusButtons = [];
    var soldGroup; // Vorwärts-Referenz
    Catalog.statuses.forEach(function (s) {
      var chip = App.el('button', 'chip status-chip-opt ' + s.cls + (draft.status === s.key ? ' active' : ''), s.label);
      chip.type = 'button';
      chip.dataset.key = s.key;
      chip.addEventListener('click', function () {
        draft.status = s.key;
        statusButtons.forEach(function (b) { b.classList.toggle('active', b.dataset.key === s.key); });
        if (soldGroup) soldGroup.classList.toggle('is-hidden', s.key !== 'verkauft');
        if (s.key === 'verkauft' && draft.soldPrice == null && draft.wishPrice != null) {
          draft.soldPrice = draft.wishPrice;
          soldInput.value = String(draft.wishPrice).replace('.', ',');
        }
      });
      statusButtons.push(chip);
      statusRow.appendChild(chip);
    });
    statusGroup.appendChild(statusRow);
    c.appendChild(statusGroup);

    /* Bei "verkauft": Erlös + Käufer */
    soldGroup = App.el('div', 'sold-group' + (draft.status === 'verkauft' ? '' : ' is-hidden'));

    var soldFieldGroup = App.el('div', 'form-group');
    soldFieldGroup.appendChild(App.el('label', 'form-label', 'Tatsächlich erzielt (€)'));
    var soldInput = document.createElement('input');
    soldInput.type = 'text'; soldInput.inputMode = 'decimal'; soldInput.className = 'input';
    soldInput.placeholder = 'z. B. 100';
    soldInput.value = draft.soldPrice != null ? String(draft.soldPrice).replace('.', ',') : '';
    soldInput.addEventListener('input', function () { draft.soldPrice = App.parseNum(soldInput.value); });
    soldFieldGroup.appendChild(soldInput);
    soldGroup.appendChild(soldFieldGroup);

    var buyerGroup = App.el('div', 'form-group');
    buyerGroup.appendChild(App.el('label', 'form-label', 'Käufer (optional)'));
    var buyerInput = document.createElement('input');
    buyerInput.type = 'text'; buyerInput.className = 'input';
    buyerInput.placeholder = 'Name oder Notiz zum Käufer';
    buyerInput.value = draft.buyer;
    buyerInput.addEventListener('input', function () { draft.buyer = buyerInput.value; });
    buyerGroup.appendChild(buyerInput);
    soldGroup.appendChild(buyerGroup);

    c.appendChild(soldGroup);

    /* Notiz */
    var noteGroup = App.el('div', 'form-group');
    noteGroup.appendChild(App.el('label', 'form-label', 'Notiz (optional)'));
    var noteInput = document.createElement('textarea');
    noteInput.className = 'input';
    noteInput.placeholder = 'z. B. „kleiner Kratzer", „inkl. Schrauben", „abholbereit" …';
    noteInput.style.minHeight = '64px';
    noteInput.style.fontFamily = 'inherit';
    noteInput.style.fontSize = '15px';
    noteInput.value = draft.note;
    noteInput.addEventListener('input', function () { draft.note = noteInput.value; });
    noteGroup.appendChild(noteInput);
    c.appendChild(noteGroup);

    /* Foto (optional, am Ende) */
    var photoGroup = App.el('div', 'form-group');
    var photoWrap = App.el('div', 'photo-edit');
    function renderPhoto() {
      photoWrap.innerHTML = '';
      if (draft.photo) {
        var img = document.createElement('img');
        img.className = 'photo-edit-img'; img.src = draft.photo; img.alt = '';
        photoWrap.appendChild(img);
        var rm = App.el('button', 'photo-edit-remove'); rm.type = 'button';
        rm.setAttribute('aria-label', 'Foto entfernen');
        rm.appendChild(App.icon('x', 16));
        rm.addEventListener('click', function (e) { e.stopPropagation(); draft.photo = ''; renderPhoto(); });
        photoWrap.appendChild(rm);
      } else {
        var ph = App.el('div', 'photo-edit-placeholder');
        ph.appendChild(App.icon('camera', 24));
        ph.appendChild(App.el('span', null, 'Foto hinzufügen (optional)'));
        photoWrap.appendChild(ph);
      }
    }
    var fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*';
    fileInput.setAttribute('capture', 'environment');
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      App.toast('Foto wird verarbeitet …');
      compressPhoto(f, function (data) {
        fileInput.value = '';
        if (!data) { App.toast('Foto konnte nicht geladen werden'); return; }
        draft.photo = data; renderPhoto();
      });
    });
    photoWrap.addEventListener('click', function () { fileInput.click(); });
    renderPhoto();
    photoGroup.appendChild(photoWrap);
    photoGroup.appendChild(fileInput);
    c.appendChild(photoGroup);

    /* Speichern */
    var save = App.el('button', 'btn btn-primary', isEdit ? 'Änderungen speichern' : 'Objekt hinzufügen');
    save.type = 'button';
    save.style.marginTop = '6px';
    save.addEventListener('click', function () {
      if (!draft.name.trim()) { App.toast('Bitte einen Namen eingeben'); nameInput.focus(); return; }
      var data = {
        name: draft.name.trim(),
        wishPrice: draft.wishPrice,
        minPrice: draft.minPrice,
        soldPrice: draft.soldPrice,
        status: draft.status,
        buyer: draft.buyer.trim(),
        note: draft.note.trim(),
        photo: draft.photo
      };
      if (isEdit) { Store.updateItem(existing.id, data); App.toast('Gespeichert ✓'); }
      else { Store.addItem(data); App.toast('Hinzugefügt ✓'); }
      App.closeSheet();
    });
    c.appendChild(save);

    /* Löschen (nur Bearbeiten) */
    if (isEdit) {
      var del = App.el('button', 'btn btn-destructive', 'Objekt löschen');
      del.type = 'button';
      del.style.marginTop = '10px';
      del.addEventListener('click', function () {
        App.confirm({
          title: 'Objekt löschen?',
          message: '„' + (existing.name || 'Dieses Objekt') + '" wird entfernt.',
          confirmText: 'Löschen', cancelText: 'Abbrechen', destructive: true
        }).then(function (ok) {
          if (!ok) return;
          Store.deleteItem(existing.id);
          App.closeSheet();
          App.toast('Gelöscht');
        });
      });
      c.appendChild(del);
    }

    App.showSheet({ title: isEdit ? 'Objekt bearbeiten' : 'Neues Objekt', content: c });
    if (!isEdit) setTimeout(function () { try { nameInput.focus(); } catch (e) {} }, 250);
  }

  // -------- die Ansicht

  var activeRenderList = null;
  var heroAmount = null, heroSub = null, heroExtra = null;

  function updateHero() {
    if (!heroAmount) return;
    var s = Sales.summary(Store.getItems());
    heroAmount.textContent = App.fmtEUR(s.earned);
    heroSub.textContent = s.total + (s.total === 1 ? ' Objekt' : ' Objekte') + ' · ' + s.soldCount + ' verkauft';
    if (s.expectedMax > 0) {
      heroExtra.textContent = 'noch ' + rangeText(s.expectedMin, s.expectedMax) + ' erwartet';
      heroExtra.classList.remove('is-hidden');
    } else {
      heroExtra.classList.add('is-hidden');
    }
  }

  function render(container) {
    container.innerHTML = '';
    var view = App.el('div', 'view');

    // Kopfzeile: eingenommen + Anzahl (ersetzt das frühere Dashboard)
    var hero = App.el('div', 'card hero-card list-hero');
    hero.appendChild(App.el('div', 'card-title', 'Eingenommen'));
    heroAmount = App.el('div', 'hero-amount', '0 €');
    hero.appendChild(heroAmount);
    heroSub = App.el('div', 'hero-sub', '');
    hero.appendChild(heroSub);
    heroExtra = App.el('div', 'hero-sub is-hidden', '');
    hero.appendChild(heroExtra);
    view.appendChild(hero);

    // Suche
    var search = App.el('div', 'searchbar');
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Suchen (Name, Käufer …)';
    input.value = filterState.query;
    input.addEventListener('input', function () { filterState.query = input.value; renderList(); });
    search.appendChild(input);
    view.appendChild(search);

    // Filter-Chips
    var chips = App.el('div', 'chip-row');
    SCOPES.forEach(function (s) {
      var chip = App.el('button', 'chip' + (filterState.scope === s.key ? ' active' : ''), s.label);
      chip.type = 'button';
      chip.addEventListener('click', function () { filterState.scope = s.key; render(container); });
      chips.appendChild(chip);
    });
    view.appendChild(chips);

    var sortRow = App.el('div', 'sort-row');
    var info = App.el('span', 'sort-info', '');
    sortRow.appendChild(info);
    view.appendChild(sortRow);

    var listTotal = App.el('div', 'list-total');
    var totalLabel = App.el('div', 'list-total-label', '');
    var totalValue = App.el('div', 'list-total-value', '0 €');
    var totalNote = App.el('div', 'list-total-note', '');
    listTotal.appendChild(totalLabel);
    listTotal.appendChild(totalValue);
    listTotal.appendChild(totalNote);
    view.appendChild(listTotal);

    var listWrap = App.el('div', 'item-list');
    view.appendChild(listWrap);
    container.appendChild(view);

    function renderList() {
      updateHero();
      listWrap.innerHTML = '';
      var all = Store.getItems();
      var filtered = applyFilter(all);
      info.textContent = filtered.length + (filtered.length === 1 ? ' Objekt' : ' Objekte');
      var totals = sumVisible(filtered);
      var diff = totals.value - totals.wish;
      totalLabel.textContent = sumLabel();
      totalValue.textContent = App.fmtEUR(totals.value);
      totalNote.className = 'list-total-note';
      if (filtered.length === 0) {
        totalNote.textContent = 'Keine Einträge in dieser Auswahl';
      } else if (diff !== 0) {
        totalNote.textContent = (diff > 0 ? '+' : '−') + App.fmtEUR(Math.abs(diff)) + ' zum Wunschpreis';
        totalNote.classList.add(diff > 0 ? 'pos' : 'neg');
      } else if (totals.withoutPrice > 0) {
        totalNote.textContent = totals.withoutPrice + (totals.withoutPrice === 1 ? ' Eintrag ohne Preis' : ' Einträge ohne Preis');
      } else {
        totalNote.textContent = 'entspricht den Wunschpreisen';
      }

      if (!all.length) {
        listWrap.appendChild(emptyState('box', 'Noch nichts erfasst',
          'Tippe unten auf „+" und trage das erste Stück ein, das ihr verkaufen wollt.'));
        return;
      }
      if (!filtered.length) {
        listWrap.appendChild(emptyState('filter', 'Nichts gefunden',
          'Für diesen Filter gibt es gerade keine Objekte. Wechsle auf „Alle" oder ändere die Suche.'));
        return;
      }

      var group = App.el('div', 'list-group');
      filtered.forEach(function (it) { group.appendChild(itemRow(it)); });
      listWrap.appendChild(group);
    }

    activeRenderList = renderList;
    renderList();
  }

  function update() {
    if (typeof activeRenderList !== 'function') return false;
    var listWrap = document.querySelector('#view-root .item-list');
    if (!listWrap || !document.body.contains(listWrap)) return false;
    activeRenderList();
    return true;
  }

  function emptyState(icon, title, text) {
    var e = App.el('div', 'empty-state');
    e.appendChild(App.icon(icon, 44));
    e.appendChild(App.el('div', 'empty-title', title));
    e.appendChild(App.el('div', null, text));
    return e;
  }

  Views.items = {
    title: 'Objekte',
    render: render,
    update: update,
    openEditor: openEditor,
    emptyState: emptyState
  };
})();
