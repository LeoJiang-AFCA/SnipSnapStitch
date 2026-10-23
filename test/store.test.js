'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./helpers/mock-electron');
const store = require('../src/main/store');

const newDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sss-store-'));
const vid = (name) => store.addMedia(Buffer.from('video-bytes-' + name), { ext: 'webm', name, width: 100, height: 50 });

test('addMedia stores the file and lists newest first', async () => {
  store.setDataDir(newDir());
  const a = await vid('first');
  await new Promise((r) => setTimeout(r, 5));
  const b = await vid('second');
  assert.equal(a.type, 'video');
  assert.ok(fs.existsSync(path.join(store.dataDir(), a.file)));
  const names = (await store.list()).map((i) => i.name);
  assert.deepEqual(names, ['second', 'first']);
});

test('index is persisted and reloaded', async () => {
  const dir = newDir();
  store.setDataDir(dir);
  await vid('keep');
  store.setDataDir(dir);
  assert.deepEqual((await store.list()).map((i) => i.name), ['keep']);
});

test('rename ignores blank names; tags are trimmed and de-duplicated', async () => {
  store.setDataDir(newDir());
  const it = await vid('orig');
  assert.equal((await store.rename(it.id, '   ')).name, 'orig');
  assert.equal((await store.rename(it.id, ' New name ')).name, 'New name');
  assert.deepEqual((await store.setTags(it.id, 'a, B ,a,,b')).tags, ['a', 'B']);
});

test('list filters by type, favorite and search text', async () => {
  store.setDataDir(newDir());
  const a = await vid('alpha');
  const b = await store.addMedia(Buffer.from('g'), { ext: 'gif', name: 'beta' });
  await store.setFavorite(a.id, true);
  await store.setTags(b.id, ['holiday']);
  assert.deepEqual((await store.list({ type: 'gif' })).map((i) => i.name), ['beta']);
  assert.deepEqual((await store.list({ favorite: true })).map((i) => i.name), ['alpha']);
  assert.deepEqual((await store.list({ search: 'HOLI' })).map((i) => i.name), ['beta']);
  assert.equal((await store.list({ search: 'nothing' })).length, 0);
});

test('returned items are copies, not the live index', async () => {
  store.setDataDir(newDir());
  const it = await vid('x');
  it.name = 'tampered';
  it.tags.push('t');
  const again = await store.get(it.id);
  assert.equal(again.name, 'x');
  assert.deepEqual(again.tags, []);
});

test('remove deletes every file belonging to the item', async () => {
  const dir = newDir();
  store.setDataDir(dir);
  const it = await vid('gone');
  const other = await vid('stays');
  fs.writeFileSync(path.join(dir, it.id + '.thumb.jpg'), 'x');
  fs.writeFileSync(path.join(dir, it.id + '.old.webm'), 'x');
  assert.equal(await store.remove(it.id), true);
  assert.equal(await store.remove(it.id), false);
  const left = fs.readdirSync(dir).filter((f) => f.startsWith(it.id + '.'));
  assert.deepEqual(left, []);
  assert.ok(fs.existsSync(path.join(dir, other.file)));
});

test('replaceMedia swaps in the optimized file and drops the old one', async () => {
  const dir = newDir();
  store.setDataDir(dir);
  const it = await vid('big');
  const out = path.join(dir, it.id + '.optimizing.mp4');
  fs.writeFileSync(out, 'tiny');
  const updated = await store.replaceMedia(it.id, out, 'mp4', { sizeBytes: 4 });
  assert.equal(updated.file, it.id + '.mp4');
  assert.equal(updated.optimized, true);
  assert.equal(updated.sizeBytes, 4);
  assert.ok(!fs.existsSync(path.join(dir, it.file)));
  assert.ok(fs.existsSync(path.join(dir, updated.file)));
  assert.ok(updated.updatedAt >= it.updatedAt);
});

test('replaceMedia refuses unsupported targets', async () => {
  store.setDataDir(newDir());
  const it = await vid('v');
  await assert.rejects(() => store.replaceMedia(it.id, 'x', 'gif'), /Cannot replace/);
  await assert.rejects(() => store.replaceMedia('missing', 'x', 'mp4'), /not found/);
});

test('changes emit events', async () => {
  store.setDataDir(newDir());
  const seen = [];
  const on = (d) => seen.push(d.type);
  store.events.on('changed', on);
  const it = await vid('e');
  await store.setFavorite(it.id, true);
  await store.remove(it.id);
  store.events.off('changed', on);
  assert.deepEqual(seen, ['add', 'update', 'remove']);
});

test('annotations round-trip and missing ones read as null', async () => {
  store.setDataDir(newDir());
  const it = await vid('a');
  assert.equal(await store.getAnnotations(it.id), null);
  await store.saveAnnotations(it.id, { version: 1, objects: [{ t: 'rect' }] });
  assert.deepEqual(await store.getAnnotations(it.id), { version: 1, objects: [{ t: 'rect' }] });
});

test('a corrupt index is backed up and the library starts empty', async () => {
  const dir = newDir();
  fs.writeFileSync(path.join(dir, 'index.json'), '{broken');
  store.setDataDir(dir);
  assert.deepEqual(await store.list(), []);
  assert.ok(fs.existsSync(path.join(dir, 'index.json.corrupt')));
});

test('exporting a video copies the file', async () => {
  const dir = newDir();
  store.setDataDir(dir);
  const it = await vid('export');
  const dest = path.join(newDir(), 'out.webm');
  const r = await store.exportTo(it.id, dest);
  assert.equal(r.format, 'webm');
  assert.equal(fs.readFileSync(dest, 'utf8'), 'video-bytes-export');
  await assert.rejects(() => store.exportTo('nope', dest), /not found/);
});
