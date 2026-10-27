// Мониторинг АЗС: экран для руководства — проверки ОСК (Google Таблица) и отзывы посетителей (админка отзывов) на одном экране.
// Своей базы нет: данные берутся из таблицы и админки и держатся в кеше Cloudflare 2 минуты. Вход — по паролю (MONITOR_PASS), cookie на 30 дней.
import { build, parseCsv, fromApi } from "./calc.js";
import PAGE from "./page.html";

const SHEETS = ["Станции", "Операторы", "Наблюдения", "Грубые нарушения", "Тайный покупатель", "Пункты ТП", "Находки ОСК и ОСБ", "Настройки"];
const TTL = 120, enc = new TextEncoder();
const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...h } });
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function hmac(key, msg) { const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return hex(await crypto.subtle.sign("HMAC", k, enc.encode(msg))); }
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
const todayMsk = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

/* вход: cookie m=<срок>.<подпись> */
async function authed(req, env) {
  if (!env.MONITOR_PASS) return false;
  const m = /(?:^|;\s*)m=(\d+)\.([0-9a-f]{64})/.exec(req.headers.get("cookie") || ""); if (!m || +m[1] < Date.now()) return false;
  return same(m[2], await hmac(env.MONITOR_PASS, "monitor." + m[1]));
}
/* кеш Cloudflare: ключ → JSON на TTL секунд */
async function cached(key, ttl, fn) {
  const c = caches.default, k = new Request("https://cache.azs-monitor/" + encodeURIComponent(key)), hit = await c.match(k);
  if (hit) return hit.json();
  const v = await fn(); await c.put(k, new Response(JSON.stringify(v), { headers: { "cache-control": `max-age=${ttl}` } })); return v;
}
/* лист Google Таблицы как CSV (таблица открыта по ссылке на чтение) */
async function sheetRows(env, name) {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(name)}`, { redirect: "follow" });
  const t = await r.text(); if (!r.ok || /^\s*<!doctype|<html/i.test(t)) throw new Error(`лист «${name}»: таблица не открылась (доступ по ссылке?)`);
  return parseCsv(t);
}
const loadSheet = env => cached("sheet:" + env.SHEET_ID, TTL, async () => { const out = {}; for (const n of SHEETS) { try { out[n] = await sheetRows(env, n); } catch (e) { out[n] = []; out._err = (out._err || []).concat(String(e.message)); } } return out; });
/* админка отзывов: вход (токен — в кеше на 50 минут), последние 500 отзывов */
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
const loadReviews = env => cached("reviews:v2", TTL, async () => {
  if (!env.REVIEW_LOGIN || !env.REVIEW_PASSWORD) return { list: [], err: "админка отзывов не подключена" };
  /* до 500 последних; админка может отдать страницу больше или повторить ту же — берём по id без повторов, пустая/повторная страница — конец */
  const list = [], seen = new Set(); let total = null;
  for (let page = 1; page <= 10 && list.length < 500; page++) {
    const d = await reviewGet(env, `/api/v1/admin/reviews?page=${page}&limit=100`), items = Array.isArray(d.data) ? d.data : []; total = d.pagination?.total_count ?? total;
    let fresh = 0; for (const x of items) { const id = String(x.id ?? ""); if (!id || seen.has(id)) continue; seen.add(id); list.push(fromApi(x)); fresh++; }
    if (!fresh || items.length < 100) break;
  }
  list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { list: list.slice(0, 500), total };
});

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), p = url.pathname;
    if (p === "/login" && req.method === "POST") {
      const f = await req.formData().catch(() => null), pass = String(f?.get("password") || "");
      await new Promise(r => setTimeout(r, 400)); /* перебор паролей — медленнее */
      if (!env.MONITOR_PASS || !same(pass, env.MONITOR_PASS)) return Response.redirect(url.origin + "/?e=1", 303);
      const exp = Date.now() + 30 * 864e5, sig = await hmac(env.MONITOR_PASS, "monitor." + exp);
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": `m=${exp}.${sig}; Path=/; Max-Age=${30 * 86400}; HttpOnly; Secure; SameSite=Lax` } });
    }
    if (p === "/logout") return new Response(null, { status: 303, headers: { location: "/", "set-cookie": "m=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax" } });
    /* проверка подключения — без данных, только «есть / нет» и числа */
    if (p === "/api/health") {
      const out = { pass: !!env.MONITOR_PASS, sheet: !!env.SHEET_ID, reviews: !!(env.REVIEW_LOGIN && env.REVIEW_PASSWORD) };
      if (env.SHEET_ID) { try { const s = await loadSheet(env); out.sheetRows = Object.fromEntries(SHEETS.map(n => [n, (s[n] || []).length])); out.sheetErr = (s._err || []).length; } catch { out.sheetErr = 1; } }
      if (out.reviews) { try { const r = await loadReviews(env); out.reviewCount = r.list.length; out.reviewTotal = r.total ?? null; } catch (e) { out.reviewErr = String(e.message).slice(0, 80); } }
      return json(out);
    }
    const ok = await authed(req, env);
    if (p === "/api/data") {
      if (!ok) return json({ error: "auth" }, 401);
      const errs = []; let sheet = {}, rv = { list: [] };
      if (env.SHEET_ID) { try { sheet = await loadSheet(env); errs.push(...(sheet._err || [])); } catch (e) { errs.push(String(e.message)); } } else errs.push("таблица ОСК не подключена");
      try { rv = await loadReviews(env); if (rv.err) errs.push(rv.err); } catch (e) { errs.push(String(e.message)); }
      const today = todayMsk(), month = /^\d{4}-\d{2}$/.test(url.searchParams.get("m") || "") ? url.searchParams.get("m") : today.slice(0, 7);
      return json({ ...build(sheet, rv.list, { month, today }), errors: errs, at: Date.now() });
    }
    if (p === "/" || p === "/index.html") return new Response(PAGE.replace("__AUTH__", ok ? "1" : "0").replace("__ERR__", url.searchParams.get("e") ? "1" : "0"), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" } });
    return new Response("Не найдено", { status: 404 });
  },
};
