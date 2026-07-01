/* ============================================================
   Möbelverkauf — js/store.js
   window.Store: offline-first Speicher für eure Verkaufsobjekte
   (Name, Kategorie, Wunschpreis, Erlös, Status, Käufer …) + die
   Personen-Einstellungen.

   Modus 'cloud': gemeinsames Firebase-Projekt (Firestore, anonyme
   Anmeldung), in Echtzeit zwischen beiden Handys synchronisiert.
   Modus 'local': nur localStorage (wenn Sync aus ist oder Firebase
   gerade nicht erreichbar ist).

   Firestore-Aufbau:
     households/{CODE}/items/{itemId}
     households/{CODE}/meta/settings

   Der einzige dynamische import() lebt hier (Firebase JS SDK vom
   gstatic-CDN), lazy beim Verbinden. Sonst klassisches Script.
   ============================================================ */
(function () {
  'use strict';

  var LS_ITEMS = 'mv.items';
  var LS_SETTINGS = 'mv.settings';
  var LS_LOCAL_ONLY = 'mv.localOnly';

  var FB_BASE = 'https://www.gstatic.com/firebasejs/10.12.5/';
  var FB_APP_NAME = 'moebelverkauf';

  // -------------------------------------------------------------------- state

  var items = {};              // itemId -> item-Objekt
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
    var members = (window.MV_CONFIG && MV_CONFIG.members) || [
      { id: 'p1', name: 'Person 1', color: '#3E6B5B' },
      { id: 'p2', name: 'Person 2', color: '#C75E4C' }
    ];
    return {
      onboarded: false,
      members: members.map(function (m) { return { id: m.id, name: m.name, color: m.color }; })
    };
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function str(v) { return typeof v === 'string' ? v : ''; }

  function validStatus(v) { return (window.Catalog && Catalog.isStatus(v)) ? v : 'offen'; }
  function validCategory(v) { return (window.Catalog && Catalog.isCategory(v)) ? v : 'sonstiges'; }

  function normalizeItem(raw, id) {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
      id: id || raw.id || App.uid(),
      name: str(raw.name),
      // category wird nicht mehr aktiv erfasst, bleibt aber als Icon-Quelle
      // erhalten (alte Objekte) – Default 'sonstiges' (📦).
      category: validCategory(raw.category),
      // minPrice + wishPrice ersetzen den früheren einzelnen askingPrice.
      // Migrations-Fallback: alte Objekte (nur askingPrice) -> wishPrice.
      minPrice: num(raw.minPrice),
      wishPrice: num(raw.wishPrice != null ? raw.wishPrice : raw.askingPrice),
      soldPrice: num(raw.soldPrice),
      status: validStatus(raw.status),
      buyer: str(raw.buyer),
      note: str(raw.note),
      photo: typeof raw.photo === 'string' ? raw.photo : '',
      deleted: !!raw.deleted,
      soldAt: typeof raw.soldAt === 'string' && raw.soldAt ? raw.soldAt : null,
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : nowISO(),
      updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : nowISO()
    };
  }

  // Beim Einrichten der App wurde ein Test-Dokument angelegt, um die
  // Firebase-Verbindung zu prüfen. Echtes Löschen ist per Regel gesperrt,
  // deshalb wird diese eine ID dauerhaft ausgeblendet.
  var IGNORED_IDS = { 'probe-claude-temp': 1 };

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

  function persistItems() { writeJSON(LS_ITEMS, items); }
  function persistSettings() { writeJSON(LS_SETTINGS, settings); }

  // -------------------------------------------------------- cloud: SDK & app

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
      // Bewusst KEIN Schreiben des übergeordneten households/{code}-Dokuments:
      // die Firestore-Regeln geben nur die Unter-Sammlungen (items, meta,
      // ratings) frei, nicht das Eltern-Dokument. Firestore legt
      // Unter-Sammlungen auch ohne Eltern-Dokument an.
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
      fs.collection(db, 'households', code, 'items'),
      function (snap) {
        // Der Offline-Cache liefert vor den echten Daten einen leeren Snapshot –
        // niemals damit bereits vorhandene Objekte überschreiben.
        if (snap.metadata && snap.metadata.fromCache && snap.empty && Object.keys(items).length > 0) return;

        var next = {};
        snap.docs.forEach(function (d) { next[d.id] = normalizeItem(d.data(), d.id); });

        // Lokal angelegte Objekte schützen, die der Server noch nicht hat (z. B.
        // im Local-Only-Modus oder auf einem frischen Gerät vor dem ersten
        // Verbinden erstellt): behalten und hochschieben, statt sie durch die
        // Server-Sicht löschen zu lassen.
        var missing = Object.keys(items).filter(function (id) { return !(id in next); });
        missing.forEach(function (id) {
          next[id] = items[id];
          cloudSetItem(id, items[id]);
        });

        // Lokale Soft-Deletes gewinnen: hat der Server noch eine veraltete,
        // nicht gelöschte Version eines lokal gelöschten Objekts (z. B. wenn
        // im Local-Only-Modus gelöscht und danach Sync wieder eingeschaltet
        // wurde), gelöscht halten und erneut hochschieben. "deleted" ist
        // monoton (es gibt kein Wiederherstellen), daher ist das sicher.
        Object.keys(items).forEach(function (id) {
          if (items[id] && items[id].deleted && next[id] && !next[id].deleted) {
            next[id] = items[id];
            cloudSetItem(id, { deleted: true, photo: '', updatedAt: items[id].updatedAt });
          }
        });

        items = next;
        persistItems();
        emit();
      },
      onErr('Objekte')
    ));

    cloud.unsubs.push(fs.onSnapshot(
      fs.doc(db, 'households', code, 'meta', 'settings'),
      function (snap) {
        if (!snap.exists()) {
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

  function itemRef(id) { return cloud.fs.doc(cloud.db, 'households', cloud.code, 'items', id); }
  function settingsRef() { return cloud.fs.doc(cloud.db, 'households', cloud.code, 'meta', 'settings'); }

  function cloudSetItem(id, data) {
    if (mode !== 'cloud' || !cloud) return;
    // Merge-Write: nur die geänderten Felder anfassen. Wenn beide Handys
    // dasselbe Objekt im Sync-Fenster bearbeiten, überschreibt keiner die
    // Felder des anderen. Beim Snapshot-Bootstrap ist `data` ein volles
    // Objekt, das der Merge genauso schreibt.
    cloud.fs.setDoc(itemRef(id), clean(data), { merge: true }).catch(function (e) { console.warn('Cloud-Schreibvorgang (Objekt) fehlgeschlagen:', e); });
  }
  function cloudSetSettings() {
    if (mode !== 'cloud' || !cloud) return;
    cloud.fs.setDoc(settingsRef(), clean(settings)).catch(function (e) { console.warn('Cloud-Schreibvorgang (Einstellungen) fehlgeschlagen:', e); });
  }

  // ----------------------------------------------------------------- the API

  function init() {
    items = {};
    var stored = readJSON(LS_ITEMS, {});
    if (stored && typeof stored === 'object') {
      Object.keys(stored).forEach(function (id) { items[id] = normalizeItem(stored[id], id); });
    }
    settings = normalizeSettings(readJSON(LS_SETTINGS, null));

    var localOnly = false;
    try { localOnly = localStorage.getItem(LS_LOCAL_ONLY) === '1'; } catch (e) { /* ok */ }

    var cfg = window.MV_CONFIG && MV_CONFIG.firebase;
    var code = (window.MV_CONFIG && MV_CONFIG.household) || 'haushalt';
    if (localOnly || !cfg || !cfg.apiKey) {
      mode = 'local';
      return Promise.resolve();
    }
    return connect(cfg, code).catch(function (e) {
      connectError = e;
      console.warn('Cloud-Sync nicht erreichbar:', e);
      // Mit lokalen Daten benutzbar bleiben.
    });
  }

  function getMode() { return mode; }

  function syncStatus() {
    return {
      connected: mode === 'cloud' && !!cloud,
      household: cloud ? cloud.code : ((window.MV_CONFIG && MV_CONFIG.household) || null),
      projectId: cloud ? cloud.projectId : ((window.MV_CONFIG && MV_CONFIG.firebase && MV_CONFIG.firebase.projectId) || null),
      error: connectError ? (connectError.message || String(connectError)) : null
    };
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }

  // -------- items

  function isVisible(it) {
    return it && !it.deleted && !IGNORED_IDS[it.id];
  }

  function getItem(id) {
    if (!items[id] || IGNORED_IDS[id]) return null;
    var it = normalizeItem(items[id], id);
    return it.deleted ? null : it;
  }

  // Nur sichtbare (nicht soft-gelöschte) Objekte.
  function getItems() {
    return Object.keys(items)
      .map(function (id) { return normalizeItem(items[id], id); })
      .filter(isVisible);
  }

  // Neues Objekt anlegen. `data` = Teilfelder; gibt das angelegte Objekt zurück.
  function addItem(data) {
    var id = App.uid();
    var item = normalizeItem(Object.assign({}, data, { id: id, createdAt: nowISO(), updatedAt: nowISO() }), id);
    if (item.status === 'verkauft' && !item.soldAt) item.soldAt = nowISO();
    items[id] = item;
    persistItems();
    cloudSetItem(id, item);
    emit();
    return item;
  }

  // Bestehendes Objekt ändern. `patch` = nur geänderte Felder.
  function updateItem(id, patch) {
    if (!items[id]) return null;
    var current = normalizeItem(items[id], id);
    var merged = Object.assign({}, current, patch);
    // Verkaufsdatum richtet sich nach dem Status: nur "verkauft" hat ein
    // soldAt. Beim Wechsel weg von "verkauft" wird es wieder geleert.
    if (merged.status === 'verkauft') {
      if (!merged.soldAt) merged.soldAt = nowISO();
    } else {
      merged.soldAt = null;
    }
    merged.updatedAt = nowISO();
    var next = normalizeItem(merged, id);
    items[id] = next;
    persistItems();
    // nur die geänderten Felder (+ abgeleitete) hochschieben
    var changed = Object.assign({}, patch, { updatedAt: next.updatedAt, soldAt: next.soldAt });
    cloudSetItem(id, changed);
    emit();
    return next;
  }

  // Soft-Delete: echtes Löschen ist per Firestore-Regel gesperrt, deshalb wird
  // das Objekt auf deleted=true gesetzt (Update, erlaubt) und überall
  // ausgeblendet. Das Foto wird dabei entfernt, um Platz zu sparen.
  function deleteItem(id) {
    if (!items[id]) return;
    var next = normalizeItem(Object.assign({}, items[id], { deleted: true, photo: '', updatedAt: nowISO() }), id);
    items[id] = next;
    persistItems();
    cloudSetItem(id, { deleted: true, photo: '', updatedAt: next.updatedAt });
    emit();
  }

  function clearAllItems() {
    Object.keys(items).forEach(function (id) {
      var cur = normalizeItem(items[id], id);
      if (cur.deleted || IGNORED_IDS[id]) return;
      var next = normalizeItem(Object.assign({}, cur, { deleted: true, photo: '', updatedAt: nowISO() }), id);
      items[id] = next;
      cloudSetItem(id, { deleted: true, photo: '', updatedAt: next.updatedAt });
    });
    persistItems();
    emit();
  }

  // -------- settings

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

  // Sync pro Gerät an/aus.
  function setLocalOnly(on) {
    try { localStorage.setItem(LS_LOCAL_ONLY, on ? '1' : '0'); } catch (e) { /* ok */ }
    if (on) {
      teardownCloud();
      emit();
      return Promise.resolve();
    }
    var cfg = window.MV_CONFIG && MV_CONFIG.firebase;
    var code = (window.MV_CONFIG && MV_CONFIG.household) || 'haushalt';
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
    getItem: getItem,
    getItems: getItems,
    addItem: addItem,
    updateItem: updateItem,
    deleteItem: deleteItem,
    clearAllItems: clearAllItems,
    getSettings: getSettings,
    updateSettings: updateSettings,
    memberName: memberName,
    memberColor: memberColor,
    setLocalOnly: setLocalOnly,
    isLocalOnly: isLocalOnly
  };
})();
