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
    { key: 'favoriten', label: 'Favoriten' },
    { key: 'aussortiert', label: 'Aussortiert' }
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

  // Free image proxy fallback (caches + bypasses hotlink/expiry issues).
  function proxiedImage(url, width) {
    return 'https://images.weserv.nl/?url=' + encodeURIComponent(url.replace(/^https?:\/\//, '')) +
      '&w=' + (width || 600) + '&output=webp&q=72';
  }

  // Fill a .listing-image wrapper with the photo (lazy) or a house placeholder.
  // On load failure, retry once via the image proxy, then fall back to the
  // placeholder (handles hotlink blocks / expired signed URLs).
  function setListingImage(wrap, url) {
    wrap.classList.remove('is-placeholder');
    if (url) {
      var img = document.createElement('img');
      img.className = 'listing-photo';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      var triedProxy = false;
      img.addEventListener('error', function () {
        if (!triedProxy) { triedProxy = true; img.src = proxiedImage(url, 600); return; }
        if (img.parentNode) img.parentNode.removeChild(img);
        wrap.classList.add('is-placeholder');
        wrap.insertBefore(App.icon('building', 40), wrap.firstChild);
      });
      img.src = url;
      wrap.appendChild(img);
    } else {
      wrap.classList.add('is-placeholder');
      wrap.appendChild(App.icon('building', 40));
    }
  }

  // De-duplicated list of usable photo URLs: the images[] array (when the
  // scraper found a gallery) plus the single `image` as a fallback. Feed already
  // sanitised every URL to http(s).
  function listingImages(listing) {
    var out = [];
    var seen = Object.create(null);
    function add(u) {
      if (typeof u !== 'string' || !u || seen[u]) return;
      seen[u] = true;
      out.push(u);
    }
    if (listing && Array.isArray(listing.images)) listing.images.forEach(add);
    if (listing) add(listing.image);
    return out;
  }

  // One gallery slide image with the same proxy fallback as setListingImage; on
  // final failure the slide becomes the house placeholder (so the dot count stays
  // consistent).
  function makeSlideImg(url, width) {
    var img = document.createElement('img');
    img.className = 'listing-photo';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    var triedProxy = false;
    img.addEventListener('error', function () {
      if (!triedProxy) { triedProxy = true; img.src = proxiedImage(url, width || 600); return; }
      var slide = img.parentNode;
      if (slide) { slide.innerHTML = ''; slide.classList.add('is-placeholder'); slide.appendChild(App.icon('building', 40)); }
    });
    img.src = url;
    return img;
  }

  function galleryNavButton(dir, onClick) {
    var b = App.el('button', 'gallery-nav gallery-' + dir);
    b.type = 'button';
    b.setAttribute('aria-label', dir === 'prev' ? 'Vorheriges Bild' : 'Nächstes Bild');
    b.appendChild(App.icon('chevron', 20));
    b.addEventListener('click', onClick);
    return b;
  }

  // Fill a media wrapper (card banner or detail sheet) with a swipeable gallery
  // when several photos exist, a single image for one, or the house placeholder
  // for none. Native CSS scroll-snap (touch swipe) + dots, counter and prev/next
  // arrows; all controls stop click propagation so they never open the detail.
  function fillMedia(wrap, listing, width) {
    var urls = listingImages(listing);
    if (!urls.length) { wrap.classList.add('is-placeholder'); wrap.appendChild(App.icon('building', 40)); return; }
    if (urls.length === 1) { setListingImage(wrap, urls[0]); return; }

    wrap.classList.remove('is-placeholder');
    wrap.classList.add('has-gallery');

    var track = App.el('div', 'gallery-track');
    urls.forEach(function (u) {
      var slide = App.el('div', 'gallery-slide');
      slide.appendChild(makeSlideImg(u, width));
      track.appendChild(slide);
    });
    wrap.appendChild(track);

    function slideWidth() { return track.clientWidth || 1; }
    function currentIndex() {
      return Math.max(0, Math.min(urls.length - 1, Math.round(track.scrollLeft / slideWidth())));
    }
    function goTo(i) {
      i = Math.max(0, Math.min(urls.length - 1, i));
      track.scrollTo({ left: slideWidth() * i, behavior: 'smooth' });
    }

    var dots = App.el('div', 'gallery-dots');
    var dotEls = urls.map(function (_, i) {
      var d = App.el('button', 'gallery-dot' + (i === 0 ? ' active' : ''));
      d.type = 'button';
      d.setAttribute('aria-label', 'Bild ' + (i + 1) + ' von ' + urls.length);
      d.addEventListener('click', function (e) { e.stopPropagation(); goTo(i); });
      dots.appendChild(d);
      return d;
    });
    wrap.appendChild(dots);

    var counter = App.el('div', 'gallery-counter', '1/' + urls.length);
    wrap.appendChild(counter);

    var prev = galleryNavButton('prev', function (e) { e.stopPropagation(); goTo(currentIndex() - 1); });
    var next = galleryNavButton('next', function (e) { e.stopPropagation(); goTo(currentIndex() + 1); });
    wrap.appendChild(prev);
    wrap.appendChild(next);

    var raf = null;
    function update() {
      var i = currentIndex();
      dotEls.forEach(function (d, di) { d.classList.toggle('active', di === i); });
      counter.textContent = (i + 1) + '/' + urls.length;
      prev.classList.toggle('is-hidden', i <= 0);
      next.classList.toggle('is-hidden', i >= urls.length - 1);
    }
    track.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = null; update(); });
    });
    update();
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

  // Headline rent: warm total when known, otherwise the cold rent (labelled).
  function rentDisplay(listing) {
    var warm = window.Score ? Score.effectiveRent(listing) : null;
    if (warm !== null) return { value: App.fmtEUR(warm), suffix: 'warm' };
    if (listing.price_eur !== null && listing.price_eur !== undefined) {
      return { value: App.fmtEUR(listing.price_eur), suffix: 'kalt' };
    }
    return { value: App.fmtEUR(listing.price_eur), suffix: '' };
  }

  function scoreBadge(listing) {
    var s = Score.score(listing);
    var b = App.el('span', 'score-badge score-' + Score.tone(s.total), String(s.total));
    b.setAttribute('aria-label', 'Wertung ' + s.total + ' von 100');
    b.title = 'Wertung ' + s.total + '/100';
    return b;
  }

  function scoreSection(listing) {
    var s = Score.score(listing);
    var wrap = App.el('div', 'score-section');
    var head = App.el('div', 'score-head');
    var ring = App.el('div', 'score-ring score-' + Score.tone(s.total));
    ring.appendChild(App.el('span', 'score-ring-num', String(s.total)));
    head.appendChild(ring);
    var ht = App.el('div', 'score-head-text');
    ht.appendChild(App.el('div', 'score-head-title', 'Wertung ' + s.total + ' / 100'));
    ht.appendChild(App.el('div', 'score-head-sub', 'aus euren Filter-Einstellungen berechnet'));
    head.appendChild(ht);
    wrap.appendChild(head);
    s.parts.forEach(function (p) {
      var row = App.el('div', 'score-part');
      var lab = App.el('div', 'score-part-label');
      lab.appendChild(App.el('span', 'score-part-name', p.label));
      lab.appendChild(App.el('span', 'score-part-note', p.note || ''));
      row.appendChild(lab);
      var bar = App.el('div', 'score-bar');
      var fill = App.el('div', 'score-bar-fill');
      fill.style.width = Math.round(p.got / p.max * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
      wrap.appendChild(row);
    });
    return wrap;
  }

  // -------- listing card

  function listingCard(listing, newIds) {
    var card = App.el('div', 'card listing-card');
    card.classList.add(listing.status === 'review' ? 'is-review' : 'is-match');
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

    // photo banner with badges + favourite overlaid; a swipeable gallery when
    // the listing has more than one photo
    var imgWrap = App.el('div', 'listing-image');
    fillMedia(imgWrap, listing, 600);
    var overlay = App.el('div', 'listing-image-overlay');
    overlay.appendChild(badges);
    overlay.appendChild(favButton(listing));
    imgWrap.appendChild(overlay);
    card.appendChild(imgWrap);

    var title = App.el('div', 'listing-title', listing.title || 'Wohnung');
    card.appendChild(title);

    var priceRow = App.el('div', 'listing-price-row');
    var rd = rentDisplay(listing);
    var priceEl = App.el('div', 'listing-price', rd.value);
    if (rd.suffix) priceEl.appendChild(App.el('span', 'price-suffix', ' ' + rd.suffix));
    priceRow.appendChild(priceEl);
    priceRow.appendChild(scoreBadge(listing));
    card.appendChild(priceRow);

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

    // free, data-driven highlight line
    card.appendChild(App.el('div', 'listing-blurb', Score.blurb(listing)));

    var srcline = App.el('div', 'listing-src');
    srcline.textContent = (listing.source || listing.portal || '') + ' · gefunden ' + App.fmtDateTime(listing.first_seen);
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

  // -------- cost estimate (Warmmiete inkl. Strom & Gas) --------

  function toNum(v) {
    return (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
  }

  function cfgNum(v, fallback) {
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  // Monthly cost estimate. Real Kaltmiete/Nebenkosten/Heizkosten/Warmmiete from
  // the listing are used whenever stated; only Strom (always) and — when the
  // listing gives no heating/warm figure — Heizung·Gas are estimated. Never
  // invents a Nebenkosten number.
  function costEstimate(listing) {
    var cfg = (window.WS_CONFIG && WS_CONFIG.costs) || {};
    var s = cfg.strom || {};
    var heizRate = cfgNum(cfg.heizkostenPerSqm, 1.3);

    var members = (window.Store && Store.getSettings && Store.getSettings().members) || null;
    var persons = (members && members.length) || cfgNum(s.persons, 2);
    var kwh = cfgNum(s.kwhBase, 1100) + cfgNum(s.kwhPerPerson, 700) * persons;
    var strom = (cfgNum(s.baseEurYear, 130) + kwh * cfgNum(s.workEurKwh, 0.32)) / 12;

    var area = toNum(listing.area_sqm);
    var price = toNum(listing.price_eur);
    var kaltReal = toNum(listing.kaltmiete_eur);
    var nebenReal = toNum(listing.nebenkosten_eur);
    var heizReal = toNum(listing.heizkosten_eur);
    var warmReal = toNum(listing.warmmiete_eur);

    // Base (cold) rent for display: a parsed Kaltmiete wins; otherwise the
    // headline price — unless that headline IS the stated Warmmiete (then there
    // is no reliable cold rent to show).
    var kalt;
    if (kaltReal != null) kalt = kaltReal;
    else if (warmReal != null && price != null && Math.abs(price - warmReal) < 1) kalt = null;
    else kalt = price;

    // A stated Warmmiete below the Kaltmiete is impossible (warm = cold + extras)
    // and indicates a mis-parsed figure — ignore it and compute from real parts.
    if (warmReal != null && kalt != null && warmReal < kalt) warmReal = null;

    // Estimate Heizung/Gas whenever the listing gives no own heating figure AND
    // no full Warmmiete — even when Nebenkosten are stated (those are often the
    // cold operating costs, heating separate). A stated Heizkosten value wins.
    var gasEst = (heizReal == null && warmReal == null && area != null) ? area * heizRate : null;
    var heizShown = heizReal != null ? heizReal : gasEst;
    var heizIsReal = heizReal != null;

    // Warmmiete: a stated value wins. Otherwise compute from Kaltmiete + stated
    // Nebenkosten + heating (real or estimated). warmEstimated flags that the sum
    // includes the Gas estimate, so it's labelled "ca." rather than "lt. Inserat".
    var warm = null, warmStated = false, warmEstimated = false;
    if (warmReal != null) {
      warm = warmReal;
      warmStated = true;
    } else if (kalt != null && nebenReal != null) {
      warm = kalt + nebenReal + (heizShown || 0);
      warmEstimated = (heizReal == null && gasEst != null);
      warmStated = !warmEstimated;
    }

    return {
      area: area, persons: persons, strom: strom,
      kalt: kalt, nebenReal: nebenReal,
      heizShown: heizShown, heizIsReal: heizIsReal,
      warm: warm, warmStated: warmStated, warmEstimated: warmEstimated
    };
  }

  function costRow(label, value, opts) {
    opts = opts || {};
    var row = App.el('div', 'cost-row' +
      (opts.strong ? ' is-strong' : '') + (opts.total ? ' is-total' : ''));
    var l = App.el('span', 'cost-label', label);
    if (opts.tag) l.appendChild(App.el('span', 'cost-tag cost-tag-' + (opts.tagKind || 'est'), opts.tag));
    row.appendChild(l);
    row.appendChild(App.el('span', 'cost-value', value));
    return row;
  }

  function costSection(ce) {
    var card = App.el('div', 'cost-card');
    var real = { tag: 'lt. Inserat', tagKind: 'real' };
    var est = { tag: 'ca.', tagKind: 'est' };

    if (ce.kalt != null) card.appendChild(costRow('Kaltmiete', App.fmtEUR(ce.kalt)));
    if (ce.nebenReal != null) card.appendChild(costRow('Nebenkosten', '+ ' + App.fmtEUR(ce.nebenReal), real));
    if (ce.heizShown != null) {
      card.appendChild(costRow('Heizung · Gas', '+ ' + App.fmtEUR(ce.heizShown), ce.heizIsReal ? real : est));
    }

    if (ce.warm != null) {
      var warmOpts = { strong: true };
      if (ce.warmStated) { warmOpts.tag = 'lt. Inserat'; warmOpts.tagKind = 'real'; }
      else if (ce.warmEstimated) { warmOpts.tag = 'ca.'; warmOpts.tagKind = 'est'; }
      card.appendChild(costRow('Warmmiete', App.fmtEUR(ce.warm), warmOpts));
      card.appendChild(costRow('Strom', '+ ' + App.fmtEUR(ce.strom), { tag: 'ca. ' + ce.persons + ' Pers.', tagKind: 'est' }));
      card.appendChild(costRow('Gesamt / Monat', App.fmtEUR(ce.warm + ce.strom), { total: true }));
      card.appendChild(App.el('div', 'cost-hint',
        ce.warmEstimated
          ? 'Heizung/Gas & Strom sind grobe Schätzungen; Kaltmiete & Nebenkosten stammen aus dem Inserat.'
          : 'Strom ist eine grobe Schätzung (Haushaltsgröße); die übrigen Werte stammen aus dem Inserat.'));
    } else {
      card.appendChild(costRow('Strom', '+ ' + App.fmtEUR(ce.strom), { tag: 'ca. ' + ce.persons + ' Pers.', tagKind: 'est' }));
      card.appendChild(App.el('div', 'cost-hint',
        'Nebenkosten stehen nicht im Inserat und sind hier nicht enthalten. ' +
        (ce.heizIsReal
          ? 'Strom ist eine grobe Schätzung.'
          : 'Strom & Gas sind grobe Schätzungen aus Wohnfläche und Haushaltsgröße.')));
    }
    return card;
  }

  // -------- detail sheet

  function openDetail(listing) {
    var c = App.el('div', 'detail');

    var media = App.el('div', 'detail-media');
    fillMedia(media, listing, 900);
    c.appendChild(media);

    var drd = rentDisplay(listing);
    var price = App.el('div', 'detail-price', drd.value);
    if (drd.suffix) price.appendChild(App.el('span', 'price-suffix', ' ' + drd.suffix));
    c.appendChild(price);

    c.appendChild(App.el('div', 'detail-blurb', Score.blurb(listing)));

    var grid = App.el('div', 'detail-grid');
    addDetail(grid, 'door', App.fmtRooms(listing.rooms) || '–', 'Zimmer');
    addDetail(grid, 'ruler', App.fmtArea(listing.area_sqm) || '–', 'Wohnfläche');
    addDetail(grid, 'layers', listing.floor || 'offen', 'Etage');
    addDetail(grid, 'pin', listing.location || 'prüfen', 'Lage');
    c.appendChild(grid);

    // Kostenschätzung: echte Werte aus dem Inserat, sonst Strom/Gas geschätzt.
    var ce = costEstimate(listing);
    if (ce.kalt != null || ce.warm != null || ce.area != null) {
      c.appendChild(App.el('div', 'section-title', 'Kostenschätzung'));
      c.appendChild(costSection(ce));
    }

    if (listing.reasons && listing.reasons.length) {
      c.appendChild(infoLine('Passt, weil', listing.reasons.join(', '), 'good'));
    }
    if (listing.review_notes && listing.review_notes.length) {
      c.appendChild(infoLine('Bitte prüfen', listing.review_notes.join(', '), 'warn'));
    }
    c.appendChild(infoLine('Quelle', listing.source || listing.portal || '–', null));
    c.appendChild(infoLine('Gefunden', App.fmtDateTime(listing.first_seen) + ' (' + App.fmtRelTime(listing.first_seen) + ')', null));

    // score breakdown
    c.appendChild(App.el('div', 'section-title', 'Wertung'));
    c.appendChild(scoreSection(listing));

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

    // generated viewing request (free, from the listing data + your names)
    c.appendChild(App.el('div', 'section-title', 'Besichtigungsanfrage'));
    var members = Store.getSettings().members;
    var inq = document.createElement('textarea');
    inq.className = 'input';
    inq.style.minHeight = '156px';
    inq.style.fontFamily = 'inherit';
    inq.style.fontSize = '15px';
    inq.value = Score.inquiry(listing, members[0] && members[0].name, members[1] && members[1].name);
    c.appendChild(inq);
    var copyBtn = App.el('button', 'btn btn-secondary', 'Anfrage kopieren');
    copyBtn.type = 'button';
    copyBtn.style.marginTop = '8px';
    copyBtn.appendChild(App.icon('check', 15));
    copyBtn.addEventListener('click', function () {
      var text = inq.value;
      function ok() { App.toast('Anfrage kopiert ✓'); }
      function fallback() {
        inq.focus(); inq.select();
        var done = false;
        try { done = document.execCommand('copy'); } catch (e) {}
        App.toast(done ? 'Anfrage kopiert ✓' : 'Bitte Text markieren und kopieren');
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok).catch(fallback);
      } else { fallback(); }
    });
    c.appendChild(copyBtn);

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

  // Set by render() to the current view's renderList closure, so update() can
  // refresh just the list (cards/banners/count) without rebuilding the search
  // bar — keeping focus and caret intact when a store/feed change fires.
  var activeRenderList = null;

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
    [['neu', 'Neueste zuerst'], ['score', 'Beste Treffer'], ['preis', 'Günstigste zuerst'], ['flaeche', 'Größte zuerst']].forEach(function (o) {
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

    activeRenderList = renderList;
    renderList();
  }

  // Lightweight refresh used by App.rerender: re-render only the list portion
  // (so the search input keeps focus). Returns true when it handled the update,
  // false when the view hasn't been rendered yet (caller does a full render).
  function update() {
    if (typeof activeRenderList !== 'function') return false;
    var listWrap = document.querySelector('#view-root .listing-list');
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

  function hasActiveFilters(state) {
    return !!(state.priceMin || state.priceMax || state.areaMin || state.areaMax ||
      state.roomsMin || state.roomsMax || state.ort || state.withImage || state.unratedOnly);
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

  function parseIntOrNull(s) { var v = parseInt(s, 10); return isFinite(v) && v >= 0 ? v : null; }
  function parseFloatOrNull(s) { var v = parseFloat(String(s).replace(',', '.')); return isFinite(v) && v >= 0 ? v : null; }

  function rangeField(label, minKey, maxKey, parse) {
    var state = ListFilter.getState();
    var f = App.el('div', 'filter-field');
    f.appendChild(App.el('div', 'form-label', label));
    var row = App.el('div', 'range-row');
    function mk(key, ph) {
      var inp = document.createElement('input');
      inp.type = 'number'; inp.inputMode = 'numeric'; inp.className = 'input';
      inp.placeholder = ph;
      inp.value = state[key] != null ? String(state[key]) : '';
      inp.addEventListener('change', function () {
        var patch = {}; patch[key] = parse(inp.value);
        ListFilter.setState(patch); App.rerender();
      });
      return inp;
    }
    row.appendChild(mk(minKey, 'von'));
    row.appendChild(App.el('span', 'range-sep', '–'));
    row.appendChild(mk(maxKey, 'bis'));
    f.appendChild(row);
    return f;
  }

  function switchRow(label, key, defaultOn) {
    var state = ListFilter.getState();
    var checked = defaultOn ? state[key] !== false : !!state[key];
    var row = App.el('div', 'filter-switch-row');
    row.appendChild(App.el('span', null, label));
    row.appendChild(switchControl(checked, function (on) {
      var p = {}; p[key] = on; ListFilter.setState(p); App.rerender();
    }));
    return row;
  }

  function openFilterSheet(container) {
    var state = ListFilter.getState();
    var c = App.el('div', 'filter-sheet');

    c.appendChild(rangeField('Warmmiete (€)', 'priceMin', 'priceMax', parseIntOrNull));
    c.appendChild(rangeField('Wohnfläche (m²)', 'areaMin', 'areaMax', parseFloatOrNull));
    c.appendChild(rangeField('Zimmer', 'roomsMin', 'roomsMax', parseFloatOrNull));

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

    c.appendChild(switchRow('Nur mit Foto', 'withImage', false));
    c.appendChild(switchRow('Nur zu bewertende', 'unratedOnly', false));

    // scoring preferences (also feed the Score)
    c.appendChild(App.el('div', 'section-title', 'Für die Wertung'));
    c.appendChild(switchRow('Erdgeschoss wichtig', 'groundFloorImportant', true));
    c.appendChild(switchRow('Gute ÖPNV-Anbindung wichtig', 'transitImportant', true));

    var reset = App.el('button', 'btn btn-secondary', 'Filter zurücksetzen');
    reset.type = 'button';
    reset.style.marginTop = '16px';
    reset.addEventListener('click', function () {
      ListFilter.setState({
        priceMin: null, priceMax: null, areaMin: null, areaMax: null,
        roomsMin: null, roomsMax: null, ort: '', withImage: false, unratedOnly: false
      });
      App.rerender();
      openFilterSheet(container);
    });
    c.appendChild(reset);

    App.showSheet({ title: 'Filter & Wertung', content: c });
  }

  Views.listings = {
    title: 'Wohnungen',
    render: render,
    update: update,
    openDetail: openDetail,
    card: listingCard,
    newIdSet: newIdSet,
    emptyState: emptyState,
    bothGood: bothGood
  };
})();
