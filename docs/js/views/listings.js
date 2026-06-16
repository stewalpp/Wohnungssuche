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

  // -------- helpers

  function newIdSet() {
    var since = App.newSince || '';
    var set = new Set();
    Feed.getListings().forEach(function (l) {
      if (since && l.first_seen && l.first_seen > since) set.add(l.id);
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
    RATING_CHOICES.forEach(function (c) {
      var btn = App.el('button', 'rating-opt' + (rating[personId] === c.key ? ' active v-' + c.key : ''));
      btn.type = 'button';
      btn.setAttribute('aria-label', Store.memberName(personId) + ': ' + c.label);
      btn.appendChild(App.icon(c.icon, 17));
      btn.appendChild(App.el('span', null, c.label));
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        Store.setPersonRating(listing.id, personId, c.key);
      });
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

  // -------- listing card

  function listingCard(listing, newIds) {
    var card = App.el('div', 'card listing-card');
    if (newIds.has(listing.id)) card.classList.add('is-new');
    if (bothGood(listing)) card.classList.add('both-good');

    var top = App.el('div', 'listing-top');
    var badges = App.el('div', 'listing-badges');
    if (newIds.has(listing.id)) badges.appendChild(App.el('span', 'new-pill', 'NEU'));
    badges.appendChild(statusBadge(listing));
    if (bothGood(listing)) {
      var m = App.el('span', 'badge badge-pink match-badge');
      m.appendChild(App.icon('heart', 12));
      m.appendChild(App.el('span', null, 'Beide: Gut'));
      badges.appendChild(m);
    }
    top.appendChild(badges);
    top.appendChild(favButton(listing));
    card.appendChild(top);

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

    // ratings
    var ratings = App.el('div', 'rating-block');
    ratings.appendChild(ratingRow(listing, 'p1'));
    ratings.appendChild(ratingRow(listing, 'p2'));
    card.appendChild(ratings);

    // footer
    var foot = App.el('div', 'listing-foot');
    var open = App.el('a', 'btn btn-primary btn-small');
    open.href = listing.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
    open.textContent = 'Inserat öffnen';
    open.appendChild(App.icon('external', 15));
    open.addEventListener('click', function (e) { e.stopPropagation(); });
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
    note.addEventListener('input', function () {
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { Store.setNote(listing.id, note.value); }, 400);
    });
    note.addEventListener('blur', function () { Store.setNote(listing.id, note.value); });
    c.appendChild(note);

    // actions
    var open = App.el('a', 'btn btn-primary');
    open.href = listing.url; open.target = '_blank'; open.rel = 'noopener noreferrer';
    open.style.marginTop = '14px';
    open.textContent = 'Inserat öffnen';
    open.appendChild(App.icon('external', 16));
    c.appendChild(open);

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
    view.appendChild(sortRow);

    var listWrap = App.el('div', 'listing-list');
    view.appendChild(listWrap);
    container.appendChild(view);

    function renderList() {
      listWrap.innerHTML = '';
      var newIds = newIdSet();
      var all = Feed.getListings();
      var ratings = Store.getAllRatings();
      var filtered = ListFilter.apply(all, { ratings: ratings, newIds: newIds });

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
