const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/renderer/editor/core/geometry');
const M = require('../src/renderer/editor/core/model');
const History = require('../src/renderer/editor/core/history');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('geometry: distToSegment and constrain helpers', () => {
  near(G.distToSegment(5, 5, 0, 0, 10, 0), 5);
  near(G.distToSegment(-3, 0, 0, 0, 10, 0), 3);
  const [x, y] = G.constrainAngle(0, 0, 10, 1, Math.PI / 4);
  near(y, 0, 1e-9); near(x, Math.hypot(10, 1));
  assert.deepEqual(G.constrainSquare(0, 0, 10, -4), [10, -10]);
});

test('geometry: resizeRect handles, flipping and aspect lock', () => {
  const r = { x: 10, y: 10, w: 100, h: 50 };
  assert.deepEqual(G.resizeRect(r, 'se', 160, 90), { x: 10, y: 10, w: 150, h: 80 });
  assert.deepEqual(G.resizeRect(r, 'w', 0, 0), { x: 0, y: 10, w: 110, h: 50 });
  assert.deepEqual(G.resizeRect(r, 'e', -10, 0), { x: -10, y: 10, w: 20, h: 50 }); // flipped across the left edge
  const locked = G.resizeRect(r, 'se', 210, 40, { ratio: 2 });
  near(locked.w / locked.h, 2); near(locked.x, 10); near(locked.y, 10);
  const edge = G.resizeRect(r, 'e', 210, 0, { ratio: 2 });
  near(edge.w, 200); near(edge.h, 100); near(edge.y + edge.h / 2, 35);
});

test('geometry: fitRatio keeps the rect inside bounds', () => {
  const b = { x: 0, y: 0, w: 400, h: 300 };
  const r = G.fitRatio({ x: 0, y: 0, w: 400, h: 300 }, 1, b);
  assert.deepEqual(r, { x: 50, y: 0, w: 300, h: 300 });
  const wide = G.fitRatio(b, 16 / 9, b);
  near(wide.w / wide.h, 16 / 9); assert.ok(wide.x >= 0 && wide.y >= 0 && wide.w <= 400);
});

test('geometry: calloutTail picks side and orders points clockwise', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 };
  assert.equal(G.calloutTail(box, 150, 150), null);
  const b = G.calloutTail(box, 180, 300, { radius: 10, halfBase: 12 });
  assert.equal(b.side, 'bottom'); assert.ok(b.p1.x > b.p2.x); assert.equal(b.p1.y, 200);
  const l = G.calloutTail(box, 0, 150);
  assert.equal(l.side, 'left'); assert.ok(l.p1.y > l.p2.y);
  const t = G.calloutTail(box, 300, 0, { radius: 10, halfBase: 12 });
  assert.ok(t.p2.x <= 300 - 10); // base stays clear of the corner radius
});

test('geometry: wrapText wraps words, breaks long words, keeps newlines', () => {
  const measure = s => s.length * 10;
  assert.deepEqual(G.wrapText('aaa bbb ccc', 70, measure), ['aaa bbb', 'ccc']);
  assert.deepEqual(G.wrapText('abcdefghij', 40, measure), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(G.wrapText('a\nb c', 0, measure), ['a', 'b c']);
});

test('history: undo/redo, truncation, dirty tracking and limit', () => {
  const h = new History('a', { equals: (x, y) => x === y });
  assert.equal(h.push('a'), false);
  h.push('b'); h.push('c');
  assert.equal(h.isDirty(), true);
  h.markSaved(); assert.equal(h.isDirty(), false);
  assert.equal(h.undo(), 'b'); assert.equal(h.isDirty(), true);
  assert.equal(h.redo(), 'c'); assert.equal(h.isDirty(), false);
  h.undo(); h.push('d'); // drops redo branch
  assert.equal(h.canRedo, false);
  h.undo(); h.undo(); assert.equal(h.current, 'a'); assert.equal(h.undo(), null);
  const lim = new History(0, { limit: 3 });
  [1, 2, 3, 4].forEach(v => lim.push(v));
  assert.equal(lim.stack.length, 3); assert.equal(lim.current, 4);
  lim.markSaved(); lim.push(5); lim.undo(); assert.equal(lim.isDirty(), false);
});

test('model: createObject/normalize drops unknown and repairs bad values', () => {
  assert.equal(M.normalizeObject({ type: 'nope' }), null);
  assert.equal(M.normalizeObject({ type: 'image', src: 'http://x' }), null);
  const o = M.normalizeObject({ type: 'rect', x: 'a', y: 5, w: 10, h: 20, width: -3, opacity: 7, stroke: 5 });
  assert.equal(o.x, 0); assert.equal(o.y, 5); assert.equal(o.width, 0); assert.equal(o.opacity, 1);
  assert.equal(o.stroke, M.DEFAULTS.rect.stroke); assert.ok(o.id);
  const p = M.normalizeObject({ type: 'pen', points: [[1, 2], ['x', 3], [4, 5]] });
  assert.deepEqual(p.points, [[1, 2], [4, 5]]);
});

test('model: serialize/deserialize roundtrip strips transient fields', () => {
  const rect = M.createObject('rect', { x: 1, y: 2, w: 30, h: 40, fill: '#00ff00' });
  rect._cache = 123;
  const text = M.createObject('text', { x: 5, y: 5, text: 'hi' });
  const json = JSON.parse(JSON.stringify(M.serialize({
    width: 200, height: 100, objects: [rect, text],
    baseOps: [{ op: 'crop', x: 1, y: 1, w: 200, h: 100 }, { op: 'extend', w: 300, h: 200, ox: 10, oy: 20, bg: '#fff' }]
  })));
  assert.equal(json.version, 1);
  assert.ok(!('_cache' in json.objects[0]));
  const d = M.deserialize(json);
  assert.equal(d.objects.length, 2); assert.equal(d.objects[0].fill, '#00ff00');
  assert.equal(d.objects[0].id, rect.id); assert.equal(d.baseOps.length, 2);
  assert.equal(M.deserialize({ version: 99 }), null);
  assert.equal(M.deserialize({ version: 1, baseOps: [{ op: 'crop', x: 0, y: 0, w: 0, h: 5 }] }), null);
});

test('model: hit testing for outline-only and filled shapes, lines and pen', () => {
  const r = M.createObject('rect', { x: 0, y: 0, w: 100, h: 100, width: 4 });
  assert.equal(M.hitTest(r, 50, 50, 3), false);
  assert.equal(M.hitTest(r, 1, 50, 3), true);
  r.fill = '#fff'; assert.equal(M.hitTest(r, 50, 50, 3), true);
  const e = M.createObject('ellipse', { x: 0, y: 0, w: 100, h: 100, width: 4 });
  assert.equal(M.hitTest(e, 50, 50, 3), false); assert.equal(M.hitTest(e, 50, 1, 3), true);
  const l = M.createObject('line', { x1: 0, y1: 0, x2: 100, y2: 0, width: 4 });
  assert.equal(M.hitTest(l, 50, 4, 3), true); assert.equal(M.hitTest(l, 50, 20, 3), false);
  const pen = M.createObject('pen', { points: [[0, 0], [50, 50], [100, 0]], width: 4 });
  assert.equal(M.hitTest(pen, 25, 25, 3), true); assert.equal(M.hitTest(pen, 50, 0, 3), false);
  const c = M.createObject('callout', { x: 0, y: 0, w: 100, h: 50, tx: 50, ty: 90 });
  assert.equal(M.hitTest(c, 50, 70, 0), true); // inside tail
  assert.equal(M.hitTest(c, 10, 70, 0), false);
  assert.equal(M.hitTestAll([r, e], 1, 50, 3), 1);
  assert.equal(M.hitTestAll([e, r], 50, 50, 3), 1); // outline-only ellipse doesn't block the filled rect
});

test('model: move/resize/scale transform every coordinate', () => {
  const c = M.createObject('callout', { x: 10, y: 10, w: 100, h: 50, tx: 30, ty: 100 });
  M.moveObject(c, 5, -5);
  assert.deepEqual([c.x, c.y, c.tx, c.ty], [15, 5, 35, 95]);
  const pen = M.createObject('pen', { points: [[0, 0], [10, 20]] });
  M.resizeObject(pen, { x: 0, y: 0, w: 20, h: 20 });
  assert.deepEqual(pen.points, [[0, 0], [20, 20]]);
  const t = M.createObject('text', { x: 0, y: 0, w: 0, h: 0, size: 20 });
  M.resizeObject(t, { x: 4, y: 5, w: 150, h: 99 });
  assert.equal(t.autoW, false); assert.equal(t.w, 150);
  const r = M.createObject('rect', { x: 10, y: 20, w: 30, h: 40, width: 4 });
  M.scaleObject(r, 2, 2);
  assert.deepEqual([r.x, r.y, r.w, r.h, r.width], [20, 40, 60, 80, 8]);
});

test('model: duplicate, reorder and step numbering', () => {
  const a = M.createObject('rect'), b = M.createObject('rect'), c = M.createObject('rect');
  const ids = list => list.map(o => o.id);
  assert.deepEqual(ids(M.reorder([a, b, c], [a.id], 'front')), [b.id, c.id, a.id]);
  assert.deepEqual(ids(M.reorder([a, b, c], [c.id], 'back')), [c.id, a.id, b.id]);
  assert.deepEqual(ids(M.reorder([a, b, c], [a.id, b.id], 'forward')), [c.id, a.id, b.id]);
  assert.deepEqual(ids(M.reorder([a, b, c], [b.id], 'backward')), [b.id, a.id, c.id]);
  const d = M.duplicate(a, 10, 10);
  assert.notEqual(d.id, a.id); assert.equal(d.x, a.x + 10);
  assert.equal(M.nextStepNumber([]), 1);
  assert.equal(M.nextStepNumber([M.createObject('step', { number: 4 }), M.createObject('step', { number: 2 })]), 5);
});

test('model: panel props map special keys', () => {
  const s = M.createObject('step', { x: 10, y: 10, w: 40, h: 40 });
  M.setProp(s, 'size', 60);
  assert.deepEqual([s.x, s.y, s.w, s.h], [0, 0, 60, 60]);
  const hl = M.createObject('highlight'), pen = M.createObject('pen', { blend: 'multiply' });
  M.setProp(hl, 'hlColor', '#111111'); M.setProp(pen, 'hlColor', '#222222');
  assert.equal(hl.fill, '#111111'); assert.equal(pen.stroke, '#222222');
  assert.equal(M.styleKeyOf(pen), 'hlpen');
  assert.equal(M.supportsProp(M.createObject('line'), 'fill'), false);
  assert.equal(M.supportsProp(M.createObject('rect'), 'fill'), true);
});
