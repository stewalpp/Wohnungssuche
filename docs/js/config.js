/* ============================================================
   js/config.js — window.MV_CONFIG
   Statische App-Konfiguration. Wird ZUERST geladen.

   Die Firebase-Web-Config unten ist KEIN Geheimnis: jeder Web-Client
   bekommt sie. Der Zugriff ist über die Firestore-Regel
   (`allow read, write: if request.auth != null;`) plus anonyme
   Anmeldung abgesichert. Für diese private Zwei-Personen-App sind die
   gespeicherten Daten (eure Verkaufsliste) unkritisch.

   Es ist DASSELBE Firebase-Projekt wie bei der früheren Wohnungssuche und
   bewusst DERSELBE `household`-Schlüssel ('stewalpp-gishaa'): nur dieser Pfad
   ist von den bestehenden Firestore-Regeln freigegeben. Die Verkaufsobjekte
   liegen aber in einer eigenen Unter-Sammlung `items`, getrennt von den alten
   Wohnungs-Bewertungen unter `ratings` (die unangetastet bleiben).

   Hinweis zu den Regeln: Anlegen/Ändern/Lesen sind erlaubt, echtes Löschen ist
   gesperrt. Die App nutzt deshalb "Soft-Delete" (Objekte werden per Update auf
   deleted=true gesetzt und überall ausgeblendet) – kein Firebase-Setup nötig.
   ============================================================ */
(function () {
  'use strict';

  window.MV_CONFIG = {
    // Firebase-Projekt "Wohnungssuche" (wohnungssuche-a8a86), Spark/Gratis-Tarif.
    firebase: {
      apiKey: 'AIzaSyAM958Bcf4kgLuWJwld0bXH1kKJOa45umg',
      authDomain: 'wohnungssuche-a8a86.firebaseapp.com',
      projectId: 'wohnungssuche-a8a86',
      storageBucket: 'wohnungssuche-a8a86.firebasestorage.app',
      messagingSenderId: '999881136473',
      appId: '1:999881136473:web:dafc2f4914b5773286d448'
    },

    // Gemeinsamer Bereich, über den eure zwei Handys syncen. Beide Installationen
    // nutzen denselben Wert, damit alle Objekte auf beiden Geräten erscheinen.
    // Bewusst der bestehende Haushalt – nur dieser Pfad ist von den
    // Firestore-Regeln freigegeben (siehe Kopf-Kommentar). Eigene Sammlung: items.
    household: 'stewalpp-gishaa',

    // Die zwei Personen. Namen sind unter "Mehr" editierbar und werden über
    // Firestore synchronisiert; das hier sind nur die Startwerte.
    members: [
      { id: 'p1', name: 'Steffen', color: '#3E6B5B' },
      { id: 'p2', name: 'Partnerin', color: '#C75E4C' }
    ]
  };
})();
