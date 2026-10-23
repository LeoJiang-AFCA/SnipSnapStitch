/* Canvas rendering of annotation objects onto the document bitmap (browser only). */
(function (root) {
  'use strict';
  const RS = root.RS;
  const G = RS.geometry, M = RS.model;

  const mctx = document.createElement('canvas').getContext('2d');
  const scratchCanvas = document.createElement('canvas');
  const imageCache = new Map();
  let onAssetLoaded = null;

  function fontString(o, size) {
    return (o.italic ? 'italic ' : '') + (o.bold ? 'bold ' : '') + (size || o.size) + 'px "' + o.font + '", "Segoe UI", sans-serif';
  }

  function textPad(o) {
    return o.type === 'text' ? Math.round(o.size * 0.25) : Math.round(o.size * 0.6);
  }

  // Computes wrapped lines and (for auto-size text / callouts) w/h. Cached by a signature.
  function layoutText(o, force) {
    const sig = [o.text, o.font, o.size, o.bold, o.italic, o.w, o.autoW].join('|');
    if (!force && o._sig === sig && o._lines) return o;
    mctx.font = fontString(o);
    const pad = textPad(o), lineH = o.size * 1.25;
    const maxW = o.type === 'text' ? (o.autoW ? 0 : Math.max(10, o.w - pad * 2)) : Math.max(10, o.w - pad * 2);
    const measure = s => mctx.measureText(s).width;
    const lines = G.wrapText(o.text, maxW, measure);
    let tw = 0;
    for (const l of lines) tw = Math.max(tw, measure(l));
    const th = lines.length * lineH;
    o._lines = lines; o._lineH = lineH; o._pad = pad; o._tw = tw; o._th = th;
    if (o.type === 'text') {
      if (o.autoW) o.w = Math.max(tw + pad * 2, o.size * 0.6);
      o.h = th + pad * 2;
    } else {
      o.h = Math.max(o.h, th + pad * 2);
    }
    o._sig = [o.text, o.font, o.size, o.bold, o.italic, o.w, o.autoW].join('|');
    return o;
  }

  function ensureImage(o) {
    if (o._img) return o._img;
    let img = imageCache.get(o.src);
    if (!img) {
      img = new Image();
      img.onload = () => { if (onAssetLoaded) onAssetLoaded(); };
      img.src = o.src;
      imageCache.set(o.src, img);
    }
    o._img = img;
    return img;
  }

  function shadowScale(ctx) {
    return G.clamp(ctx.canvas.width / 1200, 1, 3);
  }

  function setShadow(ctx, o) {
    if (!o.shadow) return;
    const k = shadowScale(ctx);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10 * k;
    ctx.shadowOffsetX = 2 * k;
    ctx.shadowOffsetY = 3 * k;
  }

  function clearShadow(ctx) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }

  function setStroke(ctx, o) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const w = Math.max(1, o.width);
    if (o.dash === 'dashed') ctx.setLineDash([w * 3, w * 2]);
    else if (o.dash === 'dotted') ctx.setLineDash([0.01, w * 2]);
    else ctx.setLineDash([]);
  }

  function hasStroke(o) {
    return o.width > 0 && !!o.stroke && o.stroke !== 'transparent';
  }

  function fillAndStroke(ctx, o) {
    const filled = M.isFilled(o.fill);
    if (o.shadow) setShadow(ctx, o);
    if (filled) {
      ctx.fillStyle = o.fill;
      ctx.fill();
      clearShadow(ctx);
    }
    if (hasStroke(o)) { setStroke(ctx, o); ctx.stroke(); }
  }

  function drawRect(ctx, o) {
    const r = G.normRect(o);
    ctx.beginPath();
    const rad = Math.min(o.radius, r.w / 2, r.h / 2);
    if (rad > 0) ctx.roundRect(r.x, r.y, r.w, r.h, rad); else ctx.rect(r.x, r.y, r.w, r.h);
    fillAndStroke(ctx, o);
  }

  function drawEllipse(ctx, o) {
    const r = G.normRect(o);
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.1, r.w / 2), Math.max(0.1, r.h / 2), 0, 0, Math.PI * 2);
    fillAndStroke(ctx, o);
  }

  function drawLine(ctx, o) {
    if (o.shadow) setShadow(ctx, o);
    setStroke(ctx, o);
    ctx.beginPath();
    ctx.moveTo(o.x1, o.y1);
    ctx.lineTo(o.x2, o.y2);
    ctx.stroke();
  }

  function polygon(ctx, pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  function drawArrow(ctx, o) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const w = o.width, ang = Math.atan2(dy, dx), ux = dx / len, uy = dy / len;
    const headLen = Math.min(Math.max(14, w * 4.5), len * 0.8);
    if (o.shadow) setShadow(ctx, o);
    ctx.fillStyle = o.stroke;
    setStroke(ctx, o);
    ctx.setLineDash([]);
    const style = o.arrowStyle;
    if (style === 'tapered') {
      const nx = -uy, ny = ux, tw = Math.max(1, w * 0.25), nw = Math.max(2, w * 0.9), hw = headLen * 0.55;
      const bx = o.x2 - ux * headLen, by = o.y2 - uy * headLen;
      polygon(ctx, [
        { x: o.x1 + nx * tw, y: o.y1 + ny * tw }, { x: bx + nx * nw, y: by + ny * nw },
        { x: bx + nx * hw, y: by + ny * hw }, { x: o.x2, y: o.y2 },
        { x: bx - nx * hw, y: by - ny * hw }, { x: bx - nx * nw, y: by - ny * nw },
        { x: o.x1 - nx * tw, y: o.y1 - ny * tw }
      ]);
      ctx.fill();
      return;
    }
    if (style === 'open') {
      ctx.beginPath();
      ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2);
      const h = G.arrowHead(o.x2, o.y2, ang, headLen, 0.5);
      ctx.moveTo(h[1].x, h[1].y); ctx.lineTo(h[0].x, h[0].y); ctx.lineTo(h[2].x, h[2].y);
      ctx.stroke();
      return;
    }
    const k = headLen * 0.78;
    const sx = style === 'double' ? o.x1 + ux * k : o.x1, sy = style === 'double' ? o.y1 + uy * k : o.y1;
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(o.x2 - ux * k, o.y2 - uy * k);
    ctx.stroke();
    polygon(ctx, G.arrowHead(o.x2, o.y2, ang, headLen));
    ctx.fill();
    if (style === 'double') {
      polygon(ctx, G.arrowHead(o.x1, o.y1, ang + Math.PI, headLen));
      ctx.fill();
    } else if (style === 'dot') {
      ctx.beginPath();
      ctx.arc(o.x1, o.y1, Math.max(4, w * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawPen(ctx, o) {
    const pts = o.points;
    if (!pts.length) return;
    if (o.blend === 'multiply') ctx.globalCompositeOperation = 'multiply';
    if (o.shadow) setShadow(ctx, o);
    ctx.strokeStyle = o.stroke;
    ctx.fillStyle = o.stroke;
    ctx.lineWidth = o.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = o.cap || 'round';
    ctx.setLineDash([]);
    if (pts.length < 2) {
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], o.width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }

  function drawTextLines(ctx, o, left, top, width) {
    const pad = o._pad;
    ctx.font = fontString(o);
    ctx.fillStyle = o.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = o.align;
    const x = o.align === 'center' ? left + width / 2 : (o.align === 'right' ? left + width - pad : left + pad);
    o._lines.forEach((line, i) => ctx.fillText(line, x, top + i * o._lineH + o._lineH / 2));
  }

  function drawText(ctx, o) {
    layoutText(o);
    const r = G.normRect(o);
    const filled = M.isFilled(o.fill);
    if (filled) {
      if (o.shadow) setShadow(ctx, o);
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, o._pad * 0.6);
      ctx.fill();
      clearShadow(ctx);
    }
    if (o._editing || !o.text) return;
    if (!filled && o.shadow) setShadow(ctx, o);
    drawTextLines(ctx, o, r.x, r.y + o._pad, r.w);
  }

  function calloutPath(ctx, o) {
    const r = G.normRect(o);
    const rad = Math.min(o.radius, r.w / 2, r.h / 2);
    const tail = M.calloutTailOf(o);
    const x2 = r.x + r.w, y2 = r.y + r.h;
    const tailOn = side => (tail && tail.side === side ? tail : null);
    ctx.beginPath();
    ctx.moveTo(r.x + rad, r.y);
    let t = tailOn('top');
    if (t) { ctx.lineTo(t.p1.x, t.p1.y); ctx.lineTo(t.tip.x, t.tip.y); ctx.lineTo(t.p2.x, t.p2.y); }
    ctx.arcTo(x2, r.y, x2, r.y + rad, rad);
    t = tailOn('right');
    if (t) { ctx.lineTo(t.p1.x, t.p1.y); ctx.lineTo(t.tip.x, t.tip.y); ctx.lineTo(t.p2.x, t.p2.y); }
    ctx.arcTo(x2, y2, x2 - rad, y2, rad);
    t = tailOn('bottom');
    if (t) { ctx.lineTo(t.p1.x, t.p1.y); ctx.lineTo(t.tip.x, t.tip.y); ctx.lineTo(t.p2.x, t.p2.y); }
    ctx.arcTo(r.x, y2, r.x, y2 - rad, rad);
    t = tailOn('left');
    if (t) { ctx.lineTo(t.p1.x, t.p1.y); ctx.lineTo(t.tip.x, t.tip.y); ctx.lineTo(t.p2.x, t.p2.y); }
    ctx.arcTo(r.x, r.y, r.x + rad, r.y, rad);
    ctx.closePath();
  }

  function drawCallout(ctx, o) {
    layoutText(o);
    calloutPath(ctx, o);
    fillAndStroke(ctx, o);
    if (o._editing || !o.text) return;
    const r = G.normRect(o);
    drawTextLines(ctx, o, r.x, r.y + (r.h - o._th) / 2, r.w);
  }

  function drawStep(ctx, o) {
    const r = G.normRect(o);
    ctx.beginPath();
    if (o.shape === 'square') ctx.roundRect(r.x, r.y, r.w, r.h, r.w * 0.18);
    else ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    fillAndStroke(ctx, o);
    clearShadow(ctx);
    const txt = String(o.number);
    const size = r.w * (txt.length > 2 ? 0.36 : (txt.length > 1 ? 0.45 : 0.56));
    ctx.font = 'bold ' + size + 'px "' + o.font + '", "Segoe UI", sans-serif';
    ctx.fillStyle = o.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, r.x + r.w / 2, r.y + r.h / 2 + size * 0.04);
  }

  function drawStamp(ctx, o) {
    const r = G.normRect(o);
    if (o.shadow) setShadow(ctx, o);
    ctx.font = (r.h * 0.78) + 'px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(o.glyph, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.05);
  }

  function drawImageObj(ctx, o) {
    const img = ensureImage(o);
    if (!img.complete || !img.naturalWidth) return;
    const r = G.normRect(o);
    if (o.shadow) setShadow(ctx, o);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  }

  function scratch(w, h) {
    if (scratchCanvas.width < w || scratchCanvas.height < h) {
      scratchCanvas.width = Math.max(scratchCanvas.width, w);
      scratchCanvas.height = Math.max(scratchCanvas.height, h);
    }
    const c = scratchCanvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    return c;
  }

  function drawBlur(ctx, o) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height, r = G.normRect(o);
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const x2 = Math.min(cw, Math.ceil(r.x + r.w)), y2 = Math.min(ch, Math.ceil(r.y + r.h));
    const w = x2 - x, h = y2 - y;
    if (w < 1 || h < 1) return;
    if (o.mode === 'pixelate') {
      const size = Math.max(2, Math.round(o.amount));
      const data = ctx.getImageData(x, y, w, h).data;
      for (let by = 0; by < h; by += size) {
        for (let bx = 0; bx < w; bx += size) {
          const bw = Math.min(size, w - bx), bh = Math.min(size, h - by);
          let rr = 0, gg = 0, bb = 0, aa = 0;
          for (let yy = by; yy < by + bh; yy++) {
            let i = (yy * w + bx) * 4;
            for (let xx = 0; xx < bw; xx++, i += 4) { rr += data[i]; gg += data[i + 1]; bb += data[i + 2]; aa += data[i + 3]; }
          }
          const n = bw * bh;
          ctx.fillStyle = 'rgba(' + Math.round(rr / n) + ',' + Math.round(gg / n) + ',' + Math.round(bb / n) + ',' + (aa / n / 255).toFixed(3) + ')';
          ctx.clearRect(x + bx, y + by, bw, bh);
          ctx.fillRect(x + bx, y + by, bw, bh);
        }
      }
      return;
    }
    const amount = Math.max(1, o.amount);
    const pad = Math.ceil(amount * 2);
    const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad);
    const ex = Math.min(cw, x2 + pad), ey = Math.min(ch, y2 + pad);
    const sc = scratch(ex - sx, ey - sy);
    sc.drawImage(ctx.canvas, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.clearRect(x, y, w, h);
    ctx.filter = 'blur(' + amount + 'px)';
    ctx.drawImage(scratchCanvas, 0, 0, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
    ctx.restore();
  }

  function shapePath(ctx, r, shape) {
    ctx.beginPath();
    if (shape === 'ellipse' || shape === 'circle') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.1, r.w / 2), Math.max(0.1, r.h / 2), 0, 0, Math.PI * 2);
    else ctx.rect(r.x, r.y, r.w, r.h);
  }

  function drawSpotlight(ctx, o) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height, r = G.normRect(o);
    ctx.beginPath();
    ctx.rect(0, 0, cw, ch);
    if (o.shape === 'ellipse') ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.1, r.w / 2), Math.max(0.1, r.h / 2), 0, 0, Math.PI * 2);
    else ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0,0,0,' + G.clamp(o.opacity, 0, 1) + ')';
    ctx.fill('evenodd');
  }

  function drawMagnify(ctx, o) {
    const r = G.normRect(o);
    if (r.w < 2 || r.h < 2) return;
    const z = Math.max(1, o.zoom);
    const sw = Math.max(1, Math.ceil(r.w / z)), sh = Math.max(1, Math.ceil(r.h / z));
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const sc = scratch(sw, sh);
    sc.drawImage(ctx.canvas, Math.round(cx - sw / 2), Math.round(cy - sh / 2), sw, sh, 0, 0, sw, sh);
    ctx.save();
    if (o.shadow) {
      setShadow(ctx, o);
      shapePath(ctx, r, o.shape);
      ctx.fillStyle = '#000';
      ctx.fill();
      clearShadow(ctx);
    }
    shapePath(ctx, r, o.shape);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(r.x, r.y, r.w, r.h);
    ctx.drawImage(scratchCanvas, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
    ctx.restore();
    if (hasStroke(o)) {
      setStroke(ctx, o);
      shapePath(ctx, r, o.shape);
      ctx.stroke();
    }
  }

  function drawHighlight(ctx, o) {
    const r = G.normRect(o);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = o.fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  function drawObject(ctx, o) {
    ctx.save();
    ctx.globalAlpha = (o.type === 'spotlight') ? 1 : G.clamp(o.opacity, 0, 1);
    switch (o.type) {
      case 'rect': drawRect(ctx, o); break;
      case 'ellipse': drawEllipse(ctx, o); break;
      case 'line': drawLine(ctx, o); break;
      case 'arrow': drawArrow(ctx, o); break;
      case 'pen': drawPen(ctx, o); break;
      case 'text': drawText(ctx, o); break;
      case 'callout': drawCallout(ctx, o); break;
      case 'step': drawStep(ctx, o); break;
      case 'stamp': drawStamp(ctx, o); break;
      case 'image': drawImageObj(ctx, o); break;
      case 'highlight': drawHighlight(ctx, o); break;
      case 'blur': drawBlur(ctx, o); break;
      case 'spotlight': drawSpotlight(ctx, o); break;
      case 'magnify': drawMagnify(ctx, o); break;
      default: break;
    }
    ctx.restore();
  }

  function renderDocument(canvas, base, objects) {
    if (canvas.width !== base.width || canvas.height !== base.height) {
      canvas.width = base.width;
      canvas.height = base.height;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    for (const o of objects) drawObject(ctx, o);
  }

  RS.render = {
    renderDocument, drawObject, layoutText, fontString, textPad,
    setAssetLoadedCallback(fn) { onAssetLoaded = fn; }
  };
})(window);
