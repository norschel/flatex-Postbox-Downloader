// ==UserScript==
// @name         flatex Postfach Downloader
// @namespace    https://github.com/norschel/flatex-Postbox-Downloader
// @version      1.1.0
// @description  Lädt alle im flatex "Postfach" gelisteten Dokumente per Klick als PDF herunter.
// @author       norschel
// @homepageURL  https://github.com/norschel/flatex-Postbox-Downloader/
// @supportURL   https://github.com/norschel/flatex-Postbox-Downloader/issues
// @match        https://konto.flatex.de/next-desktop/*
// @run-at       document-end
// @grant        GM_notification
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/norschel/flatex-Postbox-Downloader/main/flatex_postbox_downloader.user.js
// @updateURL    https://raw.githubusercontent.com/norschel/flatex-Postbox-Downloader/main/flatex_postbox_downloader.user.js
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    /** Nur auflisten, nichts speichern (zum Testen). */
    dryRun: false,
    /** Maximale Anzahl Dokumente pro Lauf (0 = alle aktuell sichtbaren). */
    maxDocuments: 0,
    /** Optionaler Präfix, der jedem Dateinamen vorangestellt wird. */
    filenamePrefix: '',
    /** Log-Ausführlichkeit: 'debug' | 'info' | 'warn' | 'error' | 'none'. */
    logLevel: 'info',
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
    rowSelector: '.DocumentArchiveListEntryWidgetEntryRow',
    dialogSelector: '[role="dialog"]',
    buttonId: 'flatex-dl-all-btn',
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Zufällige Pause zwischen delayBetweenMs (untere Grenze) und dem Dreifachen (obere Grenze).
  const randomDelayMs = () =>
    CONFIG.delayBetweenMs + Math.floor(Math.random() * (CONFIG.delayBetweenMs * 2 + 1));

  // Das Userscript läuft in einer isolierten Sandbox; webcore-Globals wie
  // DocumentViewer liegen auf dem echten Seitenfenster (unsafeWindow).
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, none: 99 };
  const log = (level, ...a) => {
    if (LEVELS[level] < LEVELS[CONFIG.logLevel]) return;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn('[flatex-dl]', ...a);
  };

  // Erkennt die HTML-Challenge des Bot-Schutzes (Myra/myracloud), die flatex nach
  // vielen schnellen Downloads statt des PDFs ausliefert (oft mit HTTP 503).
  const looksLikeChallenge = (text) =>
    /myracloud|checking your browser|findNonce|Sicherheit/i.test(text);

  // Lädt die URL und gibt einen validierten PDF-Blob zurück. Wirft bei HTTP-Fehler,
  // Bot-Schutz-Challenge oder wenn die Antwort kein PDF ist (damit keine kaputten
  // Challenge-Seiten als .pdf gespeichert werden).
  async function fetchPdfBlob(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) {
      throw new Error('HTTP ' + resp.status + (resp.status === 503 ? ' (Bot-Schutz?)' : ''));
    }
    const blob = await resp.blob();
    const head = await blob.slice(0, 1024).text();
    if (!head.startsWith('%PDF')) {
      throw new Error(looksLikeChallenge(head) ? 'Bot-Schutz-Challenge (WAF)' : 'Kein PDF');
    }
    return blob;
  }

  // Führt eine Download-Funktion aus und wiederholt sie bei Fehlern (z. B. HTTP 503)
  // mit exponentiell steigenden Wartezeiten (5s, 15s, 30s, 60s).
  async function withRetry(label, fn) {
    const maxAttempts = CONFIG.retryDelaysMs.length + 1;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await fn();
        if (attempt > 1) log('info', `${label} im Versuch ${attempt} erfolgreich.`);
        return result;
      } catch (e) {
        lastErr = e;
        if (attempt < maxAttempts) {
          const wait = CONFIG.retryDelaysMs[attempt - 1];
          log(
            'warn',
            `${label} Versuch ${attempt}/${maxAttempts} fehlgeschlagen (${e.message}). Neuer Versuch in ${wait / 1000}s…`
          );
          await sleep(wait);
        }
      }
    }
    throw lastErr;
  }

  function saveViaAnchor(blob, filename) {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
  }

  async function downloadAll(btn) {
    const entries = () => Array.from(document.querySelectorAll(CONFIG.entrySelector));
    if (entries().length === 0) {
      alert('Keine Dokumente gefunden. Bitte zuerst das Postfach öffnen.');
      return;
    }

    const setLabel = (t) => (btn.textContent = t);
    btn.disabled = true;
    log('info', `Starte…${CONFIG.dryRun ? ' (Trockenlauf)' : ''}`);

    // webcore liefert die echte PDF-URL über DocumentViewer.display(url, mimeType).
    // Dieser Hook ist der zuverlässige Angriffspunkt für ALLE Dokumenttypen;
    // die Popup-Helfer werden neutralisiert, damit kein wait.html-Popup aufgeht.
    const DV = pageWindow.DocumentViewer;
    if (!DV || typeof DV.display !== 'function') {
      alert('DocumentViewer nicht gefunden. Bitte das Postfach auf konto.flatex.de öffnen.');
      btn.disabled = false;
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
    // Nach unten scrollen und ein echtes Scroll-Delta erzeugen (kurz hoch, dann runter),
    // damit der Lazy-Loader auslöst. Gibt true zurück, wenn neue Einträge kamen.
    const loadMore = async () => {
      if (!scroller) return false;
      const before = entries().length;
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 500);
      await sleep(110);
      scroller.scrollTop = scroller.scrollHeight;
      await sleep(300);
      return entries().length > before;
    };

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
    let ok = 0;
    const failed = [];
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
          setLabel(`⏸ Pause…`);
          log(
            'info',
            `Pause ${CONFIG.batchCooldownMs / 1000}s nach ${n - 1} Dokumenten (Bot-Schutz vermeiden)…`
          );
          await sleep(CONFIG.batchCooldownMs);
        }
        setLabel(`⬇ ${n}…`);
        const title = (next.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        capturedUrl = null;
        next.click();

        let waited = 0;
        while (capturedUrl === null && waited < CONFIG.openTimeoutMs) {
          await sleep(150);
          waited += 150;
        }
        if (!capturedUrl) {
          log('warn', `(#${n}) keine URL für "${title}" – übersprungen`);
          failed.push(title);
          continue;
        }

        const url = new URL(capturedUrl, location.origin).href;
        const baseName =
          decodeURIComponent(url.split('?')[0].split('/').pop() || '') || `dokument_${n}.pdf`;
        const filename = CONFIG.filenamePrefix + baseName;

        if (CONFIG.dryRun) {
          ok++;
          log('info', `(#${n}) [dry] ${filename}`);
          await sleep(randomDelayMs());
          continue;
        }

        try {
          // Immer per fetch laden und validieren, damit Bot-Schutz-Challenges erkannt
          // werden; GM_download könnte eine Challenge-Seite unbemerkt als .pdf speichern.
          const blob = await withRetry(`(#${n}) "${title}"`, () => fetchPdfBlob(url));
          saveViaAnchor(blob, filename);
          ok++;
          log('info', `(#${n}) ✓ ${filename}`);
        } catch (e) {
          log('error', `(#${n}) Fehler bei "${title}":`, e);
          failed.push(title);
        }

        await sleep(randomDelayMs());
      }
    } finally {
      DV.display = origDisplay;
      DV.openPopupIfRequired = origOpenIfRequired;
      DV.closePreparedPopup = origClosePrepared;
      btn.disabled = false;
      setLabel('⬇ Alle herunterladen');
    }

    const summary = `flatex Download abgeschlossen.\nErfolgreich: ${ok}\nFehlgeschlagen: ${failed.length}`;
    log('info', `Fertig. OK: ${ok}, Fehlgeschlagen: ${failed.length}`);
    if (typeof GM_notification === 'function') {
      GM_notification({ title: 'flatex Postfach Downloader', text: summary, silent: true });
    }
    alert(summary + (failed.length ? `\n\n- ${failed.join('\n- ')}` : ''));
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.id = CONFIG.buttonId;
    btn.type = 'button';
    btn.textContent = '⬇ Alle herunterladen';
    Object.assign(btn.style, {
      position: 'fixed',
      top: '12px',
      right: '60px',
      zIndex: 2147483647,
      padding: '8px 14px',
      background: '#0a7d32',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      font: '600 13px system-ui, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,.35)',
    });
    btn.addEventListener('click', () => downloadAll(btn));
    return btn;
  }

  // Button nur anzeigen, wenn der Postfach-Dialog mit Dokumenten offen ist.
  function sync() {
    const dialogOpen =
      document.querySelector(CONFIG.rowSelector) &&
      (document.querySelector(CONFIG.dialogSelector) || true);
    const existing = document.getElementById(CONFIG.buttonId);
    if (dialogOpen && !existing) {
      document.body.appendChild(createButton());
    } else if (!dialogOpen && existing) {
      existing.remove();
    }
  }

  const mo = new MutationObserver(() => sync());
  mo.observe(document.body, { childList: true, subtree: true });
  sync();
})();
