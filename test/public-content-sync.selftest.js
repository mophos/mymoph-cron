/* ทดสอบ public-content-sync.js กับ MyMOPH Public API จำลอง + MySQL/MariaDB สำหรับทดสอบ : npm run test:public-content
 *
 *   TEST_DB_HOST TEST_DB_PORT TEST_DB_NAME TEST_DB_USER TEST_DB_PASSWORD   (ชื่อ database ต้องมีคำว่า test : ตารางถูก drop ทุกครั้ง)
 *   PUBLIC_CONTENT_SQL   path ของ public_content.sql (ค่าเริ่มต้น ../../appcode/mymoph-api/docs/public_content.sql)
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { createPublicContentSync, SOURCES } = require('../public-content-sync');

const KEY = 'mph_selftest_key';
const MEDIA = 'https://mymoph.moph.go.th/media/media/01a14487-8735-7291-9587-ff3ecbedb599';

const dbName = process.env.TEST_DB_NAME || '';
if (!/test/i.test(dbName)) {
  console.error('ตั้ง TEST_DB_NAME เป็น database สำหรับทดสอบ (ชื่อต้องมีคำว่า test) — ตาราง public_content* จะถูก drop');
  process.exit(1);
}
const db = require('knex')({
  client: 'mysql',
  connection: {
    host: process.env.TEST_DB_HOST || '127.0.0.1',
    port: +(process.env.TEST_DB_PORT || 3306),
    database: dbName,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    multipleStatements: true,
  },
});

// ---------- ข้อมูลต้นทางจำลอง ----------
const news = (n, updatedAt, title) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, slug: `news-${n}`, title: title || `ข่าว ${n}`, excerpt: null,
  isPinned: false, publishedAt: '2026-11-01T02:00:00.000Z', updatedAt, viewCount: n * 10,
  category: { name: 'ประชาสัมพันธ์', slug: 'pr' }, tags: [], coverUrl: `${MEDIA}/cover-${n}.webp`, coverLargeUrl: null,
  url: `https://mymoph.moph.go.th/news/news-${n}`,
});
const detailOf = (item, html) => Object.assign({}, item, { description: null, author: 'admin', coverAlt: '', contentHtml: html || `<p>${item.title}</p><img src="${MEDIA}/body.webp">` });
const guide = (n) => ({ id: `guide-${n}`, slug: `guide-${n}`, title: `คู่มือ ${n}`, excerpt: null, category: { name: 'แอป', slug: 'app' }, coverUrl: null, url: `https://mymoph.moph.go.th/guides/guide-${n}` });
const carousel = (n, platform) => ({ id: `car-${n}`, title: `สไลด์ ${n}`, imageUrl: `${MEDIA}/car-${n}.webp`, mobileImageUrl: null, thumbnailUrl: `${MEDIA}/car-${n}-t.webp`, width: 1200, height: 400, linkUrl: null, openInNewTab: false, platform, startAt: null, endAt: null });
const release = (n, platform, version) => ({ id: `rel-${n}`, version, platform, releaseDate: '2026-11-01', isMandatory: false, notesHtml: '<p>แก้ไข</p>', notesText: 'แก้ไข' });

const up = {
  lists: {},
  details: {}, // path -> slug -> { etag, data }
  fail: {}, // `${path}?page=n` -> status ที่ตอบตลอด
  once: {}, // path -> { status, headers } ตอบครั้งเดียวแล้วหาย
  headers: {}, // path -> header เพิ่มในคำตอบ
  unauthorized: false,
};
const seen = [];

function setNews(items, html) {
  up.lists['/news'] = items;
  up.details['/news'] = {};
  items.forEach((it) => { up.details['/news'][it.slug] = { etag: `"${it.slug}-${it.updatedAt}"`, data: detailOf(it, html && html[it.slug]) }; });
}
setNews([news(1, '2026-11-01T03:00:00.000Z', 'เปิดตัว MyMOPH 🎉'), news(2, '2026-11-01T03:00:00.000Z'), news(3, '2026-11-01T03:00:00.000Z')]);
up.lists['/guides'] = [guide(1)];
up.details['/guides'] = { 'guide-1': { etag: '"g1"', data: detailOf(guide(1)) } };
['/albums', '/pages', '/downloads'].forEach((p) => { up.lists[p] = []; up.details[p] = {}; });
up.lists['/faq'] = [{ id: 'faq-1', question: 'ลืมรหัสผ่าน?', answerHtml: '<p>รีเซ็ต</p>', category: null }, { id: 'faq-2', question: 'ติดต่อ?', answerHtml: '<p>โทร</p>', category: null }];
up.lists['/faq?featured=true'] = [up.lists['/faq'][1]];
up.lists['/carousels?place=web'] = [carousel(1, 'all')];
up.lists['/carousels?place=app'] = [carousel(2, 'all')];
['ios', 'android', 'huawei'].forEach((p) => {
  up.lists[`/carousels?place=app&platform=${p}`] = [carousel(2, 'all'), carousel(`3${p}`, p)];
  up.lists[`/releases?platform=${p}`] = [release(`${p}-1`, p, '3.1.0')];
});
up.lists['/releases'] = [release('ios-1', 'ios', '3.1.0'), release('android-1', 'android', '3.1.0')];

const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  seen.push({ path: p, query: Object.fromEntries(u.searchParams), headers: req.headers });
  const send = (status, body, headers) => {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, up.headers[p] || {}, headers || {}));
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  if (req.headers['x-api-key'] !== KEY || up.unauthorized) return send(401, { error: { code: 'invalid_api_key', message: 'API key ไม่ถูกต้อง' } });
  if (up.once[p]) {
    const o = up.once[p];
    delete up.once[p];
    return send(o.status, { error: { code: 'rate_limited', message: 'ช้าลงหน่อย' } }, o.headers);
  }
  const page = Number(u.searchParams.get('page') || 1);
  const limit = Number(u.searchParams.get('limit') || 20);
  const failStatus = up.fail[`${p}?page=${page}`];
  if (failStatus) return send(failStatus, { error: { code: 'internal', message: 'ล้ม' } });

  const parts = p.split('/').filter(Boolean);
  if (parts.length === 2) {
    const d = (up.details[`/${parts[0]}`] || {})[decodeURIComponent(parts[1])];
    if (!d) return send(404, { error: { code: 'not_found', message: 'ไม่พบ' } });
    if (req.headers['if-none-match'] === d.etag) return send(304, undefined, { ETag: d.etag });
    return send(200, { data: d.data, meta: { fields: [] } }, { ETag: d.etag });
  }
  const filters = new URLSearchParams(u.searchParams);
  filters.delete('page');
  filters.delete('limit');
  const key = filters.toString() ? `${p}?${filters.toString()}` : p;
  const all = up.lists[key];
  if (!all) return send(404, { error: { code: 'endpoint_disabled', message: 'ปิด' } });
  const totalPages = Math.max(1, Math.ceil(all.length / limit));
  const meta = { page, limit, total: all.length, totalPages, hasNext: page < totalPages, fields: [{ name: 'id', type: 'string', description: 'รหัส' }] };
  if (p === '/releases' && filters.get('platform')) Object.assign(meta, { latestVersion: '3.1.0', minimumVersion: '3.0.0' });
  return send(200, { data: all.slice((page - 1) * limit, page * limit), meta });
});

// ---------- ตัวช่วย ----------
let clock = Date.parse('2026-11-26T01:00:00.000Z');
const waits = [];
const events = [];
const rows = (resource) => db('public_content').where({ resource }).orderBy('position');
const state = (resource) => db('public_content_sync').where({ resource }).first();
const since = (mark) => seen.slice(mark);
const okLog = (resource, from) => events.slice(from).find((e) => e.event === 'PUBLIC_SYNC_OK' && e.data.resource === resource);

const run = async () => {
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${mock.address().port}`;
  const sqlFile = process.env.PUBLIC_CONTENT_SQL || path.join(__dirname, '../../../appcode/mymoph-api/docs/public_content.sql');
  await db.raw('DROP TABLE IF EXISTS public_content, public_content_sync');
  await db.raw(fs.readFileSync(sqlFile, 'utf8'));

  const opts = {
    db, apiKey: KEY, baseUrl, pageLimit: 2, requestGapMs: 0,
    now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    log: (event, data) => events.push({ event, data }),
  };
  const sync = createPublicContentSync(opts);

  // ---------- 1. รอบแรก : ดึงครบ เก็บครบ ----------
  let mark = seen.length;
  let r = await sync.runOnce();
  assert.deepStrictEqual([r.ok, r.failed], [SOURCES.length, 0], 'รอบแรกสำเร็จทุก resource');
  assert.ok(since(mark).every((s) => s.headers['x-api-key'] === KEY && !('apiKey' in s.query) && !('key' in s.query)), 'ส่ง key ทาง header เท่านั้น');
  assert.deepStrictEqual(since(mark).filter((s) => s.path === '/news').map((s) => s.query.page), ['1', '2'], 'news ไล่ 2 หน้า (limit 2)');
  let news1 = await rows('news');
  assert.deepStrictEqual(news1.map((x) => [x.slug, x.position, x.is_active]), [['news-1', 0, 1], ['news-2', 1, 1], ['news-3', 2, 1]]);
  assert.strictEqual(JSON.parse(news1[0].summary_json).title, 'เปิดตัว MyMOPH 🎉', 'emoji เก็บผ่าน connection utf8 ได้');
  assert.ok(!/[\ud800-\udfff]/.test(news1[0].summary_json), 'ไม่มี surrogate ดิบใน DB');
  assert.strictEqual(news1[0].category_slug, 'pr');
  assert.ok(JSON.parse(news1[1].detail_json).contentHtml.includes('<img'), 'เก็บรายละเอียดแล้ว');
  assert.strictEqual(news1[1].detail_etag, '"news-2-2026-11-01T03:00:00.000Z"');
  const guide1 = (await rows('guide'))[0];
  assert.ok(guide1.detail_json && guide1.detail_etag === '"g1"', 'guide มีรายละเอียด');
  assert.deepStrictEqual((await rows('carousel:app:ios')).map((x) => x.item_id), ['car-2', 'car-3ios'], 'carousel แยกตาม platform ตามลำดับต้นทาง');
  assert.deepStrictEqual((await rows('faq:featured')).map((x) => x.item_id), ['faq-2']);
  const relIos = await state('release:ios');
  assert.deepStrictEqual(JSON.parse(relIos.meta_json), { latestVersion: '3.1.0', minimumVersion: '3.0.0' }, 'meta ของ release เก็บโดยตัด paging/fields');
  assert.strictEqual((await state('news')).meta_json, null);
  assert.strictEqual((await state('news')).last_status, 'ok');

  // ---------- 2. ไม่มีอะไรเปลี่ยน : ไม่ดึงรายละเอียดซ้ำ ----------
  clock += 30 * 60 * 1000;
  mark = seen.length;
  let ev = events.length;
  r = await sync.runOnce();
  assert.strictEqual(r.failed, 0);
  assert.strictEqual(since(mark).filter((s) => s.path.split('/').length > 2).length, 0, 'ไม่มีการดึง /{slug}');
  assert.deepStrictEqual([okLog('news', ev).data.unchanged, okLog('news', ev).data.updated, okLog('news', ev).data.inserted], [3, 0, 0]);

  // ---------- 3. เพิ่ม / แก้ / ถอนการเผยแพร่ ----------
  clock += 30 * 60 * 1000;
  setNews([news(4, '2026-11-26T01:00:00.000Z'), news(1, '2026-11-01T03:00:00.000Z', 'เปิดตัว MyMOPH 🎉'), news(2, '2026-11-26T01:30:00.000Z', 'ข่าว 2 (แก้ไข)')],
    { 'news-2': '<p>เนื้อหาใหม่</p>' });
  mark = seen.length;
  ev = events.length;
  r = await sync.runOnce();
  assert.deepStrictEqual(since(mark).filter((s) => s.path.startsWith('/news/')).map((s) => s.path).sort(), ['/news/news-2', '/news/news-4'], 'ดึงรายละเอียดเฉพาะแถวใหม่/updatedAt เปลี่ยน');
  const news3 = await db('public_content').where({ resource: 'news' }).orderBy(['is_active', 'position']);
  const byId = (id) => news3.find((x) => x.item_id === `00000000-0000-4000-8000-00000000000${id}`);
  assert.deepStrictEqual([byId(4).position, byId(1).position, byId(2).position], [0, 1, 2], 'ลำดับตามต้นทาง');
  assert.strictEqual(byId(3).is_active, 0, 'ข่าวที่หายจากต้นทาง = ปิด');
  assert.ok(byId(3).removed_at instanceof Date);
  assert.strictEqual(JSON.parse(byId(2).detail_json).contentHtml, '<p>เนื้อหาใหม่</p>');
  assert.strictEqual(JSON.parse(byId(2).summary_json).title, 'ข่าว 2 (แก้ไข)');
  assert.ok(byId(1).first_seen_at.getTime() < byId(4).first_seen_at.getTime(), 'first_seen_at ไม่ถูกเขียนทับ');
  assert.strictEqual(okLog('news', ev).data.removed, 1);

  // ---------- 4. guide (ไม่มี updatedAt) : ครบ 6 ชม. ถามซ้ำแบบ If-None-Match → 304 ----------
  clock += 7 * 60 * 60 * 1000;
  mark = seen.length;
  ev = events.length;
  await sync.runOnce();
  const g = since(mark).filter((s) => s.path === '/guides/guide-1');
  assert.strictEqual(g.length, 1, 'ตรวจ guide ซ้ำ 1 ครั้ง');
  assert.strictEqual(g[0].headers['if-none-match'], '"g1"');
  assert.strictEqual(okLog('guide', ev).data.detailNotModified, 1);
  const guide4 = (await rows('guide'))[0];
  assert.ok(guide4.detail_json === guide1.detail_json && guide4.detail_checked_at > guide1.detail_checked_at, '304 = เก็บรายละเอียดเดิม เลื่อนเวลาตรวจ');
  mark = seen.length;
  await sync.runOnce();
  assert.strictEqual(since(mark).filter((s) => s.path === '/guides/guide-1').length, 0, 'ยังไม่ครบ 6 ชม. ไม่ถามซ้ำ');

  // ---------- 5. ล้มกลางการไล่หน้า : ไม่เขียนอะไร ไม่ปิดแถว ----------
  const okBefore = (await state('news')).last_success_at;
  up.lists['/news'] = [news(4, '2026-11-26T01:00:00.000Z'), news(2, '2026-11-26T01:30:00.000Z'), news(5, '2026-11-26T02:00:00.000Z')];
  up.fail['/news?page=2'] = 500;
  mark = seen.length;
  waits.length = 0;
  r = await sync.runOnce();
  assert.strictEqual(r.failed, 1, 'เฉพาะ news ล้ม');
  assert.strictEqual(r.ok, SOURCES.length - 1, 'resource อื่นทำต่อ');
  assert.strictEqual(since(mark).filter((s) => s.path === '/news' && s.query.page === '2').length, 4, 'ลองซ้ำ 3 ครั้ง');
  assert.deepStrictEqual(waits.slice(0, 3), [1000, 2000, 4000], 'backoff');
  const st5 = await state('news');
  assert.strictEqual(st5.last_status, 'error');
  assert.ok(/internal HTTP 500/.test(st5.last_error), st5.last_error);
  assert.strictEqual(st5.last_success_at.getTime(), okBefore.getTime(), 'last_success_at ไม่ขยับ');
  assert.strictEqual((await rows('news')).find((x) => x.slug === 'news-1').is_active, 1, 'ไม่ปิด news-1 ทั้งที่หายจากหน้าแรก');
  assert.strictEqual(await db('public_content').where({ resource: 'news', slug: 'news-5' }).first(), undefined, 'ไม่เขียนแถวจากหน้าที่ดึงได้');
  delete up.fail['/news?page=2'];

  // ---------- 6. 429 : รอตาม Retry-After แล้วทำต่อ ----------
  up.once['/faq'] = { status: 429, headers: { 'Retry-After': '2' } };
  waits.length = 0;
  ev = events.length;
  r = await sync.runOnce();
  assert.strictEqual(r.failed, 0);
  assert.ok(waits.includes(2000), 'รอ 2 วินาที');
  assert.ok(okLog('faq', ev), 'faq สำเร็จหลังรอ');

  // ---------- 7. โควตาหมด (X-RateLimit-Remaining: 0) : รอจนรีเซ็ต ----------
  up.headers['/pages'] = { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(Math.floor(clock / 1000) + 5) };
  waits.length = 0;
  await sync.runOnce();
  assert.ok(waits.some((w) => w >= 4000 && w <= 5000), `รอจนรีเซ็ต ${waits}`);
  delete up.headers['/pages'];

  // ---------- 8. ต้นทางตอบว่าง ----------
  up.lists['/news'] = [];
  up.lists['/carousels?place=web'] = [];
  await sync.runOnce();
  assert.ok((await rows('news')).filter((x) => x.is_active).length >= 3, 'news ว่าง (ไม่ควรว่าง) = ไม่ปิดแถวเดิม');
  assert.ok(events.some((e) => e.event === 'PUBLIC_SYNC_EMPTY_IGNORED' && e.data.resource === 'news'));
  assert.strictEqual((await rows('carousel:web'))[0].is_active, 0, 'carousel ว่างได้จริง = ปิด');

  // ---------- 9. key ใช้ไม่ได้ : หยุดทั้งรอบ ----------
  up.unauthorized = true;
  mark = seen.length;
  ev = events.length;
  r = await sync.runOnce();
  assert.deepStrictEqual([r.ok, r.failed], [0, 1]);
  assert.strictEqual(since(mark).length, 1, 'ไม่เรียก resource อื่นต่อ');
  assert.ok(events.slice(ev).some((e) => e.event === 'PUBLIC_SYNC_ABORT'));
  assert.ok(!JSON.stringify(events).includes(KEY), 'ไม่มี API key ใน log');
  up.unauthorized = false;

  // ---------- 10. รอบซ้อน / ไม่มี key ----------
  const first = sync.runOnce();
  assert.deepStrictEqual(await sync.runOnce(), { skipped: 'running' });
  await first;
  assert.deepStrictEqual(await createPublicContentSync(Object.assign({}, opts, { apiKey: '' })).runOnce(), { skipped: 'no_api_key' });

  console.log('✅ public-content-sync selftest ผ่านทั้งหมด');
};

run()
  .catch((e) => {
    console.error('❌', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    mock.close();
    await db.destroy();
  });
