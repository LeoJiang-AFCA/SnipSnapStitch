# Scroll capture – design, findings, limits

Code: `src\main\capture.js` (session loop, `captureScrolling`), `capture-util.js` (pure algorithms, unit-tested in
`test\capture-util.test.js`), `frame-stream.js`, `scroll-ui.js`, `winbounds.js`.

## Flow
1. User picks a rect (overlay), a small control bar appears (manual scroll or **Auto-scroll**, **Done**). Esc cancels; Enter (global shortcut registered only during scroll capture) = Done.
2. Frames come from a ~30 fps `getUserMedia` desktop stream cropped to the rect (`FrameStream`; only changed frames are sent). Fallback = polling `desktopCapturer` thumbnails (slow, ~400 ms/grab).
3. Each new frame is compared with the last kept one (`appendFrame`):
   - `sameIgnoringBoxes` → "identical" (also when only the mouse pointer differs).
   - `staticRows` finds identical top (sticky header) and bottom (footer/status bar) rows; matching uses only the zone between.
   - `detectScrollOffset` scores each shift dy on sampled rows/columns, re-scores the best ~12 candidates with many more columns, prefers the candidate closest to the last step among near-ties, verifies with `matchFraction ≥ 0.8`. Small steps searched first, full range only if that fails.
   - A frame is committed only when the content moved ≥ `max(6, 8% zone, 1.1×cursor box)` px (the final pass after Done forces commit).
   - `overlayRows` detects a scrollbar/slider floating over the bottom of the text and treats it like a footer.
4. `ScrollStitcher` (in `capture-util.js`) assembles: first frame whole, then for each frame rows `[covered−dy, h − median(footers) − SEAM_MARGIN)`; `finish()` appends the last frame's footer once. `gapRows` counts rows scrolled past between two frames without ever being seen.
5. Fixed columns: `_trackColumns` (columns that never change) and `_trackAligned` (columns that change but don't follow the scroll, e.g. minimap) → `fixedColumns()` returns `{left,right}`; those bands are shown once at the top with per-column fill colour below.
6. Cursor: each frame carries `box` (pointer rect). Strips get patch records copying clean rows from the neighbouring frame, applied in `finish()` outside fixed bands. In auto mode the pointer is parked outside the area after each wheel event.
7. After `finalize`, a warning dialog ("Scrolling capture incomplete") appears if `lost` (content moved past the last captured part before Done), `gapRows > 0`, or max height (20000 physical px) was reached.

## Findings worth remembering
- Video stream is lossy (I420 chroma subsampling): the footer boundary row blends with content → `SEAM_MARGIN = 3`. Constrain stream `min/max` width/height exactly or Chromium rescales (2254 vs 2256 px).
- Static-row detection from the top overshoots on uniform rows; harmless since it only bounds the matching zone.
- Detection noise floor ~1 on the stream vs 0 with thumbnails; `rowTol 6`, `minMatch 0.8` are fine.
- Blank scroll columns look "unmoved" until text appears, so cursor patches are stored at push time and filtered by fixed bands only at `finish()`.
- Overlay (scrollbar) detection was only validated on synthetic data, not a real VS Code capture.
- Snagit has no documented fixed-column behaviour (only TechSmith's advice to exclude them); web-search summaries on this were AI-generated and non-authoritative.
- 4K frames are ~29 MB each over IPC (in-flight cap 2) → can lengthen gaps; a very fast wheel/scrollbar drag/"go to line" jump (> ~90% of zone) cannot be matched.

## Known limits
- Scrolls down only. One display per selection. Max height 20000 physical px.
- Static side column inside the selection works via fixed-column detection but can still look imperfect; best practice: select only the scrolling pane.
- Blinking caret/spinner in header/footer handled by median, may leave thin artifacts.
- Horizontal "shadow bar" (drag left/right shadows) was polished earlier; remaining artifacts are cosmetic.

## Latest open bug (false "incomplete" warning)
Reported twice: manual slow scroll, clicked Done, image is good, but the popup says
"The content scrolled past the last captured part before you clicked Done, so the end of the page is missing" (the `lost` branch).
Fixes tried, **not yet confirmed by the reporter**:
1. When the live frame equals `prev` (user scrolled back to the last captured spot) `lost` is cleared.
2. After Done, the final settle frame is retried up to 3× (`append(await stable(), true)`).
3. `sameIgnoringBoxes` is used both in `appendFrame` and in the manual poll loop, so a frame that differs only by the mouse pointer (pointer moves to the Done button!) counts as identical/ok instead of "not joined".
Hypothesis behind #3: after clicking Done the pointer moves, the final frame differs from `prev` only in the pointer box, `detectScrollOffset` fails (no scroll) → `r.ok=false`, `noZone` false → `lost=true`. If the warning still appears, add logging of the last `append` result (r.ok/identical/noZone/dy/match) at finish, and consider setting `lost=false` whenever the final frame's `match` is high at dy=0 or when the final frame has no new content. Ask which reason line the popup shows.
