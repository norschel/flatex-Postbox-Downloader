# Copilot instructions — FlatexDeDownloader

Two standalone scripts that bulk-download every PDF in the flatex **Postfach**
(document archive). No build step, no dependencies, no framework — plain browser
JavaScript. Keep both scripts in sync: they share the same core download loop.

- `flatex_download_devtools.js` — IIFE to paste into the DevTools console.
- `flatex_postbox_downloader.user.js` — Tampermonkey/Greasemonkey userscript that
  adds a "⬇ Alle herunterladen" button.

Target site: `https://konto.flatex.de/next-desktop/` — a legacy **webcore**
framework (jQuery + `ajaxCommandServlet`).

## How the download mechanism works (verified — do not "simplify" this away)

- Each document is a wrapper `.DocumentArchiveListEntryWidget.EntryWidget` with a
  **stable unique `id`** (e.g. `_2147382821`), `role=button`. Rows have no
  `href`/`onclick`; the click is handled by a webcore delegated listener, but a
  programmatic `element.click()` triggers it.
- Clicking routes through `window.DocumentViewer`. The single reliable chokepoint
  for the real PDF URL is **`DocumentViewer.display(url, mime)`**. Hook all three
  methods, capture the URL, then restore originals in a `finally`:
  - `display` → capture `url`.
  - `openPopupIfRequired` → no-op (prevents a `wait.html` popup).
  - `closePreparedPopup` → no-op.
  - Do **not** try to intercept `window.open` — webcore reuses popups and uses two
    delivery paths, so it only captures the first doc. Hooking `display` is reliable.
- Real URL form: `/next-desktop/downloadData/{timestamp}/{YYYYMMDD}_{Type}_{id1}_{id2}.pdf`.
  Fetch with `credentials: 'include'`; the last path segment is already a clean filename.

## List traversal (lazy-load + re-render — the tricky part)

- The list **lazy-loads on scroll** (starts ~50 entries, grows in batches). Find the
  scroll container by walking up from a row to the first ancestor with
  `scrollHeight > clientHeight` and `overflow-y: scroll/auto`.
- To trigger a new lazy-load you need a real scroll **delta**: `scrollTop -= 500;
  await; scrollTop = scrollHeight; await;`. Setting `scrollTop = scrollHeight` while
  already at the bottom does nothing.
- Clicking a document **re-renders the list** (old node replaced; may collapse back to
  ~50) but the stable `id` survives (`getElementById` still works). It also marks the
  document as read.
- **Algorithm:** dedupe by `id` in a `Set`. Re-query entries **every iteration**
  (never hold a stale snapshot array). Add the `id` to the set *before* clicking to
  avoid retry loops. When no unprocessed entry remains, `loadMore()`; stop after it
  fails to grow N times in a row. Do NOT snapshot rows once and index a `for` loop —
  that was the original "only first 50" bug.

## Bot protection / WAF — the download rate limit (important)

- After ~180 rapid `downloadData` fetches, flatex's **Myra (myracloud)** WAF blocks
  and serves an HTML challenge page **instead of the PDF** — often HTTP 503, but
  sometimes HTTP 200. Markers: `/x-myracloud/proof2.js`, "checking your browser",
  `findNonce(...)`, redirect to `/x-myracloud-proof-result/`.
- A plain `fetch()` **cannot** solve the JS proof-of-work, so retrying the identical
  request does not auto-recover. Only a reduced request rate lets the rate-based block
  clear. (A real top-level browser navigation solves it and sets a clearance cookie.)
- Mitigations already in both scripts — preserve them:
  1. **Retry with exponential backoff**: `retryDelaysMs: [5000, 15000, 30000, 60000]`.
  2. **Validate every response is a real PDF** via the `%PDF` magic bytes
     (`blob.slice(0, 1024).text()`), so challenge pages are never saved as corrupt
     `.pdf`. `looksLikeChallenge()` regex: `myracloud|checking your browser|findNonce|Sicherheit`.
  3. **Proactive batch cooldown**: every `batchSize` docs (default **50**, kept well
     below the ~180 trip point) pause for `batchCooldownMs` to avoid tripping the WAF
     in the first place.
  4. **Randomized inter-download delay**: between each download sleep a random amount
     via `randomDelayMs()` — lower bound `delayBetweenMs`, upper bound `3 × delayBetweenMs`.
     The jitter avoids a constant, bot-like request cadence that Myra can fingerprint.
- The userscript does **not** use `GM_download` for PDFs: it can't inspect the response
  and would silently save challenge pages. Always `fetch` + validate + anchor-save.

## Conventions

- No dependencies, no bundler. Edit the two `.js` files directly.
- User-facing strings and comments are **German**. Console logs are prefixed
  `[flatex]` (devtools) / `[flatex-dl]` (userscript).
- All tunables live in the top `CONFIG` object (`dryRun`, `maxDocuments`,
  `filenamePrefix`, `openTimeoutMs`, `delayBetweenMs`, `retryDelaysMs`, `batchSize`,
  `batchCooldownMs`). `delayBetweenMs` is the **lower bound** of the randomized pause
  between downloads (upper bound = `3 ×`). Prefer adding knobs there over hardcoding.
- When you change the download loop, retry, validation, or WAF handling, apply the
  **same change to both files**.
- **Bump the version after every change** (SemVer). Keep the userscript `@version`
  header in `flatex_postbox_downloader.user.js` and `version` in `package.json` in
  sync. Pick the bump by scope: **patch** for bug fixes / tweaks, **minor** for new
  backwards-compatible features/knobs, **major** for breaking changes.
