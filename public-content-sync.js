/**
 * ดึงข้อมูลสาธารณะจาก MyMOPH Public API (https://mymoph.moph.go.th/developers)
 * มาเก็บในตาราง public_content / public_content_sync (SQL : mymoph-api/docs/public_content.sql)
 * mymoph-api อ่านตารางนี้ตอบแอปที่ GET /public-content/*
 *
 * แต่ละรอบ (index.js สั่งตอนสตาร์ทและทุก 30 นาที) ทำทีละ resource ตามลำดับ:
 *   1. ดึงรายการทุกหน้า
 *   2. รายละเอียด (/{slug}) ดึงเฉพาะแถวใหม่ / updatedAt เปลี่ยน / ยังไม่มีรายละเอียด
 *      ต้นทางที่ไม่มี updatedAt ในรายการ (guides) ตรวจซ้ำทุก 6 ชม. ด้วย If-None-Match
 *   3. upsert เฉพาะแถวที่ใหม่หรือเปลี่ยน แล้ว is_active = 0 แถวที่ไม่อยู่ในต้นทางแล้ว
 *      (ทำในขั้นนี้ก็ต่อเมื่อดึงรายการได้ครบทุกหน้า ; ดึงไม่ครบ = ไม่เขียนอะไรเลย)
 *
 * - resource หนึ่งล้มไม่หยุด resource อื่น ยกเว้น 401 (key ใช้ไม่ได้) หยุดทั้งรอบ
 * - รอบก่อนยังไม่จบ = ข้ามรอบนี้
 * - ไม่พิมพ์ API key ลง log
 */
const crypto = require('crypto');
const axios = require('axios').default;

const DEFAULT_BASE_URL = 'https://mymoph.moph.go.th/api/v1/public';
const PAGE_LIMIT = 50; // สูงสุดที่ต้นทางรับ
const MAX_PAGES = 1000;
const DETAIL_REVALIDATE_MS = 6 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const MAX_WAIT_MS = 65 * 1000;
const WRITE_CHUNK = 100;

const PLATFORMS = ['ios', 'android', 'huawei'];

/**
 * resource = endpoint + ตัวกรองที่ใช้ดึง ; แอปเลือก resource ตามพารามิเตอร์ที่ส่งมา
 * allowEmpty : ต้นทางตอบว่างได้จริง (ว่าง = ปิดทุกแถว) ; ตัวอื่นถ้าว่างจะไม่ปิดแถวเดิม กันต้นทางตอบผิดพลาด
 */
const SOURCES = [
  { resource: 'news', path: '/news', detail: true },
  { resource: 'album', path: '/albums', detail: true },
  { resource: 'page', path: '/pages', detail: true },
  { resource: 'download', path: '/downloads', detail: true },
  { resource: 'guide', path: '/guides', detail: true },
  { resource: 'faq', path: '/faq' },
  { resource: 'faq:featured', path: '/faq', query: { featured: 'true' }, allowEmpty: true },
  { resource: 'carousel:web', path: '/carousels', query: { place: 'web' }, allowEmpty: true },
  { resource: 'carousel:app', path: '/carousels', query: { place: 'app' }, allowEmpty: true },
  ...PLATFORMS.map((p) => ({ resource: `carousel:app:${p}`, path: '/carousels', query: { place: 'app', platform: p }, allowEmpty: true })),
  { resource: 'release', path: '/releases' },
  ...PLATFORMS.map((p) => ({ resource: `release:${p}`, path: '/releases', query: { platform: p }, allowEmpty: true, keepMeta: true })),
];

const SUMMARY_COLS = ['slug', 'category_slug', 'position', 'is_active', 'summary_json', 'summary_hash', 'source_updated_at', 'synced_at', 'removed_at'];
const DETAIL_COLS = ['detail_json', 'detail_etag', 'detail_source_updated_at', 'detail_checked_at'];
const PAGING_META = ['page', 'limit', 'total', 'totalPages', 'hasNext', 'fields'];

class UpstreamError extends Error {
  constructor(status, code) {
    super(`${code}${status ? ` HTTP ${status}` : ''}`);
    this.status = status;
    this.code = code;
  }
}

/** JSON ที่มีแต่อักขระใน BMP : emoji ถูก escape เป็น \uXXXX จึงเก็บผ่าน connection utf8 (3 ไบต์) ได้ */
function toJson(value) {
  return JSON.stringify(value).replace(/[\ud800-\udfff]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function cut(value, max) {
  return value === undefined || value === null ? null : String(value).slice(0, max);
}

function errorFrom(res) {
  const body = res.data;
  const code = body && body.error && typeof body.error.code === 'string' ? body.error.code : 'HTTP_ERROR';
  return new UpstreamError(res.status, code.slice(0, 60));
}

/** ข้อมูล error ที่พิมพ์ได้ (ไม่มี header / config ของ axios ที่มี key) */
function safeError(e) {
  if (e instanceof UpstreamError) return { status: e.status || null, code: e.code };
  return { status: null, code: String((e && e.code) || 'ERROR').slice(0, 60), message: String((e && (e.sqlMessage || e.message)) || '').slice(0, 150) };
}

function headerMs(value, now) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at - now : null;
  }
  if (n > 1e12) return n - now; // epoch ms
  if (n > 1e9) return n * 1000 - now; // epoch วินาที
  return n * 1000; // วินาทีที่ต้องรอ
}

function clampWait(ms, fallback) {
  const v = ms === null || !Number.isFinite(ms) ? fallback : ms;
  return Math.min(Math.max(v, 0), MAX_WAIT_MS);
}

function createPublicContentSync(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const db = opts.db;
  const apiKey = (opts.apiKey !== undefined ? opts.apiKey : env.MYMOPH_PUBLIC_API_KEY || '').trim();
  const baseUrl = (opts.baseUrl || env.MYMOPH_PUBLIC_API_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  const http = opts.http || axios;
  const now = opts.now || Date.now;
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = opts.log || ((event, data) => console.log(`${event} ${JSON.stringify(data)}`));
  const sources = opts.sources || SOURCES;
  const pageLimit = opts.pageLimit || PAGE_LIMIT;
  const requestGapMs = opts.requestGapMs !== undefined ? opts.requestGapMs : 250;
  const timeoutMs = Math.min(Math.max(Number(env.MYMOPH_PUBLIC_API_TIMEOUT_MS) || 20000, 2000), 60000);

  let running = false;
  let warnedNoKey = false;
  let lastRequestAt = 0;

  async function request(path, query, headers, stats) {
    for (let attempt = 0; ; attempt++) {
      const gap = lastRequestAt + requestGapMs - now();
      if (gap > 0) await sleep(gap);
      lastRequestAt = now();
      let res;
      try {
        res = await http.request({
          method: 'GET',
          url: baseUrl + path,
          params: query || undefined,
          headers: Object.assign({ 'X-API-Key': apiKey, Accept: 'application/json' }, headers || {}),
          timeout: timeoutMs,
          maxRedirects: 0,
          validateStatus: () => true,
        });
      } catch (e) {
        stats.requests++;
        if (attempt < MAX_RETRIES) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new UpstreamError(0, String(e.code || 'NETWORK_ERROR').slice(0, 60));
      }
      stats.requests++;

      // โควตาต่อนาทีหมด : รอจนรีเซ็ตก่อนเรียกครั้งถัดไป
      const remaining = Number(res.headers['x-ratelimit-remaining']);
      if (res.headers['x-ratelimit-remaining'] !== undefined && remaining <= 0) {
        const wait = clampWait(headerMs(res.headers['x-ratelimit-reset'], now()), 60 * 1000);
        stats.waitedMs += wait;
        await sleep(wait);
      }

      if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
        const wait = res.status === 429
          ? clampWait(headerMs(res.headers['retry-after'], now()), 30 * 1000)
          : 1000 * 2 ** attempt;
        stats.waitedMs += wait;
        await sleep(wait);
        continue;
      }
      return res;
    }
  }

  async function fetchList(source, stats) {
    const items = [];
    const seen = new Set();
    let meta = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await request(source.path, Object.assign({}, source.query, { page, limit: pageLimit }), null, stats);
      if (res.status !== 200) throw errorFrom(res);
      const body = res.data;
      if (!body || !Array.isArray(body.data)) throw new UpstreamError(res.status, 'BAD_RESPONSE');
      if (page === 1) meta = body.meta || null;
      for (const item of body.data) {
        if (!item || item.id === undefined || item.id === null) continue;
        const id = String(item.id);
        // ต้นทางเปลี่ยนระหว่างไล่หน้า แถวอาจเลื่อนไปซ้ำในหน้าถัดไป
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(item);
      }
      const m = body.meta || {};
      const hasNext = m.hasNext === true || (m.hasNext === undefined && typeof m.totalPages === 'number' && page < m.totalPages);
      if (!hasNext || body.data.length === 0) return { items, meta };
    }
    throw new UpstreamError(0, 'TOO_MANY_PAGES');
  }

  /** ต้องดึงรายละเอียดไหม : null = ไม่ต้อง ; { etag } = ดึง (มี etag = ถามแบบมีเงื่อนไข) */
  function detailPlan(row, item) {
    if (!row || !Number(row.has_detail)) return { etag: null };
    const etag = row.detail_etag || null;
    if (item.updatedAt !== undefined && item.updatedAt !== null) {
      return row.detail_source_updated_at === cut(item.updatedAt, 40) ? null : { etag };
    }
    const checked = row.detail_checked_at ? new Date(row.detail_checked_at).getTime() : 0;
    return now() - checked >= DETAIL_REVALIDATE_MS ? { etag } : null;
  }

  async function fetchDetails(source, items, existing, stats) {
    const details = new Map();
    for (const item of items) {
      const id = String(item.id);
      const plan = detailPlan(existing.get(id), item);
      if (!plan || !item.slug) continue;
      const res = await request(`${source.path}/${encodeURIComponent(item.slug)}`, null, plan.etag ? { 'If-None-Match': plan.etag } : null, stats);
      if (res.status === 304) {
        details.set(id, { notModified: true });
        stats.detailNotModified++;
      } else if (res.status === 200 && res.data && res.data.data && typeof res.data.data === 'object') {
        details.set(id, { json: toJson(res.data.data), etag: cut(res.headers.etag, 255) });
        stats.detailFetched++;
      } else if (res.status === 401) {
        throw errorFrom(res);
      } else {
        // ถอนการเผยแพร่ระหว่างรอบ / ต้นทางล้มเฉพาะแถว : เก็บรายละเอียดเดิมไว้ รอบหน้าลองใหม่
        stats.detailFailed++;
        log('PUBLIC_SYNC_DETAIL_FAIL', Object.assign({ resource: source.resource, slug: cut(item.slug, 80) }, safeError(errorFrom(res))));
      }
    }
    return details;
  }

  async function loadIndex(resource) {
    const rows = await db('public_content')
      .where('resource', resource)
      .select('item_id', 'position', 'is_active', 'summary_hash', 'detail_etag', 'detail_source_updated_at', 'detail_checked_at',
        db.raw('detail_json IS NOT NULL AS has_detail'));
    return new Map(rows.map((r) => [String(r.item_id), r]));
  }

  async function syncSource(source, stats) {
    const startedAt = new Date(now());
    const { items, meta } = await fetchList(source, stats);
    const existing = await loadIndex(source.resource);
    const details = source.detail ? await fetchDetails(source, items, existing, stats) : new Map();

    const at = new Date(now());
    const summaryRows = [];
    const fullRows = [];
    const notModifiedIds = [];
    items.forEach((item, position) => {
      const id = String(item.id);
      const summaryJson = toJson(item);
      const hash = sha256(summaryJson);
      const old = existing.get(id);
      const row = {
        resource: source.resource,
        item_id: id,
        slug: cut(item.slug, 255),
        category_slug: item.category && item.category.slug ? cut(item.category.slug, 100) : null,
        position,
        is_active: 1,
        summary_json: summaryJson,
        summary_hash: hash,
        source_updated_at: cut(item.updatedAt, 40),
        first_seen_at: at,
        synced_at: at,
        removed_at: null,
      };
      const detail = details.get(id);
      const changed = !old || old.summary_hash !== hash || Number(old.position) !== position || !Number(old.is_active);
      if (!old) stats.inserted++;
      else if (changed) stats.updated++;
      else stats.unchanged++;

      if (detail && detail.json !== undefined) {
        fullRows.push(Object.assign(row, {
          detail_json: detail.json,
          detail_etag: detail.etag,
          detail_source_updated_at: row.source_updated_at,
          detail_checked_at: at,
        }));
      } else {
        if (detail && detail.notModified) notModifiedIds.push(id);
        if (changed) summaryRows.push(row);
      }
    });

    const ids = items.map((item) => String(item.id));
    const skipRemoval = ids.length === 0 && !source.allowEmpty && existing.size > 0;
    if (skipRemoval) log('PUBLIC_SYNC_EMPTY_IGNORED', { resource: source.resource, existing: existing.size });

    await db.transaction(async (trx) => {
      for (let i = 0; i < fullRows.length; i += WRITE_CHUNK) {
        await trx('public_content').insert(fullRows.slice(i, i + WRITE_CHUNK)).onConflict(['resource', 'item_id']).merge(SUMMARY_COLS.concat(DETAIL_COLS));
      }
      for (let i = 0; i < summaryRows.length; i += WRITE_CHUNK) {
        await trx('public_content').insert(summaryRows.slice(i, i + WRITE_CHUNK)).onConflict(['resource', 'item_id']).merge(SUMMARY_COLS);
      }
      // 304 : รายละเอียดเดิมยังใช้ได้ ; จำ updatedAt ล่าสุดไว้ไม่ให้ถามซ้ำทุกรอบ
      for (let i = 0; i < notModifiedIds.length; i += WRITE_CHUNK) {
        await trx('public_content')
          .where('resource', source.resource)
          .whereIn('item_id', notModifiedIds.slice(i, i + WRITE_CHUNK))
          .update({ detail_checked_at: at, detail_source_updated_at: trx.raw('source_updated_at') });
      }
      if (!skipRemoval) {
        stats.removed = await trx('public_content')
          .where('resource', source.resource)
          .where('is_active', 1)
          .whereNotIn('item_id', ids)
          .update({ is_active: 0, removed_at: at, synced_at: at });
      }
      let metaJson = null;
      if (source.keepMeta && meta) {
        const kept = {};
        Object.keys(meta).forEach((k) => { if (PAGING_META.indexOf(k) === -1) kept[k] = meta[k]; });
        metaJson = toJson(kept);
      }
      await trx('public_content_sync').insert({
        resource: source.resource,
        last_started_at: startedAt,
        last_finished_at: at,
        last_success_at: at,
        last_status: 'ok',
        last_error: null,
        item_count: ids.length,
        meta_json: metaJson,
      }).onConflict('resource').merge();
    });
  }

  async function recordFailure(resource, startedAt, info) {
    await db('public_content_sync').insert({
      resource,
      last_started_at: startedAt,
      last_finished_at: new Date(now()),
      last_status: 'error',
      last_error: cut(`${info.code}${info.status ? ` HTTP ${info.status}` : ''}${info.message ? ` ${info.message}` : ''}`, 255),
    }).onConflict('resource').merge(['last_started_at', 'last_finished_at', 'last_status', 'last_error']);
  }

  /** ไม่ reject : ผลรวมของรอบ { ok, failed } หรือ { skipped } */
  async function runOnce() {
    if (!apiKey) {
      if (!warnedNoKey) log('PUBLIC_SYNC_DISABLED', { reason: 'MYMOPH_PUBLIC_API_KEY not set' });
      warnedNoKey = true;
      return { skipped: 'no_api_key' };
    }
    if (running) {
      log('PUBLIC_SYNC_SKIP', { reason: 'previous run still running' });
      return { skipped: 'running' };
    }
    running = true;
    const t0 = now();
    const result = { ok: 0, failed: 0, requests: 0 };
    try {
      for (const source of sources) {
        const stats = { requests: 0, waitedMs: 0, inserted: 0, updated: 0, unchanged: 0, removed: 0, detailFetched: 0, detailNotModified: 0, detailFailed: 0 };
        const startedAt = new Date(now());
        try {
          await syncSource(source, stats);
          result.ok++;
          log('PUBLIC_SYNC_OK', Object.assign({ resource: source.resource }, stats));
        } catch (e) {
          result.failed++;
          const info = safeError(e);
          log('PUBLIC_SYNC_FAIL', Object.assign({ resource: source.resource }, info, { requests: stats.requests }));
          await recordFailure(source.resource, startedAt, info).catch((err) => log('PUBLIC_SYNC_STATE_FAIL', safeError(err)));
          if (e instanceof UpstreamError && e.status === 401) {
            log('PUBLIC_SYNC_ABORT', { reason: 'API key ใช้ไม่ได้ (401) ตรวจ MYMOPH_PUBLIC_API_KEY' });
            break;
          }
        } finally {
          result.requests += stats.requests;
        }
      }
    } catch (e) {
      log('PUBLIC_SYNC_FAIL', safeError(e));
    } finally {
      running = false;
    }
    log('PUBLIC_SYNC_DONE', Object.assign({ ms: now() - t0 }, result));
    return result;
  }

  return { runOnce };
}

module.exports = { createPublicContentSync, SOURCES, toJson };
