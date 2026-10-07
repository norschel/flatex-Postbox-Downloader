/*
 * flatex Postfach – DevTools Download-Skript
 * ------------------------------------------
 * Lädt alle aktuell im "Postfach"-Dialog gelisteten Dokumente als PDF herunter.
 *
 * Verwendung:
 *   1. In https://konto.flatex.de/next-desktop/ einloggen.
 *   2. Das "Postfach" öffnen (ggf. Tab "Alle" oder "Nur Ungelesene" / Filter wählen).
 *   3. DevTools öffnen (F12) -> Konsole -> dieses Skript einfügen -> Enter.
 *   4. Beim ersten Mal fragt Chrome "Mehrere Dateien herunterladen?" -> Zulassen.
 *
 * Hinweis: Das Anklicken markiert die Dokumente als gelesen.
 */
(async () => {
  const CONFIG = {
    /** Nur auflisten, nichts speichern (zum Testen). */
    dryRun: false,
    /** Maximale Anzahl Dokumente pro Lauf (0 = alle aktuell sichtbaren). */
    maxDocuments: 0,
    /** Optionaler Präfix, der jedem Dateinamen vorangestellt wird. */
    filenamePrefix: '',
    /** Max. Wartezeit auf die Download-URL pro Dokument (ms). */
    openTimeoutMs: 8000,
    /** Untere Grenze der zufälligen Pause zwischen Downloads (ms); die obere Grenze ist das Dreifache. Schont Server und Browser. */
    delayBetweenMs: 800,
    /** Wartezeiten (ms) vor erneutem Versuch bei fehlgeschlagenem Download (exponentiell steigend). */
    retryDelaysMs: [5000, 15000, 30000, 60000],
    /** Nach so vielen Dokumenten eine längere Pause einlegen (0 = aus). Beugt dem Bot-Schutz vor. */
    batchSize: 50,
    /** Dauer der Batch-Pause (ms). */
    batchCooldownMs: 60000,
    // --- interne Selektoren (normalerweise nicht ändern) ---
    /** Dokument-Eintrag (hat eine stabile Widget-ID, anklickbar). */
    entrySelector: '.DocumentArchiveListEntryWidget.EntryWidget',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Zufällige Pause zwischen delayBetweenMs (untere Grenze) und dem Dreifachen (obere Grenze).
  const randomDelayMs = () =>
    CONFIG.delayBetweenMs + Math.floor(Math.random() * (CONFIG.delayBetweenMs * 2 + 1));

  // Erkennt die HTML-Challenge des Bot-Schutzes (Myra/myracloud), die flatex nach
  // vielen schnellen Downloads statt des PDFs ausliefert (oft mit HTTP 503).
  const looksLikeChallenge = (text) =>
    /myracloud|checking your browser|findNonce|Sicherheit/i.test(text);

  // Lädt die URL und gibt einen validierten PDF-Blob zurück. Bei Fehler (HTTP 503,
  // Bot-Schutz-Challenge oder kein PDF) wird mit exponentiell steigenden Wartezeiten
  // (5s, 15s, 30s, 60s) erneut versucht.
  const fetchBlobWithRetry = async (url, label) => {
    const maxAttempts = CONFIG.retryDelaysMs.length + 1;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          throw new Error('HTTP ' + resp.status + (resp.status === 503 ? ' (Bot-Schutz?)' : ''));
        }
        const blob = await resp.blob();
        const head = await blob.slice(0, 1024).text();
        // Statt des PDFs kam eine HTML-Challenge-Seite des Bot-Schutzes zurück.
        if (!head.startsWith('%PDF')) {
          throw new Error(looksLikeChallenge(head) ? 'Bot-Schutz-Challenge (WAF)' : 'Kein PDF');
        }
        if (attempt > 1) console.log(`[flatex] ${label} im Versuch ${attempt} erfolgreich.`);
        return blob;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) {
          const wait = CONFIG.retryDelaysMs[attempt - 1];
          console.warn(
            `[flatex] ${label} Versuch ${attempt}/${maxAttempts} fehlgeschlagen (${e.message}). Neuer Versuch in ${wait / 1000}s…`
          );
          await sleep(wait);
        }
      }
    }
    throw lastErr;
  };

  // webcore liefert die echte PDF-URL über DocumentViewer.display(url, mimeType).
  // Dieser Hook ist der zuverlässige Angriffspunkt für ALLE Dokumenttypen
  // (einfache Kontoauszüge wie auch generierte Dokumente). Das Abfangen von
  // window.open ist unzuverlässig, weil webcore Popups wiederverwendet.
  const DV = window.DocumentViewer;
  if (!DV || typeof DV.display !== 'function') {
    console.error(
      '[flatex] DocumentViewer nicht gefunden. Ist das Postfach auf konto.flatex.de geöffnet?'
    );
    return;
  }

  const entries = () => Array.from(document.querySelectorAll(CONFIG.entrySelector));
  if (entries().length === 0) {
    console.error('[flatex] Keine Dokumente gefunden. Ist das Postfach geöffnet?');
    return;
  }

  // Die Dokumentliste lädt per Lazy-Scroll nach (anfangs ~50 Einträge). Wir finden
  // den scrollbaren Container, um bei Bedarf weitere Einträge nachzuladen.
  const findScroller = () => {
    let el = document.querySelector(CONFIG.entrySelector);
    while (el) {
      if (
        el.scrollHeight > el.clientHeight + 5 &&
        /scroll|auto/.test(getComputedStyle(el).overflowY)
      )
        return el;
      el = el.parentElement;
    }
    return null;
  };
  const scroller = findScroller();
  // Nach ganz unten scrollen und ein echtes Scroll-Delta erzeugen (kurz hoch, dann
  // runter), damit der Lazy-Loader auslöst. Gibt true zurück, wenn neue Einträge kamen.
  const loadMore = async () => {
    if (!scroller) return false;
    const before = entries().length;
    scroller.scrollTop = Math.max(0, scroller.scrollTop - 500);
    await sleep(110);
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(300);
    return entries().length > before;
  };

  console.log(`[flatex] Starte…${CONFIG.dryRun ? ' (Trockenlauf)' : ''}`);

  // DocumentViewer hooken: display() liefert die echte URL, die Popup-Helfer
  // werden neutralisiert, damit kein wait.html-Popup aufgeht.
  let capturedUrl = null;
  const origDisplay = DV.display;
  const origOpenIfRequired = DV.openPopupIfRequired;
  const origClosePrepared = DV.closePreparedPopup;
  DV.display = function (url, mime) {
    if (url) capturedUrl = String(url);
    return mime;
  };
  DV.openPopupIfRequired = function () {};
  DV.closePreparedPopup = function () {};

  // Verarbeitung per stabiler Widget-ID: Ein Klick re-rendert die Liste (und kann sie
  // zusammenklappen), aber die ID jedes Dokuments bleibt stabil. Wir merken uns erledigte
  // IDs, suchen in jeder Runde frisch das nächste offene Dokument und laden bei Bedarf nach.
  const processed = new Set();
  const results = { ok: 0, failed: [] };
  let noProgress = 0;
  try {
    for (;;) {
      if (CONFIG.maxDocuments > 0 && processed.size >= CONFIG.maxDocuments) break;

      const next = entries().find((w) => w.id && !processed.has(w.id));
      if (!next) {
        const grew = await loadMore();
        if (!grew && ++noProgress >= 6) break;
        if (grew) noProgress = 0;
        continue;
      }
      noProgress = 0;

      const id = next.id;
      processed.add(id);
      const n = processed.size;
      // Proaktive Pause nach jedem Batch, um den Bot-Schutz gar nicht erst auszulösen.
      if (CONFIG.batchSize > 0 && n > 1 && (n - 1) % CONFIG.batchSize === 0) {
        console.log(
          `[flatex] Pause ${CONFIG.batchCooldownMs / 1000}s nach ${n - 1} Dokumenten (Bot-Schutz vermeiden)…`
        );
        await sleep(CONFIG.batchCooldownMs);
      }
      const title = (next.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      capturedUrl = null;
      next.click();

      let waited = 0;
      while (capturedUrl === null && waited < CONFIG.openTimeoutMs) {
        await sleep(150);
        waited += 150;
      }

      if (!capturedUrl) {
        console.warn(`[flatex] (#${n}) keine URL für "${title}" – übersprungen`);
        results.failed.push(title);
        continue;
      }

      const url = capturedUrl;
      const baseName =
        decodeURIComponent(url.split('?')[0].split('/').pop() || '') || `dokument_${n}.pdf`;
      const filename = CONFIG.filenamePrefix + baseName;

      if (CONFIG.dryRun) {
        results.ok++;
        console.log(`[flatex] (#${n}) [dry] ${filename}`);
        await sleep(randomDelayMs());
        continue;
      }

      try {
        const blob = await fetchBlobWithRetry(url, `(#${n}) "${title}"`);
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
        results.ok++;
        console.log(`[flatex] (#${n}) ✓ ${filename}`);
      } catch (e) {
        console.error(`[flatex] (#${n}) Download fehlgeschlagen: ${title}`, e);
        results.failed.push(title);
      }

      await sleep(randomDelayMs());
    }
  } finally {
    DV.display = origDisplay;
    DV.openPopupIfRequired = origOpenIfRequired;
    DV.closePreparedPopup = origClosePrepared;
  }

  console.log(
    `[flatex] Fertig. Erfolgreich: ${results.ok}, Fehlgeschlagen: ${results.failed.length}` +
      (results.failed.length ? `\nFehlgeschlagen:\n- ${results.failed.join('\n- ')}` : '')
  );
})();
