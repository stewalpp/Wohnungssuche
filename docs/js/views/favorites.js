/* ============================================================
   Wohnungssuche — js/views/favorites.js
   Views.favorites: the couple's shortlist — starred apartments and
   the ones where both rated "Gut". Reuses the listing card from
   Views.listings.
   ============================================================ */
(function () {
  'use strict';

  var Views = window.Views = window.Views || {};

  function render(container) {
    container.innerHTML = '';
    var view = App.el('div', 'view');

    var listings = Feed.getListings();
    var ratings = Store.getAllRatings();
    var newIds = Views.listings.newIdSet();

    var byId = {};
    listings.forEach(function (l) { byId[l.id] = l; });

    // Favourites: starred. Both-good: both rated "Gut" (and not hidden).
    var starred = listings.filter(function (l) { return (ratings[l.id] || {}).favorite; });
    var bothGood = listings.filter(function (l) {
      var r = ratings[l.id] || {};
      return r.p1 === 'gut' && r.p2 === 'gut' && !r.favorite;
    });

    if (!starred.length && !bothGood.length) {
      view.appendChild(Views.listings.emptyState(
        'star',
        'Noch keine Favoriten',
        'Tippe bei einer Wohnung auf den Stern oder bewertet beide mit „Gut" – sie landet dann hier in eurer engeren Auswahl.'
      ));
      container.appendChild(view);
      return;
    }

    if (starred.length) {
      view.appendChild(App.el('div', 'section-title', 'Markierte Favoriten'));
      starred.forEach(function (l) { view.appendChild(Views.listings.card(l, newIds)); });
    }
    if (bothGood.length) {
      view.appendChild(App.el('div', 'section-title', 'Beide mögen sie'));
      bothGood.forEach(function (l) { view.appendChild(Views.listings.card(l, newIds)); });
    }

    container.appendChild(view);
  }

  Views.favorites = {
    title: 'Favoriten',
    render: render
  };
})();
