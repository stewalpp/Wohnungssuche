# Such-Trigger über Cloudflare Worker

Damit der Button **„Neue Suche jetzt starten"** in der App (Mehr → Daten) den
GitHub-Actions-Workflow direkt auslöst – ohne ein GitHub-Token in die App zu
legen. Das Token liegt **nur** im Worker (verschlüsseltes Secret); der Worker
ruft die GitHub-API serverseitig auf.

**Kosten:** Cloudflare Workers Free-Tier = 100.000 Requests/Tag. Für einen
Button völlig gratis.

---

## 1. GitHub-Token erstellen (fein-granular)

1. GitHub → Settings → **Developer settings** → **Personal access tokens** →
   **Fine-grained tokens** → **Generate new token**.
2. **Resource owner:** dein Account. **Repository access:** *Only select
   repositories* → `stewalpp/Wohnungssuche`.
3. **Permissions** → **Repository permissions** → **Actions: Read and write**.
   (Mehr ist nicht nötig.)
4. Ablaufdatum nach Wunsch, **Generate token**, Token **kopieren** (wird nur
   einmal angezeigt).

> Falls der Dispatch später `403` liefert: alternativ ein *classic* Token mit
> Scope **`workflow`** verwenden – funktioniert genauso.

## 2. Shared-Secret wählen (optional, empfohlen)

Ein beliebiger Zufallsstring, den App und Worker teilen. Erzeugen z. B.:

```bash
openssl rand -hex 16
```

> Hinweis: Dieses Secret landet im App-Code und ist daher **nicht wirklich
> geheim** – es hält nur Bots/Zufallszugriffe ab. Der echte Schutz ist, dass das
> GitHub-Token den Worker nie verlässt. Zusätzlich blockt der Worker fremde
> Origins und hat einen 60-Sekunden-Cooldown.

## 3. Worker deployen

### Variante A – CLI (wrangler)

```bash
npm install -g wrangler
cd cloudflare-worker
wrangler login
wrangler secret put GH_TOKEN      # Token aus Schritt 1 einfügen
wrangler secret put APP_SECRET    # Secret aus Schritt 2 (oder weglassen)
wrangler deploy
```

`wrangler deploy` gibt die URL aus, z. B.
`https://wohnungssuche-trigger.DEIN-NAME.workers.dev`.

### Variante B – Dashboard (ohne CLI)

1. Cloudflare-Dashboard → **Workers & Pages** → **Create** → **Worker** →
   Namen vergeben → **Deploy** → **Edit code**.
2. Inhalt von [`worker.js`](worker.js) einfügen → **Deploy**.
3. **Settings → Variables**:
   - **Variables (plain):** `ALLOW_ORIGIN = https://stewalpp.github.io`,
     `REPO = stewalpp/Wohnungssuche`, `WORKFLOW = daily-search.yml`, `REF = main`.
   - **Secrets (Encrypt):** `GH_TOKEN` = dein Token, `APP_SECRET` = dein Secret.
4. URL des Workers notieren.

## 4. App verbinden

In [`docs/js/config.js`](../docs/js/config.js) den `trigger`-Block ausfüllen:

```js
trigger: {
  url: 'https://wohnungssuche-trigger.DEIN-NAME.workers.dev',
  secret: 'DEIN_APP_SECRET'   // identisch zu APP_SECRET im Worker (oder beide leer)
}
```

Committen + pushen. Danach erscheint in der App unter **Mehr → Daten** der
Button **„Neue Suche jetzt starten"**.

## 5. Testen

```bash
curl -i -X POST https://wohnungssuche-trigger.DEIN-NAME.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: DEIN_APP_SECRET" -d '{}'
```

Erwartet: `HTTP/1.1 200` und `{"ok":true}`. In **Actions** sollte sofort ein
neuer „Apartment search"-Lauf starten; neue Treffer erscheinen 1–2 Minuten
später automatisch in der App.

## Sicherheit / „kann das jeder starten?"

- Ohne Worker: nur Collaborator mit Schreibrechten (über die GitHub-Seite).
- Mit Worker: jeder, der die App **und** das (mitgelieferte) Secret hat, kann
  einen Lauf auslösen. Folgen sind gering – es startet nur die Suche.
- Schutzschichten hier: Origin-Allowlist, optionales Secret, 60-s-Cooldown,
  und der Workflow selbst nutzt `concurrency` (parallele Läufe brechen ab).
- Für mehr Schutz: in Cloudflare zusätzlich eine **Rate-Limiting-Rule** auf die
  Worker-Route legen.
