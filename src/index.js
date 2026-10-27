// Мониторинг АЗС: экран для руководства — проверки ОСК и отзывы посетителей на одном экране.
// Сервер только собирает данные (Google Таблица, админка отзывов, загруженные бланки станций) и хранит бланки; всё считает браузер
// (src/client/calc.mjs) — так бесплатному Cloudflare хватает лимита процессора при любом числе станций.
// Вход: пароль руководства (MONITOR_PASS) или пароль ОСК (OSK_PASS) — cookie на 30 дней; загружать бланки могут оба.
import { parseCsv, fromApi } from "./net.js";
import PAGE from "./page.html";
import CALC from "./client/calc.mjs";
import MAP from "./client/map.mjs";
import BLANK from "./client/blank.mjs";

const SHEETS = ["Станции", "Операторы", "Наблюдения", "Грубые нарушения", "Тайный покупатель", "Пункты ТП", "Находки ОСК и ОСБ", "Настройки"];
const JS = { "/js/calc.mjs": CALC, "/js/map.mjs": MAP, "/js/blank.mjs": BLANK };
const TTL = 120, enc = new TextEncoder();
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function hmac(key, msg) { const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg))); }
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
const todayMsk = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

/* вход: cookie m=<срок>.<роль>.<подпись>; роль boss — руководство, osk — специалист ОСК */
async function roleOf(req, env) {
  if (!env.MONITOR_PASS) return null;
  const m = /(?:^|;\s*)m=(\d+)\.(boss|osk)\.([0-9a-f]{64})/.exec(req.headers.get("cookie") || ""); if (!m || +m[1] < Date.now()) return null;
  return same(m[3], await hmac(env.MONITOR_PASS, `monitor.${m[1]}.${m[2]}`)) ? m[2] : null;
}
async function cached(key, ttl, fn) {
  const c = caches.default, k = new Request("https://cache.azs-monitor/" + encodeURIComponent(key)), hit = await c.match(k);
  if (hit) return hit.json();
  const v = await fn(); await c.put(k, new Response(JSON.stringify(v), { headers: { "cache-control": `max-age=${ttl}` } })); return v;
}
const drop = key => caches.default.delete(new Request("https://cache.azs-monitor/" + encodeURIComponent(key)));
async function sheetRows(env, name) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`, { redirect: "follow" });
  const t = await r.text(); if (!r.ok || /^\s*<!doctype|<html/i.test(t)) throw new Error(`лист «${name}»: таблица не открылась (доступ по ссылке?)`);
  return parseCsv(t);
}
// проверки ОСК теперь только из бланков станций; в общей таблице сети — справочники (станции, настройки, находки)
const FROM_BLANKS = ["Наблюдения", "Грубые нарушения", "Тайный покупатель"];
const loadSheet = env => cached("sheet2:" + env.SHEET_ID, TTL, async () => { const out = Object.fromEntries(FROM_BLANKS.map(n => [n, []])); for (const n of SHEETS.filter(n => !FROM_BLANKS.includes(n))) { try { out[n] = await sheetRows(env, n); } catch (e) { out[n] = []; out._err = (out._err || []).concat(String(e.message)); } } return out; });
async function reviewToken(env, fresh = false) {
  const k = "token:" + env.REVIEW_LOGIN; if (!fresh) { const hit = await caches.default.match(new Request("https://cache.azs-monitor/" + encodeURIComponent(k))); if (hit) return (await hit.json()).t; }
  const r = await fetch(env.REVIEW_API + "/api/v1/admin/login", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username: env.REVIEW_LOGIN, password: env.REVIEW_PASSWORD }) });
  if (!r.ok) throw new Error(r.status === 401 ? "админка отзывов: неверный логин или пароль" : `админка отзывов: вход ${r.status}`);
  const t = (await r.json()).access_token; if (!t) throw new Error("админка отзывов: нет токена");
  await caches.default.put(new Request("https://cache.azs-monitor/" + encodeURIComponent(k)), new Response(JSON.stringify({ t }), { headers: { "cache-control": "max-age=3000" } })); return t;
}
async function reviewGet(env, path) {
  let t = await reviewToken(env), r = await fetch(env.REVIEW_API + path, { headers: { authorization: "Bearer " + t } });
  if (r.status === 401) { t = await reviewToken(env, true); r = await fetch(env.REVIEW_API + path, { headers: { authorization: "Bearer " + t } }); }
  if (!r.ok) throw new Error(`админка отзывов: ${r.status}`); return r.json();
}
const loadReviews = env => cached("reviews:v3", TTL, async () => {
  if (!env.REVIEW_LOGIN || !env.REVIEW_PASSWORD) return { list: [], err: "админка отзывов не подключена" };
  /* до 500 последних; админка может отдать страницу больше или повторить ту же — берём по id без повторов */
  const list = [], seen = new Set(); let total = null;
  for (let page = 1; page <= 10 && list.length < 500; page++) {
    const d = await reviewGet(env, `/api/v1/admin/reviews?page=${page}&limit=100`), items = Array.isArray(d.data) ? d.data : []; total = d.pagination?.total_count ?? total;
    let fresh = 0; for (const x of items) { const id = String(x.id ?? ""); if (!id || seen.has(id)) continue; seen.add(id); list.push(fromApi(x)); fresh++; }
    if (!fresh || items.length < 100) break;
  }
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { list: list.slice(0, 500), total };
});
/* загруженные бланки: KV up:<станция>:<месяц>, оглавление up:index [{ key, station, month, by, at, file, counts }] */
const idx = async env => (await env.AZS.get("up:index", "json")) || [];
const loadUploads = env => cached("uploads", TTL, async () => { const list = await idx(env); return (await Promise.all(list.map(x => env.AZS.get(x.key, "json")))).filter(Boolean); });
const S = v => String(v ?? "").slice(0, 300);
const cleanRows = (rows, max) => (Array.isArray(rows) ? rows : []).slice(0, max).map(r => Object.fromEntries(Object.entries(r && typeof r === "object" ? r : {}).slice(0, 40).map(([k, v]) => [S(k).slice(0, 60), S(v)])));

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;
    if (JS[p]) return new Response(JS[p], { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    if (p === "/login" && req.method === "POST") {
      const f = await req.formData().catch(() => null), pass = String(f?.get("password") || "");
      await new Promise(r => setTimeout(r, 400)); /* перебор паролей — медленнее */
      const role = env.MONITOR_PASS && same(pass, env.MONITOR_PASS) ? "boss" : env.OSK_PASS && same(pass, env.OSK_PASS) ? "osk" : null;
      if (!role) return Response.redirect(url.origin + "/?e=1", 303);
      const exp = Date.now() + 30 * 864e5, sig = await hmac(env.MONITOR_PASS, `monitor.${exp}.${role}`);
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `m=${exp}.${role}.${sig}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (p === "/logout") return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "m=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    if (p === "/api/health") {
      const out = { pass: !!env.MONITOR_PASS, osk: !!env.OSK_PASS, sheet: !!env.SHEET_ID, reviews: !!(env.REVIEW_LOGIN && env.REVIEW_PASSWORD), kv: !!env.AZS };
      if (env.SHEET_ID) { try { const s = await loadSheet(env); out.sheetRows = Object.fromEntries(SHEETS.map(n => [n, (s[n] || []).length])); out.sheetErr = (s._err || []).length; } catch { out.sheetErr = 1; } }
      if (out.reviews) { try { const r = await loadReviews(env); out.reviewCount = r.list.length; } catch (e) { out.reviewErr = String(e.message).slice(0, 80); } }
      if (env.AZS) out.uploads = (await idx(env)).length;
      return json(out);
    }
    const role = await roleOf(req, env);
    if (p.startsWith("/api/") && !role) return json({ error: "auth" }, 401);
    /* сырые данные — считает браузер */
    if (p === "/api/data") {
      const errors = []; let sheet = {}, rv = { list: [] }, uploads = [];
      if (env.SHEET_ID) { try { sheet = await loadSheet(env); errors.push(...(sheet._err || [])); } catch (e) { errors.push(String(e.message)); } } else errors.push("таблица ОСК не подключена");
      try { rv = await loadReviews(env); if (rv.err) errors.push(rv.err); } catch (e) { errors.push(String(e.message)); }
      try { uploads = env.AZS ? await loadUploads(env) : []; } catch (e) { errors.push("бланки: " + String(e.message).slice(0, 80)); }
      const { _err, ...sh } = sheet;
      return json({ sheet: sh, reviews: rv.list, uploads, uploadIndex: env.AZS ? await idx(env) : [], links: env.AZS ? (await env.AZS.get("links", "json")) || [] : [], errors, role, today: todayMsk(), at: Date.now() });
    }
    /* бланк станции: разобран в браузере, здесь — проверка и запись; та же станция и месяц — заменяется */
    if (p === "/api/upload" && req.method === "POST") {
      const b = await req.json().catch(() => null); if (!b) return json({ error: "пустой запрос" }, 400);
      const station = S(b.station).slice(0, 10), month = S(b.month).slice(0, 7);
      if (!/^А-\d{1,3}$/.test(station) || !/^\d{4}-\d{2}$/.test(month)) return json({ error: "в бланке нет кода станции или месяца" }, 400);
      const doc = { station, month, checker: S(b.checker).slice(0, 80), manager: S(b.manager).slice(0, 120), file: S(b.file).slice(0, 160), link: /^https:\/\/docs\.google\.com\//.test(b.link || "") ? S(b.link) : "", by: role, at: Date.now(),
        obs: cleanRows(b.obs, 3000), gross: cleanRows(b.gross, 500), shop: cleanRows(b.shop, 20), hash: S(b.hash).slice(0, 40), auto: !!b.auto,
        settings: b.settings && typeof b.settings === "object" ? Object.fromEntries(["norm", "feedback", "training", "gross", "sumFeedback", "sumTraining", "sumMax", "managerShare", "bonusPct", "bonusShare", "bonusMaxGross", "bonusCap"].map(k => [k, Number.isFinite(+b.settings[k]) && b.settings[k] !== null ? +b.settings[k] : null])) : null,
        fundOpen: Number.isFinite(+b.fundOpen) && b.fundOpen !== null ? Math.round(+b.fundOpen) : null,
        operators: (Array.isArray(b.operators) ? b.operators : []).slice(0, 30).map(x => S(x).slice(0, 80)).filter(Boolean) };
      const key = `up:${station}:${month}`, list = (await idx(env)).filter(x => x.key !== key);
      list.push({ key, station, month, file: doc.file, link: doc.link, by: role, at: doc.at, checker: doc.checker, obs: doc.obs.length, gross: doc.gross.length, shop: doc.shop.length, hash: doc.hash, auto: doc.auto });
      await env.AZS.put(key, JSON.stringify(doc)); await env.AZS.put("up:index", JSON.stringify(list));
      /* ссылка на Google-таблицу станции — в список автообновления (одна ссылка — одна строка; станция берётся из последнего чтения) */
      if (doc.link) { const L = ((await env.AZS.get("links", "json")) || []).filter(x => x.link !== doc.link); L.push({ link: doc.link, station, at: doc.at }); await env.AZS.put("links", JSON.stringify(L)); }
      await drop("uploads");
      return json({ ok: true, key });
    }
    if (p === "/api/upload" && req.method === "DELETE") {
      const key = String(url.searchParams.get("key") || ""); if (!/^up:А-\d{1,3}:\d{4}-\d{2}$/.test(key)) return json({ error: "нет такого бланка" }, 400);
      await env.AZS.delete(key); await env.AZS.put("up:index", JSON.stringify((await idx(env)).filter(x => x.key !== key))); await drop("uploads");
      return json({ ok: true });
    }
    /* Google-таблица станции по ссылке → файл Excel (браузер сам не может скачать её из-за правил Google).
       Для автообновления — запас на 50 минут: сколько бы экранов ни было открыто, Google спрашиваем раз в час; fresh=1 — сразу */
    if (p === "/api/gsheet") {
      const id = /\/spreadsheets\/d\/([\w-]{20,})/.exec(String(url.searchParams.get("link") || ""))?.[1]; if (!id) return json({ error: "это не ссылка на Google Таблицу" }, 400);
      const ck = new Request("https://cache.azs-monitor/gsheet/" + id), fresh = url.searchParams.get("fresh") === "1";
      if (!fresh) { const hit = await caches.default.match(ck); if (hit) return new Response(hit.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-from": "cache" } }); }
      const r = await fetch(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, { redirect: "follow" }), ct = r.headers.get("content-type") || "";
      if (!r.ok || /html/i.test(ct)) return json({ error: "таблица не открылась: в Google — «Настройки доступа» → «Все, у кого есть ссылка» → «Читатель»" }, 400);
      const buf = await r.arrayBuffer(); if (buf.byteLength > 15e6) return json({ error: "файл больше 15 МБ" }, 413);
      ctx.waitUntil(caches.default.put(ck, new Response(buf, { headers: { "cache-control": "max-age=3000" } })));
      return new Response(buf, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store" } });
    }
    /* ⬇ пустой бланк станции (Excel с уже вписанным кодом станции): KV tpl:<станция> */
    if (p === "/api/template") {
      const st = String(url.searchParams.get("st") || ""); if (!/^А-\d{1,3}$/.test(st)) return json({ error: "нет такой станции" }, 400);
      const buf = await env.AZS.get("tpl:" + st, "arrayBuffer"); if (!buf) return json({ error: "бланка для этой станции нет" }, 404);
      return new Response(buf, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("Бланк ОСК " + st + ".xlsx")}`, "cache-control": "no-store" } });
    }
    /* подключить таблицу станции заранее (бланк ещё пустой): ссылка — в автообновление, данные появятся, когда её заполнят */
    if (p === "/api/link" && req.method === "POST") {
      const b = await req.json().catch(() => ({})), link = String(b.link || ""), station = String(b.station || "");
      if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]{20,}/.test(link) || !/^А-\d{1,3}$/.test(station)) return json({ error: "нужны ссылка на Google-таблицу и код станции" }, 400);
      const L = ((await env.AZS.get("links", "json")) || []).filter(x => x.link !== link); L.push({ link, station, at: Date.now(), empty: true }); await env.AZS.put("links", JSON.stringify(L)); return json({ ok: true });
    }
    if (p === "/api/link" && req.method === "DELETE") {
      const link = String(url.searchParams.get("link") || ""); await env.AZS.put("links", JSON.stringify(((await env.AZS.get("links", "json")) || []).filter(x => x.link !== link))); return json({ ok: true });
    }
    if (p === "/" || p === "/index.html") return new Response(PAGE.replace("__AUTH__", role || "").replace("__ERR__", url.searchParams.get("e") ? "1" : "0"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" } });
    return new Response("Не найдено", { status: 404 });
  },
};
