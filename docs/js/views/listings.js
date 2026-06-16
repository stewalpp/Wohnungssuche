/* ============================================================
   Wohnungssuche — js/views/listings.js
   Views.listings: the main feed of apartments with filter chips,
   per-person ratings, favourites and a detail sheet.
   ============================================================ */
(function () {
  'use strict';

  var Views = window.Views = window.Views || {};

  var RATING_CHOICES = [
    { key: 'gut', label: 'Gut', icon: 'thumbsUp' },
    { key: 'vielleicht', label: 'Vielleicht', icon: 'meh' },
    { key: 'schlecht', label: 'Schlecht', icon: 'thumbsDown' }
  ];

  var SCOPES = [
    { key: 'alle', label: 'Alle' },
    { key: 'neu', label: 'Neu' },
    { key: 'match', label: 'Passt' },
    { key: 'review', label: 'Etage prüfen' },
    { key: 'favoriten', label: 'Favoriten' }
  ];

  var STATUS_OPTIONS = [
    { key: '', label: 'Offen', cls: 's-offen' },
    { key: 'angefragt', label: 'Angefragt', cls: 's-angefragt' },
    { key: 'besichtigung', label: 'Besichtigung', cls: 's-besichtigung' },
    { key: 'zusage', label: 'Zusage', cls: 's-zusage' },
    { key: 'absage', label: 'Absage', cls: 's-absage' }
  ];

  function statusLabel(key) {
    for (var i = 0; i < STATUS_OPTIONS.length; i++) if (STATUS_OPTIONS[i].key === key) return STATUS_OPTIONS[i].label;
    return '';
  }

  function statusChip(listing) {
    var status = Store.getRating(listing.id).status;
    if (!status) return null;
    var chip = App.el('span', 'status-chip status-' + status);
    chip.appendChild(App.el('span', 'dot'));
    chip.appendChild(App.el('span', null, statusLabel(status)));
    return chip;
  }

  // -------- helpers

  function newIdSet() {
    var set = new Set();
    Feed.getListings().forEach(function (l) {
      if (App.isNew(l)) set.add(l.id);
    });
    return set;
  }

  function metaText(l) {
    var parts = [App.fmtEUR(l.price_eur)];
    var rooms = App.fmtRooms(l.rooms); if (rooms) parts.push(rooms);
    var area = App.fmtArea(l.area_sqm); if (area) parts.push(area);
    if (l.floor) parts.push(l.floor);
    return parts.join(' · ');
  }

  // compact per-person rating control
  function ratingRow(listing, personId) {
    var rating = Store.getRating(listing.id);
    var row = App.el('div', 'rating-person');
    var dot = App.el('span', 'person-dot');
    dot.style.background = Store.memberColor(personId);
    var name = App.el('span', 'person-name', Store.memberName(personId));
    var label = App.el('div', 'rating-person-label');
    label.appendChild(dot);
    label.appendChild(name);
    row.appendChild(label);

    var seg = App.el('div', 'rating-seg');
    var optButtons = [];
    RATING_CHOICES.forEach(function (c) {
      var btn = App.el('button', 'rating-opt' + (rating[personId] === c.key ? ' active v-' + c.key : ''));
      btn.type = 'button';
      btn.dataset.key = c.key;
      btn.setAttribute('aria-label', Store.memberName(personId) + ': ' + c.label);
      btn.appendChild(App.icon(c.icon, 17));
      btn.appendChild(App.el('span', null, c.label));
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        Store.setPersonRating(listing.id, personId, c.key);
        // Reflect the change immediately, even inside the detail sheet (which
        // App.rerender does not touch).
        var cur = Store.getRating(listing.id)[personId];
        optButtons.forEach(function (b) {
          b.className = 'rating-opt' + (cur === b.dataset.key ? ' active v-' + b.dataset.key : '');
        });
      });
      optButtons.push(btn);
      seg.appendChild(btn);
    });
    row.appendChild(seg);
    return row;
  }

  function bothGood(listing) {
    var r = Store.getRating(listing.id);
    return r.p1 === 'gut' && r.p2 === 'gut';
  }

  function favButton(listing) {
    var r = Store.getRating(listing.id);
    var btn = App.el('button', 'fav-btn' + (r.favorite ? ' active' : ''));
    btn.type = 'button';
    btn.setAttribute('aria-label', r.favorite ? 'Favorit entfernen' : 'Als Favorit merken');
    btn.appendChild(App.icon('star', 22));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      Store.toggleFavorite(listing.id);
    });
    return btn;
  }

  function statusBadge(listing) {
    if (listing.status === 'review') {
      var b = App.el('span', 'badge badge-orange', 'Etage prüfen');
      return b;
    }
    return App.el('span', 'badge badge-green', 'Passt');
  }

  // Fill a .listing-image wrapper with the photo (lazy) or a house placeholder;
  // falls back to the placeholder if the image fails to load (hotlink/404).
  function setListingImage(wrap, url) {
    wrap.classList.remove('is-placeholder');
    if (url) {
      var img = document.createElement('img');
      img.className = 'listing-photo';
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
        wrap.classList.add('is-placeholder');
        wrap.insertBefore(App.icon('building', 40), wrap.firstChild);
      });
      wrap.appendChild(img);
    } else {
      wrap.classList.add('is-placeholder');
      wrap.appendChild(App.icon('building', 40));
    }
  }

  // "Inserat öffnen" – a real link only for a validated http(s) URL (Feed already
  // sanitizes it); otherwise a disabled button so a bad/missing URL never becomes
  // a clickable href.
  function openLink(listing, cls) {
    var label = 'Inserat öffnen';
    if (listing.url) {
      var a = App.el('a', cls);
      a.href = listing.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      a.appendChild(App.icon('external', 15));
      a.addEventListener('click', function (e) { e.stopPropagation(); });
      return a;
    }
    var btn = App.el('button', cls + ' is-disabled', 'Kein Link');
    btn.type = 'button';
    btn.disabled = true;
    btn.addEventListener('click', function (e) { e.stopPropagation(); });
    return btn;
  }

  // -------- listing card

  function listingCard(listing, newIds) {
    var card = App.el('div', 'card listing-card');
    if (newIds.has(listing.id)) card.classList.add('is-new');
    if (bothGood(listing)) card.classList.add('both-good');

    var badges = App.el('div', 'listing-badges');
    if (newIds.has(listing.id)) badges.appendChild(App.el('span', 'new-pill', 'NEU'));
    badges.appendChild(statusBadge(listing));
    if (bothGood(listing)) {
      var m = App.el('span', 'badge badge-pink match-badge');
      m.appendChild(App.icon('heart', 12));
      m.appendChild(App.el('span', null, 'Beide: Gut'));
      badges.appendChild(m);
    }

    // photo banner with badges + favourite overlaid
    var imgWrap = App.el('div', 'listing-image');
    setListingImage(imgWrap, listing.image);
    var overlay = App.el('div', 'listing-image-overlay');
    overlay.appendChild(badges);
    overlay.appendChild(favButton(listing));
    imgWrap.appendChild(overlay);
    card.appendChild(imgWrap);

    var title = App.el('div', 'listing-title', listing.title || 'Wohnung');
    card.appendChild(title);

    var price = App.el('div', 'listing-price', App.fmtEUR(listing.price_eur));
    card.appendChild(price);

    var meta = App.el('div', 'listing-meta');
    var sub = [];
    var rooms = App.fmtRooms(listing.rooms); if (rooms) sub.push(rooms);
    var area = App.fmtArea(listing.area_sqm); if (area) sub.push(area);
    if (listing.floor) sub.push(listing.floor);
    meta.textContent = sub.join(' · ') || 'Details im Inserat';
    card.appendChild(meta);

    var loc = App.el('div', 'listing-loc');
    loc.appendChild(App.icon('pin', 14));
    loc.appendChild(App.el('span', null, listing.location || 'Lage im Inserat prüfen'));
    card.appendChild(loc);

    var srcline = App.el('div', 'listing-src');
    srcline.textContent = (listing.source || listing.portal || '') + ' · ' + App.fmtRelTime(listing.first_seen);
    card.appendChild(srcline);

    var sChip = statusChip(listing);
    if (sChip) card.appendChild(sChip);

    // ratings
    var ratings = App.el('div', 'rating-block');
    ratings.appendChild(ratingRow(listing, 'p1'));
    ratings.appendChild(ratingRow(listing, 'p2'));
    card.appendChild(ratings);

    // footer
    var foot = App.el('div', 'listing-foot');
    var open = openLink(listing, 'btn btn-primary btn-small');
    var details = App.el('button', 'btn btn-secondary btn-small', 'Details');
    details.type = 'button';
    details.addEventListener('click', function (e) { e.stopPropagation(); openDetail(listing); });
    foot.appendChild(details);
    foot.appendChild(open);
    card.appendChild(foot);

    // tapping the card body (not a control) opens detail
    card.addEventListener('click', function () { openDetail(listing); });

    return card;
  }

  // -------- detail sheet

  function openDetail(listing) {
    var c = App.el('div', 'detail');

    if (listing.image) {
      var photo = document.createElement('img');
      photo.className = 'detail-photo';
      photo.src = listing.image;
      photo.alt = '';
      photo.loading = 'lazy';
      photo.addEventListener('error', function () { if (photo.parentNode) photo.parentNode.removeChild(photo); });
      c.appendChild(photo);
    }

    var price = App.el('div', 'detail-price', App.fmtEUR(listing.price_eur));
    c.appendChild(price);

    var grid = App.el('div', 'detail-grid');
    addDetail(grid, 'door', App.fmtRooms(listing.rooms) || '–', 'Zimmer');
    addDetail(grid, 'ruler', App.fmtArea(listing.area_sqm) || '–', 'Wohnfläche');
    addDetail(grid, 'layers', listing.floor || 'offen', 'Etage');
    addDetail(grid, 'pin', listing.location || 'prüfen', 'Lage');
    c.appendChild(grid);

    if (listing.reasons && listing.reasons.length) {
      c.appendChild(infoLine('Passt, weil', listing.reasons.join(', '), 'good'));
    }
    if (listing.review_notes && listing.review_notes.length) {
      c.appendChild(infoLine('Bitte prüfen', listing.review_notes.join(', '), 'warn'));
    }
    c.appendChild(infoLine('Quelle', listing.source || listing.portal || '–', null));
    c.appendChild(infoLine('Zuerst gesehen', App.fmtDateTime(listing.first_seen), null));

    // ratings
    var rl = App.el('div', 'section-title', 'Eure Bewertung');
    c.appendChild(rl);
    var rb = App.el('div', 'rating-block detail-rating');
    rb.appendChild(ratingRow(listing, 'p1'));
    rb.appendChild(ratingRow(listing, 'p2'));
    c.appendChild(rb);

    // status (shared)
    c.appendChild(App.el('div', 'section-title', 'Status'));
    var statusSeg = App.el('div', 'status-seg');
    var statusButtons = [];
    STATUS_OPTIONS.forEach(function (s) {
      var cur = Store.getRating(listing.id).status;
      var btn = App.el('button', 'status-opt ' + s.cls + (cur === s.key ? ' active' : ''), s.label);
      btn.type = 'button';
      btn.dataset.key = s.key;
      btn.dataset.cls = s.cls;
      btn.addEventListener('click', function () {
        Store.setStatus(listing.id, s.key);
        var now = Store.getRating(listing.id).status;
        statusButtons.forEach(function (b) {
          b.className = 'status-opt ' + b.dataset.cls + (now === b.dataset.key ? ' active' : '');
        });
      });
      statusButtons.push(btn);
      statusSeg.appendChild(btn);
    });
    c.appendChild(statusSeg);

    // shared note
    c.appendChild(App.el('div', 'section-title', 'Gemeinsame Notiz'));
    var note = document.createElement('textarea');
    note.className = 'input';
    note.placeholder = 'z. B. „Besichtigung angefragt", „zu weit weg" …';
    note.value = Store.getRating(listing.id).note || '';
    note.style.minHeight = '72px';
    note.style.fontFamily = 'inherit';
    note.style.fontSize = '15px';
    var noteTimer = null;
    var lastSavedNote = Store.getRating(listing.id).note || '';
    function saveNote() {
      if (note.value === lastSavedNote) return;       // skip redundant write/sync
      lastSavedNote = note.value;
      Store.setNote(listing.id, note.value);
    }
    note.addEventListener('input', function () {
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(saveNote, 400);
    });
    note.addEventListener('blur', function () {
      if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
      saveNote();
    });
    c.appendChild(note);

    // actions
    var open = openLink(listing, 'btn btn-primary');
    open.style.marginTop = '14px';
    c.appendChild(open);

    var loc = listing.location || '';
    var mapQuery = (loc && !/pr(?:ü|ue)fen/i.test(loc)) ? loc : (window.ListFilter ? ListFilter.townOf(listing) : '');
    if (mapQuery) {
      var mapLink = App.el('a', 'btn btn-secondary');
      mapLink.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(mapQuery);
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.style.marginTop = '10px';
      mapLink.textContent = 'Auf Karte zeigen';
      mapLink.appendChild(App.icon('pin', 15));
      c.appendChild(mapLink);
    }

    var r = Store.getRating(listing.id);
    var hideBtn = App.el('button', 'btn btn-secondary', r.hidden ? 'Wieder einblenden' : 'Ausblenden');
    hideBtn.type = 'button';
    hideBtn.style.marginTop = '10px';
    hideBtn.addEventListener('click', function () {
      Store.setHidden(listing.id, !Store.getRating(listing.id).hidden);
      App.closeSheet();
      App.toast(Store.getRating(listing.id).hidden ? 'Ausgeblendet' : 'Wieder sichtbar');
    });
    c.appendChild(hideBtn);

    App.showSheet({ title: listing.title || 'Wohnung', content: c });
  }

  function addDetail(grid, icon, value, label) {
    var cell = App.el('div', 'detail-cell');
    var top = App.el('div', 'detail-cell-top');
    top.appendChild(App.icon(icon, 16));
    top.appendChild(App.el('span', 'detail-cell-value', value));
    cell.appendChild(top);
    cell.appendChild(App.el('div', 'detail-cell-label', label));
    grid.appendChild(cell);
  }

  function infoLine(label, value, tone) {
    var row = App.el('div', 'detail-info' + (tone ? ' tone-' + tone : ''));
    row.appendChild(App.el('span', 'detail-info-label', label));
    row.appendChild(App.el('span', 'detail-info-value', value));
    return row;
  }

  // -------- the view

  function render(container) {
    container.innerHTML = '';
    var view = App.el('div', 'view');

    var state = ListFilter.getState();

    // search bar
    var search = App.el('div', 'searchbar');
    var input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Suchen (Ort, Titel …)';
    input.value = state.query || '';
    input.addEventListener('input', function () {
      ListFilter.setState({ query: input.value });
      renderList();
    });
    search.appendChild(input);
    view.appendChild(search);

    // scope chips
    var chips = App.el('div', 'chip-row');
    SCOPES.forEach(function (s) {
      var chip = App.el('button', 'chip' + (state.scope === s.key ? ' active' : ''), s.label);
      chip.type = 'button';
      chip.addEventListener('click', function () {
        ListFilter.setState({ scope: s.key });
        render(container);
      });
      chips.appendChild(chip);
    });
    view.appendChild(chips);

    // sort row
    var sortRow = App.el('div', 'sort-row');
    var meta = Feed.getMeta();
    var info = App.el('span', 'sort-info', '');
    sortRow.appendChild(info);
    var sortSel = document.createElement('select');
    sortSel.className = 'sort-select';
    [['neu', 'Neueste zuerst'], ['preis', 'Günstigste zuerst'], ['flaeche', 'Größte zuerst']].forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0]; opt.textContent = o[1];
      if (state.sort === o[0]) opt.selected = true;
      sortSel.appendChild(opt);
    });
    sortSel.addEventListener('change', function () { ListFilter.setState({ sort: sortSel.value }); renderList(); });
    sortRow.appendChild(sortSel);

    var filterBtn = App.el('button', 'sort-filter-btn' + (hasActiveFilters(state) ? ' has-active' : ''));
    filterBtn.type = 'button';
    filterBtn.setAttribute('aria-label', 'Filter');
    filterBtn.appendChild(App.icon('filter', 18));
    filterBtn.addEventListener('click', function () { openFilterSheet(container); });
    sortRow.appendChild(filterBtn);

    view.appendChild(sortRow);

    var listWrap = App.el('div', 'listing-list');
    view.appendChild(listWrap);
    container.appendChild(view);

    function renderList() {
      listWrap.innerHTML = '';

      // Make stale data visible: show a banner when offline or the last fetch failed.
      var fmeta = Feed.getMeta();
      var offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
      if (offline || fmeta.lastError) {
        var banner = App.el('div', 'feed-banner');
        banner.appendChild(App.icon(offline ? 'eyeOff' : 'cloud', 16));
        var txt = offline ? 'Offline – gespeicherte Liste' : 'Aktualisierung fehlgeschlagen – gespeicherte Liste';
        if (fmeta.generated_at) txt += ' · Stand ' + App.fmtRelTime(fmeta.generated_at);
        banner.appendChild(App.el('span', null, txt));
        listWrap.appendChild(banner);
      }

      var newIds = newIdSet();
      var all = Feed.getListings();
      var ratings = Store.getAllRatings();
      var filtered = ListFilter.apply(all, { ratings: ratings, newIds: newIds });

      // Prominent banner for new results since the user last acknowledged.
      var newTotal = App.newCount();
      if (newTotal > 0) {
        var nb = App.el('div', 'new-banner');
        var nbText = App.el('div', 'new-banner-text');
        nbText.appendChild(App.icon('sparkles', 18));
        nbText.appendChild(App.el('span', null,
          newTotal + (newTotal === 1 ? ' neue Wohnung' : ' neue Wohnungen') + ' seit deinem letzten Besuch'));
        nb.appendChild(nbText);
        var ack = App.el('button', 'new-banner-ack', 'Als gesehen markieren');
        ack.type = 'button';
        ack.addEventListener('click', function (e) { e.stopPropagation(); App.markAllSeen(); });
        nb.appendChild(ack);
        listWrap.appendChild(nb);
      }

      info.textContent = filtered.length + (filtered.length === 1 ? ' Wohnung' : ' Wohnungen');

      if (!all.length) {
        listWrap.appendChild(emptyState(
          'building',
          'Noch keine Wohnungen',
          'Die Suche läuft automatisch mehrmals täglich. Sobald neue passende Inserate gefunden werden, erscheinen sie hier. Tippe oben rechts auf Aktualisieren.'
        ));
        return;
      }
      if (!filtered.length) {
        listWrap.appendChild(emptyState(
          'filter',
          'Nichts gefunden',
          'Für diesen Filter gibt es gerade keine Wohnungen. Wechsle auf „Alle" oder ändere die Suche.'
        ));
        return;
      }
      filtered.forEach(function (l) { listWrap.appendChild(listingCard(l, newIds)); });
    }

    renderList();
  }

  function emptyState(icon, title, text) {
    var e = App.el('div', 'empty-state');
    e.appendChild(App.icon(icon, 44));
    e.appendChild(App.el('div', 'empty-title', title));
    e.appendChild(App.el('div', null, text));
    return e;
  }

  function hasActiveFilters(state) {
    return !!(state.maxPrice || state.ort || state.withImage || state.unratedOnly);
  }

  function switchControl(checked, onChange) {
    var sw = App.el('label', 'switch');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!checked;
    cb.addEventListener('change', function () { onChange(cb.checked); });
    sw.appendChild(cb);
    sw.appendChild(App.el('span', 'switch-track'));
    return sw;
  }

  function openFilterSheet(container) {
    var state = ListFilter.getState();
    var c = App.el('div', 'filter-sheet');

    // max rent
    var pf = App.el('div', 'filter-field');
    pf.appendChild(App.el('div', 'form-label', 'Höchstmiete (€)'));
    var priceInput = document.createElement('input');
    priceInput.type = 'number';
    priceInput.inputMode = 'numeric';
    priceInput.className = 'input';
    priceInput.placeholder = 'z. B. 900';
    priceInput.value = state.maxPrice != null ? String(state.maxPrice) : '';
    priceInput.addEventListener('change', function () {
      var v = parseInt(priceInput.value, 10);
      ListFilter.setState({ maxPrice: isFinite(v) && v > 0 ? v : null });
      App.rerender();
    });
    pf.appendChild(priceInput);
    c.appendChild(pf);

    // town / search area
    var towns = {};
    Feed.getListings().forEach(function (l) { var t = ListFilter.townOf(l); if (t) towns[t] = true; });
    var townList = Object.keys(towns).sort(function (a, b) { return a.localeCompare(b, 'de'); });
    var of = App.el('div', 'filter-field');
    of.appendChild(App.el('div', 'form-label', 'Ort / Suchgebiet'));
    var ortSel = document.createElement('select');
    ortSel.className = 'input';
    var optAll = document.createElement('option'); optAll.value = ''; optAll.textContent = 'Alle Orte';
    ortSel.appendChild(optAll);
    townList.forEach(function (t) {
      var o = document.createElement('option'); o.value = t; o.textContent = t;
      if (state.ort === t) o.selected = true;
      ortSel.appendChild(o);
    });
    ortSel.addEventListener('change', function () { ListFilter.setState({ ort: ortSel.value }); App.rerender(); });
    of.appendChild(ortSel);
    c.appendChild(of);

    // toggles
    var row1 = App.el('div', 'filter-switch-row');
    row1.appendChild(App.el('span', null, 'Nur mit Foto'));
    row1.appendChild(switchControl(state.withImage, function (on) { ListFilter.setState({ withImage: on }); App.rerender(); }));
    c.appendChild(row1);

    var row2 = App.el('div', 'filter-switch-row');
    row2.appendChild(App.el('span', null, 'Nur unbewertete'));
    row2.appendChild(switchControl(state.unratedOnly, function (on) { ListFilter.setState({ unratedOnly: on }); App.rerender(); }));
    c.appendChild(row2);

    var reset = App.el('button', 'btn btn-secondary', 'Filter zurücksetzen');
    reset.type = 'button';
    reset.style.marginTop = '16px';
    reset.addEventListener('click', function () {
      ListFilter.setState({ maxPrice: null, ort: '', withImage: false, unratedOnly: false });
      App.rerender();
      openFilterSheet(container);
    });
    c.appendChild(reset);

    App.showSheet({ title: 'Filter', content: c });
  }

  Views.listings = {
    title: 'Wohnungen',
    render: render,
    openDetail: openDetail,
    card: listingCard,
    newIdSet: newIdSet,
    emptyState: emptyState,
    bothGood: bothGood
  };
})();
