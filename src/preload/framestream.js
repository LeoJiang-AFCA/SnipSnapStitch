'use strict';
// Runs in a hidden window: streams a screen, crops the requested rectangle and sends changed frames to the main process.
const { ipcRenderer } = require('electron');

let inFlight = 0;
ipcRenderer.on('framestream:ack', () => { inFlight = Math.max(0, inFlight - 1); });

ipcRenderer.on('framestream:start', async (_e, { sourceId, rect, size }) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 16384, // without limits Chromium scales the stream down
          maxHeight: 16384,
          maxFrameRate: 30,
        },
      },
    });
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => (video.videoWidth ? resolve() : video.addEventListener('loadedmetadata', resolve, { once: true })));

    // Within a couple of pixels of the expected size the stream is native (the display size is only rounded).
    const native = Math.abs(video.videoWidth - size.w) <= 3 && Math.abs(video.videoHeight - size.h) <= 3;
    const sx = native ? 1 : video.videoWidth / size.w;
    const sy = native ? 1 : video.videoHeight / size.h;
    const cx = Math.round(rect.x * sx);
    const cy = Math.round(rect.y * sy);
    const w = Math.max(1, Math.min(Math.round(rect.w * sx), video.videoWidth - cx));
    const h = Math.max(1, Math.min(Math.round(rect.h * sy), video.videoHeight - cy));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let last = null;

    const tick = () => {
      try {
        if (inFlight < 2) {
          ctx.drawImage(video, cx, cy, w, h, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const px = new Uint32Array(img.data.buffer);
          let changed = !last;
          if (last) {
            for (let i = 0; i < px.length; i++) {
              if (px[i] !== last[i]) { changed = true; break; }
            }
          }
          if (changed) {
            last = px.slice();
            // RGBA -> BGRA, matching nativeImage bitmaps.
            for (let i = 0; i < px.length; i++) {
              const v = px[i];
              px[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
            }
            inFlight++;
            ipcRenderer.send('framestream:frame', { data: new Uint8Array(img.data.buffer), width: w, height: h });
          }
        }
      } catch (err) {
        ipcRenderer.send('framestream:error', err && err.message);
        return;
      }
      setTimeout(tick, 8);
    };
    tick();
  } catch (err) {
    ipcRenderer.send('framestream:error', err && err.message);
  }
});
