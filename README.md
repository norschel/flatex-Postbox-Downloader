# FlatexDeDownloader

Lädt alle Dokumente aus dem **flatex Online-Banking-Postfach** (Dokumentenarchiv)
automatisch als PDF herunter. Verfügbar als **Tampermonkey-Script (empfohlen)** und
als **DevTools-Snippet**.

Die Dokumente werden exakt über denselben Weg geladen wie beim manuellen Klick im
Postfach: Das Script klickt jede Dokumentzeile an, fängt die vom flatex-Frontend
erzeugte PDF-URL (`…/next-desktop/downloadData/…`) ab und speichert die Datei mit dem
von flatex vergebenen Namen.

> **Hinweis:** Das Anklicken eines Dokuments markiert es im Postfach als **gelesen**.

---

## Tampermonkey-Script (empfohlen)

### Schnellinstallation (ein Klick)

Tampermonkey muss bereits installiert sein. Anschließend genügt ein Klick auf den
folgenden Link – Tampermonkey öffnet automatisch den Installationsdialog:

[Install with Tampermonkey](https://raw.githubusercontent.com/norschel/FlatexDeDownloader/main/flatex_postbox_downloader.user.js)

Direktlink:
<https://raw.githubusercontent.com/norschel/FlatexDeDownloader/main/flatex_postbox_downloader.user.js>

**Automatische Updates:** Das Script enthält `@updateURL`/`@downloadURL`, die auf
dieses GitHub-Repository zeigen. Tampermonkey prüft daher selbständig, ob auf `main`
eine neuere Version (höhere `@version`) liegt, und bietet das Update an.

### Voraussetzungen

- Browser mit [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, …)
- Aktiver flatex-Online-Banking-Zugang unter [konto.flatex.de](https://konto.flatex.de/)

### Installation

1. Installiere die [Tampermonkey-Erweiterung](https://www.tampermonkey.net/) für deinen Browser.
2. **Wichtig (Chromium-basierte Browser ab Manifest V3 – Chrome/Edge/Brave):** Damit
   Tampermonkey Userscripts ausführen darf, müssen zwei Einstellungen aktiv sein. Ohne
   sie wird das Script stillschweigend nicht geladen (weder Button noch Konsolen-Logs).
   Details siehe [Tampermonkey-FAQ Q209](https://www.tampermonkey.net/faq.php?q=Q209#Q209).
   - **Entwicklermodus** aktivieren unter `chrome://extensions` bzw. `edge://extensions`.
   - **„Allow User Scripts" / „Benutzerskripte zulassen"** für die Tampermonkey-Erweiterung
     aktivieren (bei Tampermonkey auf „Details" klicken), anschließend Browser-Tab neu laden.
3. **Firefox:** Die Manifest-V3-Schalter sind hier nicht erforderlich – Tampermonkey
   funktioniert out-of-the-box.
4. Alternativ zur Schnellinstallation: Tampermonkey-Dashboard öffnen, neues Script anlegen
   und den Inhalt von
   [flatex_postbox_downloader.user.js](flatex_postbox_downloader.user.js) einfügen und speichern.

### Verwendung

1. Melde dich unter [konto.flatex.de](https://konto.flatex.de/) an.
2. Öffne das **Postfach** (Dashboard → Postfach). Wähle bei Bedarf den Tab
   **„Alle"** oder **„Nur Ungelesene"** bzw. setze den **nativen Datums-/Kategoriefilter**
   der flatex-Seite – das Script lädt genau die aktuell gelisteten Dokumente.
3. Klicke oben rechts auf den Button **⬇ Alle herunterladen**.
4. Der Button zeigt den Fortschritt (`⬇ 12/274…`); das Live-Log erscheint in der Konsole.
5. Am Ende erscheint eine Zusammenfassung (Erfolgreich/Fehlgeschlagen), optional zusätzlich
   als System-Benachrichtigung (`GM_notification`).
6. Die Dokumente landen im Standard-Download-Ordner.

> Manche Browser fragen ab dem zweiten automatischen Download nach einer Erlaubnis für
> „mehrere Dateien herunterladen". Diese Anfrage muss einmalig bestätigt werden.

### Konfiguration

Am Anfang des Scripts befindet sich ein `CONFIG`-Block:

```js
const CONFIG = {
  dryRun: false, // nur auflisten, nichts speichern (zum Testen)
  maxDocuments: 0, // max. Anzahl pro Lauf (0 = alle sichtbaren)
  filenamePrefix: '', // optionaler Präfix für alle Dateinamen
  logLevel: 'info', // 'debug' | 'info' | 'warn' | 'error' | 'none'
  openTimeoutMs: 8000, // max. Wartezeit auf die Download-URL je Dokument
  delayBetweenMs: 800, // untere Grenze der zufälligen Pause zwischen Downloads (obere = 3×)
  // ...interne Selektoren
};
```

---

## DevTools-Snippet

Identische Download-Logik ohne Tampermonkey – ideal für einen einmaligen Lauf.

### Voraussetzungen

- Google Chrome (oder ein anderer Chromium-basierter Browser)
- Aktiver flatex-Online-Banking-Zugang unter [konto.flatex.de](https://konto.flatex.de/)

### Verwendung

1. Melde dich unter [konto.flatex.de](https://konto.flatex.de/) an und öffne das **Postfach**.
2. Öffne die Entwicklertools mit `F12` und wechsle zum Tab **Console**.
3. Kopiere den gesamten Inhalt der Datei
   [flatex_download_devtools.js](flatex_download_devtools.js).
4. Füge das Script in die Konsole ein und bestätige mit `Enter`.
5. Beim ersten Mal fragt Chrome „Mehrere Dateien herunterladen?" → **Zulassen**.
6. Die Dokumente werden in den Standard-Download-Ordner gespeichert.

### Konfiguration

Am Anfang des Scripts steht ein `CONFIG`-Block mit denselben Optionen wie oben
(`dryRun`, `maxDocuments`, `filenamePrefix`, `openTimeoutMs`, `delayBetweenMs`).

---

## Umfang & Datumsfilter

Es gibt nur eine Quelle: das **flatex-Postfach / Dokumentenarchiv**. Der Umfang wird
vollständig über die **native Oberfläche** der flatex-Seite gesteuert:

- Tabs **„Alle"** / **„Nur Ungelesene"**
- der eingebaute **Kategorie- und Datumsfilter** des Postfachs

Die Scripts laden immer genau die Dokumente, die nach deiner Filterauswahl im Postfach
sichtbar sind – es ist daher kein eigener Datumsfilter nötig.

## Dateinamen

Die Dateinamen stammen unverändert von flatex und enthalten Datum und Dokumentart,
z. B. `20261005_Kontoauszug_1056965459_642047381.pdf`. Über `filenamePrefix` kann
optional ein Präfix vorangestellt werden.

## Datenschutz & Sicherheit

Die Scripts laufen ausschließlich lokal im Browser des angemeldeten Nutzers und
kommunizieren nur mit **`konto.flatex.de`** – und zwar ausschließlich über dieselben
Endpunkte, die auch das flatex-Webfrontend beim Dokument-Download verwendet. Die
bestehende Browser-Session (Cookies) wird über `credentials: 'include'` mitgesendet;
es werden **keine Zugangsdaten gespeichert oder übertragen**.

Es findet keine Übertragung an Dritte statt, es ist kein Telemetrie-/Analytics-Code
enthalten und es werden keine externen Bibliotheken, Schriftarten oder Icons
nachgeladen.

Da die Scripts auf einer Banking-Seite laufen, gilt: bitte ausschließlich aus diesem
Repository (bzw. über die `@updateURL`) installieren und vor jedem Update den Diff in
den GitHub-Commits prüfen. Sicherheitsmeldungen bitte über die
[Issues](https://github.com/norschel/FlatexDeDownloader/issues) bzw. eine private
GitHub Security Advisory einreichen.

## Entwicklung

Für lokale Linter-/Formatter-Läufe steht eine optionale Node-Konfiguration bereit
(nur für Beitragende, nicht zur Laufzeit erforderlich):

```bash
npm install
npm run lint
npm run format:check
```

Es kommen **ESLint** (`eslint:recommended`) und **Prettier** mit den im Repository
hinterlegten Konfigurationsdateien zum Einsatz. Es gibt keinen Build-Schritt – das
Userscript wird so, wie es im Repository liegt, von Tampermonkey ausgeführt.

## Lizenz

[MIT](LICENSE)
