# Wohnungssuche – App (PWA)

Eine installierbare Smartphone-App (Progressive Web App) im Apple-/iOS-Design,
mit der ihr die automatisch gefundenen Wohnungen durchseht, gemeinsam bewertet
und favorisiert. Sie wird über **GitHub Pages** kostenlos gehostet; die
Wohnungsliste kommt aus derselben automatischen Suche, die auch das
GitHub-Issue füttert.

**Live (nach Aktivierung von GitHub Pages):**
`https://stewalpp.github.io/Wohnungssuche/`

## Wie es zusammenhängt

```
GitHub Actions (4×/Tag)            GitHub Pages (docs/)            Firebase (gratis)
┌────────────────────┐            ┌────────────────────┐         ┌────────────────┐
│ wohnungssuche.search│ schreibt  │ index.html + JS/CSS │  liest  │ Firestore      │
│  → docs/data/       │──────────▶│  zeigt die Liste    │◀───────▶│  Bewertungen,  │
│     listings.json   │  (commit) │  (beide Handys)     │  Sync   │  Notizen, Favs │
└────────────────────┘            └────────────────────┘         └────────────────┘
```

- **Wohnungsdaten** (Preis, Größe, Lage …) sind für beide gleich, weil sie aus
  derselben Datei `docs/data/listings.json` kommen. Kein bezahltes API – die
  Daten werden vom Scraper ins Repo committet und von GitHub Pages ausgeliefert.
- **Eure Bewertungen / Notizen / Favoriten** werden in Echtzeit zwischen beiden
  Geräten über ein kostenloses Firebase-Projekt synchronisiert (Spark-Tarif).
- **Benachrichtigung** über neue Treffer läuft wie bisher über das GitHub-Issue
  „Neue Wohnungsangebote“ (GitHub-Mobile-Push).

## GitHub Pages aktivieren (einmalig)

Repository → **Settings → Pages** →
*Build and deployment* → *Source: Deploy from a branch* →
Branch **`main`**, Ordner **`/docs`** → **Save**.
Nach 1–2 Minuten ist die App unter der Live-URL erreichbar. `.nojekyll`
verhindert, dass GitHub die Dateien per Jekyll verarbeitet.

Danach auf dem iPhone in Safari öffnen → Teilen → **„Zum Home-Bildschirm“**.
Auf Android in Chrome → Menü → **„App installieren“**.

## Tech-Stack & Regeln

- **Reines HTML/CSS/Vanilla-JS, kein Build-Schritt, keine Frameworks, kein npm.**
  Klassische `<script>`-Dateien (IIFE → `window.*`), **keine ES-Module** – einzige
  Ausnahme: das dynamische `import()` des Firebase-SDK in `js/store.js`.
- **Alle Pfade relativ** (`css/style.css`, `./sw.js`) – läuft in einem Unterordner.
- **XSS-sicher:** Nutzer-/Feed-Inhalte nur via `textContent` rendern.
- Geld als Zahl in Euro (der Feed liefert `price_eur`); Anzeige über `App.fmtEUR`.

## Dateistruktur

```
docs/
  index.html              App-Shell (Header, Tab-Bar, Sheet/Toast-Roots), Skript-Reihenfolge
  manifest.json           PWA-Manifest
  sw.js                   Service Worker (CACHE-Version! Feed wird nie aus Cache bedient)
  .nojekyll               schaltet Jekyll auf GitHub Pages ab
  css/style.css           iOS-Design-System (Light/Dark, „Liquid Glass“) – aus der Finanz-App
  icons/                  App-Icons (per tools/make_icons.py erzeugt)
  data/listings.json      vom Scraper geschriebener Feed (Quelle der Wohnungsliste)
  js/config.js            window.WS_CONFIG: Firebase-Config, Haushalts-Code, Mitglieder, Feed-URL
  js/core.js              window.App: Formatierung, Icons, Sheet, Confirm, Toast, Theme
  js/feed.js              window.Feed: lädt/cached listings.json, onChange
  js/store.js             window.Store: Bewertungen/Notizen/Favoriten – lokal + Firebase-Sync
  js/filters.js           window.ListFilter: Filtern & Sortieren (lokal gespeichert)
  js/views/listings.js    Views.listings – Hauptliste + Detail-Sheet + Bewertung
  js/views/favorites.js   Views.favorites – engere Auswahl (Favoriten + „beide: Gut“)
  js/views/settings.js    Views.settings – „Mehr“: Sync, Namen, Darstellung, Aktualisieren
  js/app.js               Boot: Tabs, „neu seit letztem Besuch“, Auto-Refresh, SW-Registrierung
```

**Skript-Ladereihenfolge** (in `index.html`, nicht ändern):
`config → core → feed → store → filters → views/listings → views/favorites →
views/settings → app`.

## Service-Worker beim Ändern beachten

Bei jeder Änderung an Assets die `CACHE`-Konstante in `sw.js` erhöhen
(`wohnungssuche-vN` → `vN+1`), sonst bekommen installierte Apps das Update nicht.
`docs/data/listings.json` wird absichtlich **nie** aus dem Cache bedient.

## Lokal testen

Ein statischer Webserver ist nötig (Service-Worker + Firebase-`import()` laufen
nicht über `file://`):

```bash
python -m http.server 8765 --directory docs
# dann http://127.0.0.1:8765/
```

## Firebase (Sync)

- Projekt **Wohnungssuche** (`wohnungssuche-a8a86`), Spark-Tarif (kostenlos).
- Anonyme Anmeldung aktiv; Firestore-Regel: `allow read, write: if request.auth != null;`.
- Datenlayout: `households/{code}/ratings/{listingId}` und
  `households/{code}/meta/settings`. Der Haushalts-Code steht in `config.js`.
- **Sicherheitshinweis:** Die Firebase-Web-Config in `config.js` ist *kein*
  Geheimnis (sie wird ohnehin an jeden Web-Client ausgeliefert). In einem
  öffentlichen Repository ist sie damit sichtbar; der Schutz beruht auf der
  Firestore-Regel und dem Haushalts-Code. Da hier nur Wohnungs-Bewertungen und
  -Notizen liegen, ist das Risiko gering. Wer es strenger möchte: Repo privat
  stellen (GitHub Pages bleibt erreichbar) oder Firebase App Check aktivieren.
