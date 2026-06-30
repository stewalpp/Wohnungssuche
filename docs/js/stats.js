/* ============================================================
   Möbelverkauf — js/stats.js
   window.Sales: reine Rechen-Helfer für die Listen-Kopfzeile.
   Keine DOM-Berührung, nur Zahlen aus der Objektliste.
   ============================================================ */
(function () {
  'use strict';

  function n(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

  // Erlös eines Objekts: tatsächlicher Verkaufspreis, sonst 0.
  function earnedOf(it) {
    return (it.status === 'verkauft') ? n(it.soldPrice) : 0;
  }

  // Zählt der Status als "noch zu erwarten" (offen/reserviert)?
  function isExpecting(it) {
    var s = window.Catalog && Catalog.status(it.status);
    return !!(s && s.expects);
  }

  function summary(items) {
    var out = {
      total: items.length,
      counts: { offen: 0, reserviert: 0, verkauft: 0, verschenkt: 0, entsorgt: 0, behalten: 0 },
      earned: 0,            // Σ tatsächlicher Erlös (verkauft)
      soldCount: 0,
      openCount: 0,
      reservedCount: 0,
      activeCount: 0,       // offen + reserviert
      doneCount: 0,
      expectedMin: 0,       // Σ Mindestpreis (offen + reserviert)
      expectedMax: 0,       // Σ Wunschpreis  (offen + reserviert)
      withoutPrice: 0       // aktive Objekte ganz ohne Preis
    };

    items.forEach(function (it) {
      if (out.counts[it.status] !== undefined) out.counts[it.status]++;
      var st = window.Catalog && Catalog.status(it.status);

      out.earned += earnedOf(it);

      if (it.status === 'verkauft') out.soldCount++;
      if (it.status === 'offen') out.openCount++;
      if (it.status === 'reserviert') out.reservedCount++;
      if (st && st.done) out.doneCount++;

      if (isExpecting(it)) {
        out.activeCount++;
        // Mindestpreis-Untergrenze: minPrice, sonst wishPrice (oder 0)
        out.expectedMin += (it.minPrice != null ? n(it.minPrice) : n(it.wishPrice));
        // Wunschpreis-Obergrenze: wishPrice, sonst minPrice (oder 0)
        out.expectedMax += (it.wishPrice != null ? n(it.wishPrice) : n(it.minPrice));
        if (it.minPrice == null && it.wishPrice == null) out.withoutPrice++;
      }
    });

    return out;
  }

  window.Sales = {
    summary: summary,
    earnedOf: earnedOf
  };
})();
