// Серверная часть: разбор CSV из Google Таблицы и отзывов из админки (расчёты — в браузере, src/client/calc.mjs)
export function parseCsv(text) {
  const rows = [], s = String(text || "").replace(/^﻿/, ""); let row = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  const head = (rows.shift() || []).map(h => h.trim());
  return rows.filter(r => r.some(x => String(x).trim())).map(r => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? "").trim()])));
}
const tOf = s => Date.parse(String(s || "").replace(" ", "T").replace(/(\.\d{3})\d+/, "$1") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || "")) ? "" : "Z"));
const msk = s => { const t = tOf(s); return Number.isFinite(t) ? new Date(t + 3 * 3600e3).toISOString() : ""; };
/* отзыв из админки → наш вид (телефоны и ники клиентов не берём; время — по Москве) */
export const fromApi = r => ({ id: String(r.id ?? ""), date: msk(r.created_at).slice(0, 10), time: msk(r.created_at).slice(11, 16), at: String(r.created_at || ""), station_name: String(r.station_name || ""), rating: Number(r.rating) || 0, text: String(r.review_text || "").slice(0, 1500), source: String(r.source || ""), author: /^(2gis|yandex|google)$/.test(r.source) ? String(r.author_name || r.full_name || "").slice(0, 40) : String(r.full_name || "").split(/\s+/)[0].slice(0, 30) });
