# Wohnungssuche Hannover - Barsinghausen

Diese Automation sucht viermal taeglich nach neuen Mietwohnungen zwischen
Hannover und Barsinghausen. Bereits gemeldete Wohnungen werden in
`data/seen_listings.json` gespeichert und beim naechsten Lauf nicht erneut
ausgegeben.

## Kriterien

- mindestens 3 Zimmer
- mindestens 70 qm
- maximal 1.000 EUR Gesamtmiete, soweit aus dem Inserat erkennbar
- Erdgeschoss, Parterre oder Hochparterre bevorzugt
- gute Verbindung Richtung Hannover
- kein Altbau und keine offensichtlichen Energie-/Kosten-Red-Flags

Nebenkosten, Heizkosten und Energieausweis stehen auf Suchseiten oft nicht
vollstaendig. Die Automation markiert solche Treffer deshalb mit
`Bitte pruefen`, damit sie nicht faelschlich ausgeschlossen werden.
Wohnungen, die bei Preis, Groesse, Zimmerzahl und Lage passen, aber nicht im
Erdgeschoss/Parterre liegen, erscheinen getrennt als `Pruefkandidaten`.

## Einrichtung

1. In `config/search.yml` die Suchquellen pruefen und bei Bedarf eigene
   gespeicherte Such-URLs der Portale ergaenzen.
2. Optional: Das GitHub-Repository beobachten, damit neue Issue-Kommentare
   als Benachrichtigung ankommen.
3. Die GitHub Action unter `.github/workflows/daily-search.yml` laeuft
   taeglich um 05:30, 10:30, 16:30 und 18:30 UTC. Das entspricht aktuell
   07:30, 12:30, 18:30 und 20:30 Uhr deutscher Sommerzeit. Sie kann
   zusaetzlich manuell ueber `workflow_dispatch` gestartet werden.

## Lokal testen

```bash
python -m venv .venv
. .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m wohnungssuche.search --config config/search.yml --state data/seen_listings.json --report reports/latest.md
```

Der Report wird nur dann in `reports/latest.md` und `reports/archive/`
geschrieben, wenn neue passende Inserate oder neue Pruefkandidaten gefunden
wurden. Die aktuelle Ausgabe steht immer im Terminal und in GitHub Actions im
Step Summary.

## Quellen anpassen

Die Datei `config/search.yml` enthaelt Startquellen fuer Immowelt,
ImmoScout24 und Kleinanzeigen. Am besten funktionieren gespeicherte
Suchseiten, auf denen die Portalfilter schon gesetzt sind:

- Miete bis 1.000 EUR
- mindestens 3 Zimmer
- mindestens 70 qm
- Ort oder Suchradius entlang Hannover, Seelze, Letter, Ronnenberg,
  Empelde, Gehrden, Wennigsen und Barsinghausen

Wenn ein Portal RSS anbietet, setze `type: rss`. Fuer normale Suchseiten
nutze `type: html`. Bereits gezeigte Inserate koennen durch Loeschen des
jeweiligen Eintrags in `data/seen_listings.json` erneut angezeigt werden.

## Benachrichtigung

Die GitHub Action erstellt oder aktualisiert automatisch ein Issue mit dem
Titel `Neue Wohnungsangebote`, wenn neue passende Treffer gefunden werden.
Neue Kommentare erwaehnen `@stewalpp`, damit GitHub Mobile eine direkte
Benachrichtigung ausloesen kann. Jeder Treffer wird nur einmal kommentiert,
weil seine ID im Seen-State gespeichert wird.
