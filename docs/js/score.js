/* ============================================================
   Wohnungssuche — js/score.js
   window.Score: a transparent 0–100 score per listing based on the
   user's preferences (the advanced filters; defaults = the search
   criteria), a coarse town-level public-transport rating toward
   Hannover, plus free, data-driven generated texts (highlight line
   and a ready-to-send viewing request).
   Classic script. No modules, no external libs, no paid API.
   ============================================================ */
(function () {
  'use strict';

  // Coarse public-transport rating toward Hannover, by town/area. 5 = direct
  // S-Bahn / fast rail; 3 = decent bus/Stadtbahn; lower = weaker. This is an
  // honest TOWN-LEVEL estimate (the listings only expose town/PLZ, not an exact
  // address), shown clearly as such in the UI.
  var TRANSIT = {
    barsinghausen: { score: 5, note: 'S-Bahn S1/S2 direkt nach Hannover' },
    egestorf: { score: 4, note: 'S-Bahn-Halt an der Deisterlinie' },
    bantorf: { score: 4, note: 'S-Bahn-Halt Richtung Hannover' },
    kirchdorf: { score: 4, note: 'S-Bahn-Halt' },
    winninghausen: { score: 3, note: 'Nähe S-Bahn Kirchdorf' },
    seelze: { score: 5, note: 'S-Bahn S1/S2, schnell in Hannover' },
    letter: { score: 5, note: 'Nähe S-Bahn Seelze' },
    lohnde: { score: 4, note: 'Bahnhalt Richtung Hannover' },
    harenberg: { score: 3, note: 'Bus, Nähe Seelze' },
    velber: { score: 3, note: 'Bus, Nähe Seelze' },
    ronnenberg: { score: 4, note: 'Stadtbahn/Bus, gut angebunden' },
    empelde: { score: 4, note: 'Stadtbahn-Nähe nach Hannover' },
    weetzen: { score: 5, note: 'S-Bahn-Knoten S1/S2/S5' },
    gehrden: { score: 3, note: 'Bus nach Weetzen/Hannover' },
    wennigsen: { score: 4, note: 'S-Bahn S1 (Deister)' },
    sorsum: { score: 3, note: 'Bus Richtung Hannover-Süd' },
    holtensen: { score: 3, note: 'Bus' },
    benthe: { score: 3, note: 'Bus, Nähe Empelde' },
    lenthe: { score: 3, note: 'Bus' },
    everloh: { score: 2, note: 'eher ländlich, wenig ÖPNV' },
    nordgoltern: { score: 2, note: 'ländlich' },
    grossgoltern: { score: 2, note: 'ländlich' },
    'gross munzel': { score: 2, note: 'ländlich' }
  };

  function deaccent(s) {
    return (s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  }

  // {score, note} of the best-matching town keyword found in the listing's
  // location/source, or a neutral default.
  function transitFor(listing) {
    var hay = deaccent((listing.location || '') + ' ' + (listing.source || ''));
    var best = null;
    Object.keys(TRANSIT).forEach(function (key) {
      if (hay.indexOf(deaccent(key)) !== -1) {
        if (!best || TRANSIT[key].score > best.score) best = TRANSIT[key];
      }
    });
    return best || { score: 3, note: 'Verbindung bitte prüfen' };
  }

  // -------- preferences (per device; default to the search criteria) --------

  function defaults() {
    var crit = (window.Feed && Feed.getMeta && Feed.getMeta().criteria) || {};
    return {
      maxPrice: crit.max_total_rent_eur || 1000,
      minArea: crit.min_area_sqm || 70,
      minRooms: crit.min_rooms || 3,
      groundFloorImportant: true,
      transitImportant: true
    };
  }

  function num(v) { return (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v); }

  // Preferences come from the one filter store (ListFilter), so the advanced
  // filters double as the scoring preferences. Falls back to the search criteria.
  function getPrefs() {
    var def = defaults();
    var f = (window.ListFilter && ListFilter.getState()) || {};
    return {
      maxPrice: num(f.priceMax) || def.maxPrice,
      minArea: num(f.areaMin) || def.minArea,
      minRooms: num(f.roomsMin) || def.minRooms,
      groundFloorImportant: f.groundFloorImportant !== false,
      transitImportant: f.transitImportant !== false
    };
  }

  function isGroundFloor(listing) {
    var f = deaccent(listing.floor || '');
    if (!f) return null;
    return /(^|[^a-z])(eg|erdgeschoss|parterre|hochparterre)([^a-z]|$)/.test(f) ? true : false;
  }

  // Best estimate of the WARM (total) rent, mirroring the Python side: prefer a
  // stated Warmmiete; else Kaltmiete (or price) + stated Neben-/Heizkosten;
  // null when only the cold rent is known.
  function effectiveRent(listing) {
    var warm = num(listing.warmmiete_eur);
    if (warm !== null) return warm;
    var base = num(listing.kaltmiete_eur);
    if (base === null) base = num(listing.price_eur);
    if (base === null) return null;
    var extras = (num(listing.nebenkosten_eur) || 0) + (num(listing.heizkosten_eur) || 0);
    return extras > 0 ? base + extras : null;
  }

  // -------- the 0–100 score (transparent additive model) --------

  function score(listing, prefs) {
    prefs = prefs || getPrefs();
    var parts = [];

    // Preis (max 30): scored on the WARM total when known, else the cold rent.
    var warm = effectiveRent(listing);
    var price = (warm !== null) ? warm : num(listing.price_eur);
    var pricePts;
    if (price === null) { pricePts = 18; parts.push({ label: 'Preis', got: 18, max: 30, note: 'Miete offen' }); }
    else {
      var lo = prefs.maxPrice * 0.6;
      if (price <= lo) pricePts = 30;
      else if (price >= prefs.maxPrice) pricePts = Math.max(0, 30 - (price - prefs.maxPrice) / prefs.maxPrice * 30);
      else pricePts = 30 - (price - lo) / (prefs.maxPrice - lo) * 15; // 30 → 15 across [lo, max]
      pricePts = Math.round(Math.max(0, Math.min(30, pricePts)));
      parts.push({ label: 'Preis', got: pricePts, max: 30, note: App.fmtEUR(price) + (warm !== null ? ' warm' : ' kalt') });
    }

    // Fläche (max 20)
    var area = num(listing.area_sqm), areaPts;
    if (area === null) { areaPts = 12; parts.push({ label: 'Fläche', got: 12, max: 20, note: 'offen' }); }
    else {
      var target = prefs.minArea * 1.3;
      if (area >= target) areaPts = 20;
      else if (area <= prefs.minArea) areaPts = 12;
      else areaPts = 12 + (area - prefs.minArea) / (target - prefs.minArea) * 8;
      areaPts = Math.round(Math.max(0, Math.min(20, areaPts)));
      parts.push({ label: 'Fläche', got: areaPts, max: 20, note: App.fmtArea(area) });
    }

    // ÖPNV (max 25)
    var t = transitFor(listing);
    var transitMax = prefs.transitImportant ? 25 : 12;
    var transitPts = Math.round(t.score / 5 * transitMax);
    parts.push({ label: 'ÖPNV', got: transitPts, max: transitMax, note: t.note });

    // Etage (max 10)
    var gf = isGroundFloor(listing), floorMax = 10, floorPts;
    if (gf === true) floorPts = 10;
    else if (gf === false) floorPts = prefs.groundFloorImportant ? 3 : 7;
    else floorPts = 6;
    parts.push({ label: 'Etage', got: floorPts, max: floorMax, note: listing.floor || 'offen' });

    // Zimmer (max 10)
    var rooms = num(listing.rooms), roomsPts;
    if (rooms === null) roomsPts = 6;
    else if (rooms >= prefs.minRooms + 1) roomsPts = 10;
    else if (rooms >= prefs.minRooms) roomsPts = 8;
    else roomsPts = 3;
    parts.push({ label: 'Zimmer', got: roomsPts, max: 10, note: App.fmtRooms(rooms) || 'offen' });

    // Treffer-Status (max 5)
    var statusPts = listing.status === 'review' ? 2 : 5;
    parts.push({ label: 'Treffer', got: statusPts, max: 5, note: listing.status === 'review' ? 'Etage prüfen' : 'passt' });

    // Normalise to a true 0–100 score: percentage of achievable points. When a
    // preference toggle lowers a category's max (e.g. ÖPNV 25→12 when transit is
    // "unwichtig"), this keeps the ceiling at 100 instead of shrinking it — so an
    // otherwise-perfect flat can still reach "gut" (>=80). With both toggles on
    // (the default) maxSum is 100, so the number is unchanged; and since maxSum is
    // constant across all listings for a given preference set, the ranking/sort
    // order is identical to the raw sum.
    var gotSum = parts.reduce(function (s, p) { return s + p.got; }, 0);
    var maxSum = parts.reduce(function (s, p) { return s + p.max; }, 0);
    var total = maxSum > 0 ? Math.round(gotSum / maxSum * 100) : 0;
    return { total: total, parts: parts, transit: t };
  }

  function tone(total) {
    if (total >= 80) return 'good';
    if (total >= 60) return 'ok';
    return 'low';
  }

  // -------- free, data-driven generated texts --------

  function townLabel(listing) {
    var t = (window.ListFilter && ListFilter.townOf(listing)) || '';
    if (t) return t;
    var loc = listing.location || '';
    var m = loc.replace(/\b3\d{4}\b/g, ' ').match(/[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\-]{2,}/);
    return m ? m[0] : '';
  }

  // pick a deterministic variant by listing id so each card reads individually
  function variant(id, arr) {
    var h = 0;
    for (var i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
  }

  function priceAdj(listing, prefs) {
    // Rate the same warm total the score and the card headline use, not the
    // bare cold rent — otherwise a flat scored on its warm rent could still get
    // the "Preiswerte" adjective off a low Kaltmiete.
    var p = effectiveRent(listing);
    if (p === null) p = num(listing.price_eur);
    if (p === null) return '';
    if (p <= prefs.maxPrice * 0.6) return 'Preiswerte';
    if (p <= prefs.maxPrice * 0.85) return 'Gut bezahlbare';
    return 'Solide';
  }

  // short individual highlight line for the card
  function blurb(listing) {
    var prefs = getPrefs();
    var rooms = num(listing.rooms);
    var roomsTxt = rooms ? (rooms + '-Zimmer-Wohnung') : 'Wohnung';
    var adj = priceAdj(listing, prefs);
    var town = townLabel(listing);
    var gf = isGroundFloor(listing);
    var t = transitFor(listing);

    var bits = [];
    bits.push((adj ? adj + ' ' : '') + roomsTxt + (town ? ' in ' + town : ''));
    var extras = [];
    if (gf === true) extras.push('im Erdgeschoss');
    var area = num(listing.area_sqm);
    if (area) extras.push('mit ' + App.fmtArea(area));
    if (t.score >= 4) extras.push(variant(listing.id, ['top ÖPNV-Anbindung', 'sehr gute Bahn-Anbindung nach Hannover', 'schnell in Hannover']));
    else if (t.score <= 2) extras.push('eher ruhige Lage');
    var sentence = bits[0];
    if (extras.length) sentence += ' – ' + extras.slice(0, 2).join(', ');
    sentence += '.';
    return sentence;
  }

  // a ready-to-send German viewing request, individualised from the data
  function inquiry(listing, name1, name2) {
    var rooms = num(listing.rooms);
    var area = num(listing.area_sqm);
    // Quote the warm total when known (matching the card headline), and always
    // label it, so the viewing request never states an unqualified Kaltmiete
    // that contradicts the price shown on the tile.
    var warm = effectiveRent(listing);
    var price = (warm !== null) ? warm : num(listing.price_eur);
    var rentLabel = (warm !== null) ? ' warm' : ' kalt';
    var town = townLabel(listing);
    var who = (name1 && name2) ? (name1 + ' und ' + name2) : (name1 || 'wir');
    var desc = (rooms ? rooms + '-Zimmer-Wohnung' : 'Wohnung') +
      (area ? ' (ca. ' + App.fmtArea(area) + ')' : '') +
      (town ? ' in ' + town : '') +
      (price ? ' für ' + App.fmtEUR(price) + rentLabel : '');
    var opener = variant(listing.id, [
      'wir haben Ihr Inserat zur ' + desc + ' gesehen und die Wohnung spricht uns sehr an.',
      'Ihre ' + desc + ' klingt für uns sehr passend.',
      'mit großem Interesse haben wir Ihr Inserat zur ' + desc + ' gelesen.'
    ]);
    var familyIntro = who === 'wir' ? 'Wir sind' : 'Wir (' + who + ') sind';
    return 'Guten Tag,\n\n' + opener +
      '\n\n' + familyIntro + ' eine kleine Familie mit einem Baby und suchen ein langfristiges Zuhause, in dem wir gut ankommen können. ' +
      'Die Wohnung wirkt auf uns sehr passend, weil sie zu unserem Alltag und unserer Suche in der Region passen könnte.\n\n' +
      'Falls die Wohnung noch verfügbar ist, würden wir sie uns sehr gerne ansehen und uns persönlich vorstellen. ' +
      'Wäre in den nächsten Tagen ein Besichtigungstermin möglich?\n\n' +
      'Über eine kurze Rückmeldung freuen wir uns sehr.\n\n' +
      'Vielen Dank und viele Grüße\n' + who;
  }

  window.Score = {
    score: score,
    tone: tone,
    transitFor: transitFor,
    getPrefs: getPrefs,
    defaults: defaults,
    blurb: blurb,
    inquiry: inquiry,
    townLabel: townLabel,
    effectiveRent: effectiveRent
  };
})();
