/* ============================================================
   js/config.js — window.WS_CONFIG
   Static app configuration. Loaded FIRST, before everything else.

   The Firebase web config below is NOT a secret: every web client
   receives it. Access is gated by the Firestore rule
   (`allow read, write: if request.auth != null;`) plus anonymous
   auth. For this private couple-app the stored data (apartment
   ratings & notes) is low-sensitivity. See ANLEITUNG.md → Sicherheit.
   ============================================================ */
(function () {
  'use strict';

  window.WS_CONFIG = {
    // Firebase project "Wohnungssuche" (wohnungssuche-a8a86), Spark/free tier.
    firebase: {
      apiKey: 'AIzaSyAM958Bcf4kgLuWJwld0bXH1kKJOa45umg',
      authDomain: 'wohnungssuche-a8a86.firebaseapp.com',
      projectId: 'wohnungssuche-a8a86',
      storageBucket: 'wohnungssuche-a8a86.firebasestorage.app',
      messagingSenderId: '999881136473',
      appId: '1:999881136473:web:dafc2f4914b5773286d448'
    },

    // Shared document the two phones sync through. Both app installs use the
    // same value, so ratings/notes appear on both devices automatically.
    household: 'stewalpp-gishaa',

    // The two people. Names are editable in "Mehr" and synced via Firestore;
    // these are only the defaults shown until someone changes them.
    members: [
      { id: 'p1', name: 'Steffen', color: '#0A84FF', github: 'stewalpp' },
      { id: 'p2', name: 'Partnerin', color: '#30D158', github: 'gishaa-create' }
    ],

    // Relative to the app root on GitHub Pages — written by the Python scraper.
    feedUrl: 'data/listings.json',

    // The GitHub issue used for push notifications (kept as-is).
    issueRepo: 'stewalpp/Wohnungssuche'
  };
})();
