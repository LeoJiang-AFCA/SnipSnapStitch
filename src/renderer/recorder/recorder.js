/* Capture worker (hidden window, ?view=worker): getDisplayMedia -> MediaRecorder (webm),
 * region cropping via canvas, and webm -> GIF conversion. */
(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('view') !== 'worker') return;
  const api = window.recorderApi;

  let rec = null;

  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);

  function pickMime(pixelRate) {
    // VP9 compresses best but software realtime VP9 struggles above 1080p30.
    const vp9 = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9'];
    const vp8 = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8'];
    const list = (pixelRate > 1920 * 1080 * 30 * 1.05 ? vp8.concat(vp9) : vp9.concat(vp8)).concat(['video/webm']);
    return list.find((m) => MediaRecorder.isTypeSupported(m)) || '';
  }

  async function canvasToJpeg(source, sw, sh, maxW) {
    const tw = Math.max(1, Math.min(maxW || 320, sw));
    const th = Math.max(1, Math.round((sh * tw) / sw));
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    c.getContext('2d').drawImage(source, 0, 0, tw, th);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  async function waitForVideo(video) {
    const t0 = performance.now();
    while (!(video.videoWidth > 0 && video.readyState >= 2)) {
      if (performance.now() - t0 > 5000) throw new Error('Timed out waiting for the first video frame');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  function stopTracks(stream) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  function cleanup(r) {
    r.timers.forEach((t) => clearInterval(t));
    r.timers.length = 0;
    stopTracks(r.display);
    stopTracks(r.micStream);
    if (r.audioCtx) r.audioCtx.close().catch(() => {});
    if (r.video) { r.video.pause(); r.video.srcObject = null; }
  }

  async function start(cfg) {
    if (rec) throw new Error('Already recording');
    const r = (rec = {
      cfg, chunks: [], timers: [], startedAt: 0, pausedAt: 0, pausedTotal: 0,
      thumb: null, width: 0, height: 0, canvas: null, video: null,
    });
    try {
      r.display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: cfg.fps, max: cfg.fps } },
        audio: !!cfg.audio,
      });
      const vTrack = r.display.getVideoTracks()[0];
      const video = (r.video = document.createElement('video'));
      video.muted = true;
      video.srcObject = new MediaStream([vTrack]);
      await video.play();
      await waitForVideo(video);

      let outTrack = vTrack;
      r.width = video.videoWidth;
      r.height = video.videoHeight;
      {
        // Everything goes through a canvas: it re-emits frames steadily even when the
        // screen is static (MediaRecorder stalls otherwise), crops regions, and keeps the
        // output size fixed if a captured window is resized.
        const full = !(cfg.mode === 'region' && cfg.region && cfg.displayBounds);
        const reg = full ? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight } : cfg.region;
        const sx = full ? 1 : video.videoWidth / cfg.displayBounds.width;
        const sy = full ? 1 : video.videoHeight / cfg.displayBounds.height;
        const x = Math.max(0, Math.min(video.videoWidth - 2, Math.round(reg.x * sx)));
        const y = Math.max(0, Math.min(video.videoHeight - 2, Math.round(reg.y * sy)));
        const w = even(Math.min(Math.round(reg.w * sx), video.videoWidth - x));
        const h = even(Math.min(Math.round(reg.h * sy), video.videoHeight - y));
        const canvas = (r.canvas = document.createElement('canvas'));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: !!cfg.cpuCanvas });
        let draw;
        if (cfg.mode === 'window') {
          ctx.fillStyle = '#000';
          draw = () => {
            const vw = video.videoWidth, vh = video.videoHeight;
            if (!vw || !vh) return;
            if (vw === w && vh === h) { ctx.drawImage(video, 0, 0); return; }
            const k = Math.min(w / vw, h / vh);
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(video, (w - vw * k) / 2, (h - vh * k) / 2, vw * k, vh * k);
          };
        } else {
          draw = () => ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
        }
        draw();
        // Timers are used instead of rAF because this window is never visible.
        r.draw = draw;
        r.drawMs = Math.round(1000 / cfg.fps);
        r.drawTimer = setInterval(draw, r.drawMs);
        r.timers.push(r.drawTimer);
        outTrack = canvas.captureStream(cfg.fps).getVideoTracks()[0];
        r.width = w;
        r.height = h;
      }

      let micTrack = null;
      if (cfg.mic) {
        try {
          r.micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          micTrack = r.micStream.getAudioTracks()[0] || null;
        } catch (e) {
          r.micError = e && e.message;
        }
      }
      const sysTrack = r.display.getAudioTracks()[0] || null;
      let audioTrack = sysTrack || micTrack;
      if (sysTrack && micTrack) {
        const ctx = (r.audioCtx = new AudioContext());
        await ctx.resume().catch(() => {});
        const dest = ctx.createMediaStreamDestination();
        ctx.createMediaStreamSource(new MediaStream([sysTrack])).connect(dest);
        ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dest);
        audioTrack = dest.stream.getAudioTracks()[0];
      }

      const stream = new MediaStream([outTrack].concat(audioTrack ? [audioTrack] : []));
      const bps = Math.max(1.2e6, Math.min(10e6, r.width * r.height * cfg.fps * 0.06));
      const opts = { videoBitsPerSecond: bps, audioBitsPerSecond: 128000 };
      const mime = pickMime(r.width * r.height * cfg.fps);
      if (mime) opts.mimeType = mime;
      const mr = (r.mr = new MediaRecorder(stream, opts));
      mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
      mr.onerror = (e) => api.invoke('recorder:failed', { error: String((e.error && e.error.message) || 'MediaRecorder error') });
      mr.start(1000);
      r.startedAt = performance.now();
      vTrack.onended = () => api.invoke('recorder:ended');
      setTimeout(() => { if (rec === r && !r.thumb) grabThumb(r); }, 500);

      return {
        width: r.width, height: r.height, mimeType: mr.mimeType,
        mic: !!micTrack, micError: r.micError || null, systemAudio: !!sysTrack,
      };
    } catch (e) {
      rec = null;
      cleanup(r);
      throw new Error((e && e.message) || String(e));
    }
  }

  async function grabThumb(r) {
    try {
      r.thumb = await canvasToJpeg(r.canvas || r.video, r.width, r.height, 320);
    } catch (e) { /* thumbnail is optional */ }
  }

  function pause() {
    if (!rec || rec.pausedAt || rec.mr.state !== 'recording') return false;
    rec.mr.pause();
    rec.pausedAt = performance.now();
    if (rec.draw) { clearInterval(rec.drawTimer); rec.drawTimer = 0; } // nothing is recorded while paused
    return true;
  }

  function resume() {
    if (!rec || !rec.pausedAt) return false;
    if (rec.draw && !rec.drawTimer) {
      rec.draw();
      rec.drawTimer = setInterval(rec.draw, rec.drawMs);
      rec.timers.push(rec.drawTimer);
    }
    rec.mr.resume();
    rec.pausedTotal += performance.now() - rec.pausedAt;
    rec.pausedAt = 0;
    return true;
  }

  async function stop(save) {
    const r = rec;
    if (!r) return { discarded: true };
    rec = null;
    const end = r.pausedAt || performance.now();
    const durationMs = Math.max(0, end - r.startedAt - r.pausedTotal);
    if (save && !r.thumb) await grabThumb(r);
    const stopped = new Promise((res) => { r.mr.onstop = res; });
    if (r.mr.state !== 'inactive') r.mr.stop();
    await stopped;
    cleanup(r);
    if (!save || !r.chunks.length) return { discarded: true };
    const blob = new Blob(r.chunks, { type: 'video/webm' });
    r.chunks.length = 0;
    const bytes = window.WebmDuration.fixDuration(new Uint8Array(await blob.arrayBuffer()), durationMs);
    return api.invoke('recorder:finished', {
      buffer: bytes, width: r.width, height: r.height, durationMs, thumb: r.thumb,
    });
  }

  /* ---------- webm -> GIF ---------- */

  function onceEvent(el, name, ms) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => { el.removeEventListener(name, h); rej(new Error('Timed out waiting for ' + name)); }, ms || 15000);
      const h = () => { clearTimeout(to); el.removeEventListener(name, h); res(); };
      el.addEventListener(name, h);
    });
  }

  function seek(v, t) {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return Promise.resolve();
    const p = onceEvent(v, 'seeked', 5000).catch(() => {});
    v.currentTime = t;
    return p;
  }

  async function webmToGif(bytes, o) {
    o = o || {};
    const maxFps = Math.max(1, Math.min(25, o.maxFps || 12));
    const maxWidth = o.maxWidth || 800;
    const maxFrames = o.maxFrames || 1500;
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    try {
      v.src = url;
      await onceEvent(v, 'loadeddata', 20000);
      let dur = v.duration;
      if (!isFinite(dur)) {
        // MediaRecorder files without a Duration: force the browser to scan to the end.
        const p = onceEvent(v, 'durationchange', 8000).catch(() => {});
        v.currentTime = 1e101;
        await p;
        dur = v.duration;
        if (!isFinite(dur)) throw new Error('Cannot determine video duration');
        await seek(v, 0);
      }
      if (!(dur > 0)) throw new Error('Empty video');
      const vw = v.videoWidth, vh = v.videoHeight;
      if (!vw || !vh) throw new Error('Video has no picture');
      const w = Math.max(2, Math.min(maxWidth, vw));
      const h = Math.max(2, Math.round((vh * w) / vw));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const cs = Math.max(2, Math.round(100 / maxFps), Math.ceil((dur * 100) / maxFrames));
      const step = cs / 100;
      const total = Math.max(1, Math.ceil(dur / step));
      const enc = new window.GifEncoder(w, h, { loop: 0 });
      let thumb = null;
      for (let i = 0; i < total; i++) {
        await seek(v, Math.min(i * step, Math.max(0, dur - 0.02)));
        ctx.drawImage(v, 0, 0, w, h);
        if (i === 0) thumb = await canvasToJpeg(canvas, w, h, 320);
        enc.addFrame(ctx.getImageData(0, 0, w, h).data, cs);
        if (o.onProgress) o.onProgress((i + 1) / total);
      }
      return { bytes: enc.finish(), width: w, height: h, thumb, durationMs: dur * 1000 };
    } finally {
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
    }
  }

  api.on('recorder:gif-job', async (job) => {
    try {
      const out = await webmToGif(job.buffer, {
        maxFps: job.maxFps, maxWidth: job.maxWidth,
        onProgress: (p) => api.send('recorder:gif-progress', { jobId: job.jobId, progress: p }),
      });
      await api.invoke('recorder:gif-result', {
        jobId: job.jobId, ok: true, buffer: out.bytes, width: out.width, height: out.height, thumb: out.thumb,
      });
    } catch (e) {
      await api.invoke('recorder:gif-result', { jobId: job.jobId, ok: false, error: (e && e.message) || String(e) });
    }
  });

  window.recorderWorker = {
    start,
    pause,
    resume,
    stop: () => stop(true),
    discard: () => stop(false),
    webmToGif,
  };
})();
