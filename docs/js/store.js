/* ============================================================
   Wohnungssuche — js/store.js
   window.Store: offline-first store for the couple's per-listing
   ratings, notes, favourites and hidden flags + member settings.

   Mode 'cloud': the shared Firebase project (Firestore, anonymous auth),
   real-time synced between both phones. Mode 'local': localStorage only
   (used when sync is turned off or Firebase is unreachable).

   Firestore layout:
     households/{CODE}/ratings/{listingId}
     households/{CODE}/meta/settings

   The only dynamic import() in this app lives here (Firebase JS SDK from
   the gstatic CDN), loaded lazily on connect. Classic script otherwise.
   ============================================================ */
(function () {
  'use strict';

  var LS_RATINGS = 'ws.ratings';
  var LS_SETTINGS = 'ws.settings';
  var LS_LOCAL_ONLY = 'ws.localOnly';

  var FB_BASE = 'https://www.gstatic.com/firebasejs/10.12.5/';
  var FB_APP_NAME = 'wohnungssuche';

  // -------------------------------------------------------------------- state

  var ratings = {};            // listingId -> rating object
  var settings = defaultSettings();

  var mode = 'local';          // 'local' | 'cloud'
  var cloud = null;            // { app, db, auth, fs, code, projectId, unsubs[] }
  var fbMods = null;
  var connectError = null;

  var listeners = [];

  // ------------------------------------------------------------ tiny helpers

  function nowISO() { return new Date().toISOString(); }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](); } catch (e) { console.error('Store-Listener fehlgeschlagen:', e); }
    }
  }

  function clean(value) {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return value.map(clean);
    if (typeof value === 'object') {
      var out = {};
      for (var k in value) if (Object.prototype.hasOwnProperty.call(value, k)) out[k] = clean(value[k]);
      return out;
    }
    return value;
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw === null || raw === undefined) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
  }

  // ------------------------------------------------------------- data shapes

  function defaultSettings() {
    var members = (window.WS_CONFIG && WS_CONFIG.members) || [
      { id: 'p1', name: 'Person 1', color: '#0A84FF' },
      { id: 'p2', name: 'Person 2', color: '#30D158' }
    ];
    return {
      onboarded: false,
      members: members.map(function (m) { return { id: m.id, name: m.name, color: m.color }; })
    };
  }

  var VALID_RATINGS = { gut: 1, vielleicht: 1, schlecht: 1 };
  var VALID_STATUS = { angefragt: 1, besichtigung: 1, zusage: 1, absage: 1 };

  function normalizeRating(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    function pr(v) { return typeof v === 'string' && VALID_RATINGS[v] ? v : null; }
    return {
      p1: pr(raw.p1),
      p2: pr(raw.p2),
      favorite: !!raw.favorite,
      hidden: !!raw.hidden,
      status: typeof raw.status === 'string' && VALID_STATUS[raw.status] ? raw.status : '',
      note: typeof raw.note === 'string' ? raw.note : '',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowISO()
    };
  }

  function normalizeSettings(raw) {
    var def = defaultSettings();
    if (!raw || typeof raw !== 'object') return def;
    var out = { onboarded: !!raw.onboarded, members: [] };
    var given = Array.isArray(raw.members) ? raw.members : [];
    out.members = def.members.map(function (dm) {
      var found = given.find(function (m) { return m && m.id === dm.id; }) || {};
      return {
        id: dm.id,
        name: typeof found.name === 'string' && found.name ? found.name : dm.name,
        color: typeof found.color === 'string' && found.color ? found.color : dm.color
      };
    });
    return out;
  }

  function persistRatings() { writeJSON(LS_RATINGS, ratings); }
  function persistSettings() { writeJSON(LS_SETTINGS, settings); }

  // -------------------------------------------------------- cloud: SDK & app

  function fail(message) { var e = new Error(message); e.german = true; throw e; }

  function loadFirebase() {
    if (fbMods) return Promise.resolve(fbMods);
    return Promise.all([
      import(FB_BASE + 'firebase-app.js'),
      import(FB_BASE + 'firebase-auth.js'),
      import(FB_BASE + 'firebase-firestore.js')
    ]).then(function (mods) {
      fbMods = { app: mods[0], auth: mods[1], fs: mods[2] };
      return fbMods;
    });
  }

  function germanError(e) {
    if (e && e.german) return e;
    var code = String((e && e.code) || '');
    var msg;
    if (code.indexOf('auth/operation-not-allowed') === 0 || code === 'auth/configuration-not-found' || code === 'auth/admin-restricted-operation') {
      msg = 'Anonyme Anmeldung ist in Firebase nicht aktiviert.';
    } else if (/api-key/.test(code)) {
      msg = 'Der Firebase-API-Schlüssel ist ungültig.';
    } else if (code === 'auth/network-request-failed' || code === 'unavailable') {
      msg = 'Keine Verbindung zu Firebase.';
    } else if (code === 'permission-denied') {
      msg = 'Zugriff verweigert – bitte Firestore-Regeln prüfen.';
    } else {
      msg = 'Sync fehlgeschlagen: ' + ((e && (e.message || e.code)) || 'Unbekannter Fehler');
    }
    var err = new Error(msg); err.german = true; return err;
  }

  function connect(config, code) {
    var mods, app;
    return loadFirebase().then(function (m) {
      mods = m;
      var prior = mods.app.getApps().find(function (a) { return a.name === FB_APP_NAME; });
      if (prior) { try { mods.app.deleteApp(prior); } catch (e) { /* ok */ } }
      app = mods.app.initializeApp(config, FB_APP_NAME);

      var db;
      try {
        db = mods.fs.initializeFirestore(app, {
          localCache: mods.fs.persistentLocalCache({ tabManager: mods.fs.persistentMultipleTabManager() })
        });
      } catch (e) {
        db = mods.fs.getFirestore(app);
      }

      var auth = mods.auth.getAuth(app);
      return new Promise(function (resolve) {
        var stop = mods.auth.onAuthStateChanged(auth, function () { stop(); resolve({ db: db, auth: auth }); }, function () { resolve({ db: db, auth: auth }); });
      }).then(function (ctx) {
        if (!ctx.auth.currentUser) return mods.auth.signInAnonymously(ctx.auth).then(function () { return ctx; });
        return ctx;
      });
    }).then(function (ctx) {
      return mods.fs.setDoc(mods.fs.doc(ctx.db, 'households', code), { createdAt: nowISO() }, { merge: true }).then(function () { return ctx; });
    }).then(function (ctx) {
      cloud = { app: app, db: ctx.db, auth: ctx.auth, fs: mods.fs, code: code, projectId: config.projectId || null, unsubs: [] };
      wireSnapshots();
      mode = 'cloud';
      connectError = null;
    }).catch(function (e) {
      cloud = null;
      mode = 'local';
      if (app) { try { mods.app.deleteApp(app); } catch (e2) { /* ok */ } }
      throw germanError(e);
    });
  }

  function wireSnapshots() {
    var fs = cloud.fs, db = cloud.db, code = cloud.code;
    var onErr = function (label) { return function (err) { console.warn('Snapshot (' + label + ') fehlgeschlagen:', err); }; };

    cloud.unsubs.push(fs.onSnapshot(
      fs.collection(db, 'households', code, 'ratings'),
      function (snap) {
        // Offline cache delivers an empty snapshot before the real data arrives —
        // never let it wipe ratings we already hold.
        if (snap.metadata && snap.metadata.fromCache && snap.empty && Object.keys(ratings).length > 0) return;

        var next = {};
        snap.docs.forEach(function (d) { next[d.id] = normalizeRating(d.data()); });

        // Protect locally-made ratings (e.g. created in local-only mode, or on a
        // fresh device before the first connect) that the server doesn't have yet:
        // keep them and push them up instead of letting the server view clear them.
        var missing = Object.keys(ratings).filter(function (id) { return !(id in next); });
        missing.forEach(function (id) {
          next[id] = ratings[id];
          cloudSetRating(id, ratings[id]);
        });

        ratings = next;
        persistRatings();
        emit();
      },
      onErr('Bewertungen')
    ));

    cloud.unsubs.push(fs.onSnapshot(
      fs.doc(db, 'households', code, 'meta', 'settings'),
      function (snap) {
        if (!snap.exists()) {
          // Server has no settings doc yet (brand-new household). If THIS device
          // has finished onboarding, seed it so the partner device doesn't sit on
          // default names/colors forever. A non-onboarded device stays quiet so
          // it can never clobber real names with defaults. Only seed on a
          // SERVER-confirmed miss (never the offline cache's initial empty
          // snapshot), otherwise we'd overwrite real server settings with this
          // device's local copy on every cold start.
          if (settings.onboarded && !(snap.metadata && snap.metadata.fromCache)) cloudSetSettings();
          return;
        }
        settings = normalizeSettings(snap.data());
        persistSettings();
        emit();
      },
      onErr('Einstellungen')
    ));
  }

  function teardownCloud() {
    if (cloud) {
      cloud.unsubs.forEach(function (u) { try { u(); } catch (e) { /* ok */ } });
      var app = cloud.app;
      cloud = null;
      if (fbMods && fbMods.app && app) fbMods.app.deleteApp(app).catch(function () {});
    }
    mode = 'local';
  }

  // ----------------------------------------------------- cloud: doc plumbing

  function ratingRef(id) { return cloud.fs.doc(cloud.db, 'households', cloud.code, 'ratings', id); }
  function settingsRef() { return cloud.fs.doc(cloud.db, 'households', cloud.code, 'meta', 'settings'); }

  function cloudSetRating(id, data) {
    if (mode !== 'cloud' || !cloud) return;
    // Merge-write so we only touch the field(s) we actually changed. If both
    // phones edit the same listing's rating doc inside the sync window, neither
    // overwrites the other's field (p1/p2/note/status/favorite). `data` is the
    // changed-fields patch from mutate(); on the snapshot bootstrap path it's a
    // full rating object, which merge writes just as well.
    cloud.fs.setDoc(ratingRef(id), clean(data), { merge: true }).catch(function (e) { console.warn('Cloud-Schreibvorgang (Bewertung) fehlgeschlagen:', e); });
  }
  function cloudSetSettings() {
    if (mode !== 'cloud' || !cloud) return;
    cloud.fs.setDoc(settingsRef(), clean(settings)).catch(function (e) { console.warn('Cloud-Schreibvorgang (Einstellungen) fehlgeschlagen:', e); });
  }

  // ----------------------------------------------------------------- the API

  function init() {
    ratings = {};
    var stored = readJSON(LS_RATINGS, {});
    if (stored && typeof stored === 'object') {
      Object.keys(stored).forEach(function (id) { ratings[id] = normalizeRating(stored[id]); });
    }
    settings = normalizeSettings(readJSON(LS_SETTINGS, null));

    var localOnly = false;
    try { localOnly = localStorage.getItem(LS_LOCAL_ONLY) === '1'; } catch (e) { /* ok */ }

    var cfg = window.WS_CONFIG && WS_CONFIG.firebase;
    var code = (window.WS_CONFIG && WS_CONFIG.household) || 'haushalt';
    if (localOnly || !cfg || !cfg.apiKey) {
      mode = 'local';
      return Promise.resolve();
    }
    return connect(cfg, code).catch(function (e) {
      connectError = e;
      console.warn('Cloud-Sync nicht erreichbar:', e);
      // Stay usable with local data.
    });
  }

  function getMode() { return mode; }

  function syncStatus() {
    return {
      connected: mode === 'cloud' && !!cloud,
      household: cloud ? cloud.code : ((window.WS_CONFIG && WS_CONFIG.household) || null),
      projectId: cloud ? cloud.projectId : ((window.WS_CONFIG && WS_CONFIG.firebase && WS_CONFIG.firebase.projectId) || null),
      error: connectError ? (connectError.message || String(connectError)) : null
    };
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }

  function getRating(id) {
    return normalizeRating(ratings[id] || {});
  }

  function getAllRatings() {
    var out = {};
    Object.keys(ratings).forEach(function (id) { out[id] = normalizeRating(ratings[id]); });
    return out;
  }

  function mutate(id, patch) {
    var current = normalizeRating(ratings[id] || {});
    var stamped = Object.assign({}, patch, { updatedAt: nowISO() });
    var next = normalizeRating(Object.assign({}, current, stamped));
    ratings[id] = next;
    persistRatings();
    // Push only the changed fields (+updatedAt), merged — see cloudSetRating.
    cloudSetRating(id, stamped);
    emit();
    return next;
  }

  function setPersonRating(id, personId, value) {
    if (personId !== 'p1' && personId !== 'p2') return;
    var v = VALID_RATINGS[value] ? value : null;
    // toggle off if the same value is tapped again
    var current = getRating(id);
    if (current[personId] === v) v = null;
    var patch = {}; patch[personId] = v;
    return mutate(id, patch);
  }

  function toggleFavorite(id) {
    return mutate(id, { favorite: !getRating(id).favorite });
  }

  function setHidden(id, hidden) {
    return mutate(id, { hidden: !!hidden });
  }

  function setNote(id, note) {
    return mutate(id, { note: typeof note === 'string' ? note : '' });
  }

  function setStatus(id, value) {
    return mutate(id, { status: VALID_STATUS[value] ? value : '' });
  }

  function getSettings() {
    return { onboarded: settings.onboarded, members: settings.members.map(function (m) { return Object.assign({}, m); }) };
  }

  function updateSettings(patch) {
    patch = patch || {};
    var next = { onboarded: settings.onboarded, members: settings.members.slice() };
    if (typeof patch.onboarded === 'boolean') next.onboarded = patch.onboarded;
    if (Array.isArray(patch.members)) {
      next.members = settings.members.map(function (cur) {
        var upd = patch.members.find(function (m) { return m && m.id === cur.id; }) || {};
        return {
          id: cur.id,
          name: typeof upd.name === 'string' && upd.name ? upd.name : cur.name,
          color: typeof upd.color === 'string' && upd.color ? upd.color : cur.color
        };
      });
    }
    settings = normalizeSettings(next);
    persistSettings();
    cloudSetSettings();
    emit();
    return getSettings();
  }

  function memberName(id) {
    var m = settings.members.find(function (x) { return x.id === id; });
    return m ? m.name : '';
  }
  function memberColor(id) {
    var m = settings.members.find(function (x) { return x.id === id; });
    return m ? m.color : '#8E8E93';
  }

  // Turn sync on/off (per device).
  function setLocalOnly(on) {
    try { localStorage.setItem(LS_LOCAL_ONLY, on ? '1' : '0'); } catch (e) { /* ok */ }
    if (on) {
      teardownCloud();
      emit();
      return Promise.resolve();
    }
    var cfg = window.WS_CONFIG && WS_CONFIG.firebase;
    var code = (window.WS_CONFIG && WS_CONFIG.household) || 'haushalt';
    if (!cfg || !cfg.apiKey) {
      var err = new Error('Firebase ist nicht konfiguriert.'); err.german = true;
      connectError = err;
      mode = 'local';
      emit();
      return Promise.resolve();
    }
    return connect(cfg, code).then(function () { emit(); }).catch(function (e) { connectError = e; emit(); });
  }
  function isLocalOnly() {
    try { return localStorage.getItem(LS_LOCAL_ONLY) === '1'; } catch (e) { return false; }
  }

  window.Store = {
    init: init,
    getMode: getMode,
    syncStatus: syncStatus,
    onChange: onChange,
    getRating: getRating,
    getAllRatings: getAllRatings,
    setPersonRating: setPersonRating,
    toggleFavorite: toggleFavorite,
    setHidden: setHidden,
    setNote: setNote,
    setStatus: setStatus,
    getSettings: getSettings,
    updateSettings: updateSettings,
    memberName: memberName,
    memberColor: memberColor,
    setLocalOnly: setLocalOnly,
    isLocalOnly: isLocalOnly
  };
})();
