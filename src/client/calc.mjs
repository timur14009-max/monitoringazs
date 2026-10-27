// Расчёты мониторинга АЗС — чистые функции (без сети): разбор листов таблицы «ОСК — сеть», показатели станций и операторов, отзывы.
// Формулы — как в бланке ОСК: процент смены = среднее процентов 7 пунктов (по каждому пункту выполнено / применимо, н/п не считается,
// пункт без применимых — пропускается), за месяц — среднее смен,
// взыскание — по шкале от среднего + за каждое грубое нарушение, штраф управляющего — доля от взысканий операторов станции.
import { REVIEW_MAP, STATION_NAMES } from "./map.mjs";
export const ITEMS = ["Поприветствовал", "Уточнил заказ", "Уточнил способ оплаты", "Спросил про карту лояльности", "Предложил оформить карту", "Озвучил сумму и сдачу", "Попрощался"];

/* CSV (как отдаёт Google: кавычки, переводы строк внутри) → массив объектов по заголовкам */
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
/* дата из таблицы: 07.10.2026 · 2026-10-07 · 10/7/2026 (американский вид Google) → «2026-10-07» */
export function isoDate(v) {
  const s = String(v || "").trim(); let m;
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}
const mark = v => { const s = String(v ?? "").trim().toLowerCase().replace(",", "."); if (!s || /^н\/?п$|^нп$|^n\/?a$/.test(s)) return null; const n = Number(s); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null; };
const yes = v => /^(да|yes|1|true|исправлено|✓|\+)$/i.test(String(v || "").trim());
const num = (v, d) => { const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : d; };

/* «Настройки» → параметры шкалы (по порядку строк листа; пусто — значения бланка) */
export function settings(rows) {
  const v = (rows || []).map(r => num(r["Значение"], NaN)), g = (i, d) => Number.isFinite(v[i]) ? v[i] : d;
  return { norm: g(0, 85), feedback: g(1, 70), training: g(2, 50), sumFeedback: g(3, 1500), sumTraining: g(4, 4500), sumMax: g(5, 9000), gross: g(6, 200), managerShare: g(7, 50) / 100 };
}
export function measure(pct, S) {
  if (pct == null) return { name: "нет проверок", sum: 0, level: "none" };
  if (pct >= S.norm) return { name: "Норма", sum: 0, level: "ok" };
  if (pct >= S.feedback) return { name: "Обратная связь", sum: S.sumFeedback, level: "warn" };
  if (pct >= S.training) return { name: "Обучение", sum: S.sumTraining, level: "bad" };
  return { name: "Максимальное взыскание", sum: S.sumMax, level: "bad" };
}
const pctOf = (done, appl) => appl ? done / appl * 100 : null;
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

/* загруженные бланки станций (up: { station, month, checker, manager, obs, gross, shop }) поверх таблицы:
   за станцию и месяц из бланка строки таблицы не берём (иначе одна проверка посчитается дважды) */
export function mergeUploads(sheet, uploads) {
  const S = { ...sheet }, cover = new Set((uploads || []).map(u => u.station + "|" + u.month));
  const keep = (rows, dk) => (rows || []).filter(r => !cover.has(r["Станция"] + "|" + isoDate(r[dk]).slice(0, 7)));
  S["Наблюдения"] = [...keep(sheet["Наблюдения"], "Дата записи"), ...(uploads || []).flatMap(u => u.obs || [])];
  S["Грубые нарушения"] = [...keep(sheet["Грубые нарушения"], "Дата"), ...(uploads || []).flatMap(u => u.gross || [])];
  S["Тайный покупатель"] = [...keep(sheet["Тайный покупатель"], "Дата"), ...(uploads || []).flatMap(u => u.shop || [])];
  /* станция из бланка, которой нет в листе «Станции», — добавляется */
  const known = new Set((sheet["Станции"] || []).map(s => s["Станция"]));
  const extra = [...new Set((uploads || []).map(u => u.station))].filter(c => c && !known.has(c)).map(c => ({ "Станция": c, "Тип": "АЗС", "Работает": "да" }));
  S["Станции"] = [...(sheet["Станции"] || []), ...extra].map(s => { const u = (uploads || []).filter(x => x.station === s["Станция"]).sort((a, b) => b.month.localeCompare(a.month))[0]; return u && u.manager && !s["Управляющий"] ? { ...s, "Управляющий": u.manager } : s; });
  return S;
}
/* код станции: «A2», «а-2 », «А 2» → «А-2» */
export const stationCode = v => { const m = /(?:^|[^A-Za-zА-Яа-яЁё])[AaАа]\s*-?\s*(\d{1,3})(?!\d)/.exec(" " + String(v || "")); return m ? "А-" + m[1] : ""; }; /* «АЗС А-3 (пример)», «a2», «А 2» */

/* всё по одному месяцу («2026-10») из листов таблицы и отзывов */
export function build(sheet, reviews, { month, today }) {
  const S = settings(sheet["Настройки"]), inM = d => d && d.slice(0, 7) === month;
  const stations = (sheet["Станции"] || []).filter(s => s["Станция"] && !/^нет$/i.test(s["Работает"] || "")).map(s => ({ code: s["Станция"], type: s["Тип"] || "АЗС", name: s["Адрес / название"] || "", manager: s["Управляющий"] || "", reviewName: s["Название в отзывах"] || "" }));
  /* станции, известные только по отзывам (их нет в листе ОСК, например А-5, А-24), — тоже плитки: отзывы есть, проверок нет */
  for (const code of new Set([...REVIEW_MAP.map(x => x[1]), ...Object.keys(STATION_NAMES)])) if (!stations.some(s => s.code === code)) stations.push({ code, type: "АЗС", name: "", manager: "", reviewName: "" });
  for (const s of stations) if (!s.name && STATION_NAMES[s.code]) s.name = STATION_NAMES[s.code];
  stations.sort((a, b) => (parseInt(a.code.replace(/\D/g, "")) || 999) - (parseInt(b.code.replace(/\D/g, "")) || 999));
  const byCode = new Map(stations.map(s => [s.code, s]));
  const st = code => byCode.get(code) || null;
  /* наблюдения: оператор → смена → суммы по пунктам */
  const ops = new Map(), items = new Map();
  for (const r of sheet["Наблюдения"] || []) {
    const d = isoDate(r["Дата записи"]), code = r["Станция"]; if (!inM(d) || !st(code)) continue;
    const key = code + "|" + (r["Оператор"] || "?"), sh = String(r["Смена"] || "1").trim();
    if (!ops.has(key)) ops.set(key, { station: code, name: r["Оператор"] || "?", shifts: new Map(), gross: 0, dates: new Set() });
    const o = ops.get(key); if (!o.shifts.has(sh)) o.shifts.set(sh, { done: ITEMS.map(() => 0), appl: ITEMS.map(() => 0), date: d }); const x = o.shifts.get(sh); o.dates.add(d);
    ITEMS.forEach((it, i) => { const m = mark(r[it]); if (m == null) return; x.done[i] += m; x.appl[i] += 1; const k = code + "|" + i; const t = items.get(k) || { done: 0, appl: 0 }; t.done += m; t.appl += 1; items.set(k, t); });
  }
  const gross = [];
  for (const r of sheet["Грубые нарушения"] || []) { const d = isoDate(r["Дата"]), code = r["Станция"]; if (!inM(d) || !st(code)) continue; gross.push({ date: d, station: code, operator: r["Оператор"] || "", what: r["Нарушение"] || "", time: r["Тайм-код"] || "" }); const o = ops.get(code + "|" + (r["Оператор"] || "?")); if (o) o.gross++; else ops.set(code + "|" + (r["Оператор"] || "?"), { station: code, name: r["Оператор"] || "?", shifts: new Map(), gross: 1, dates: new Set() }); }
  const shiftPct = x => avg(x.done.map((d, i) => pctOf(d, x.appl[i])).filter(v => v != null));
  const operators = [...ops.values()].map(o => { const sh = [...o.shifts.values()].map(shiftPct).filter(x => x != null), p = avg(sh), m = measure(p == null ? null : Math.round(p), S);
    return { station: o.station, name: o.name, shifts: sh.length, pct: p == null ? null : Math.round(p), gross: o.gross, measure: m.name, level: m.level, fine: m.sum + o.gross * S.gross }; }).sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  /* тайный покупатель: % визита = сумма / число применимых пунктов */
  const crit = (sheet["Пункты ТП"] || []).map(c => ({ id: c["Пункт"], section: c["Раздел"] }));
  const shop = (sheet["Тайный покупатель"] || []).map(r => { const d = isoDate(r["Дата"]); const vals = crit.map(c => ({ ...c, v: mark(r[c.id]) })).filter(x => x.v != null);
    return { date: d, station: r["Станция"], pct: vals.length ? Math.round(vals.reduce((a, x) => a + x.v, 0) / vals.length * 100) : null, sections: [...new Set(crit.map(c => c.section))].map(s => { const v = vals.filter(x => x.section === s); return { section: s, pct: v.length ? Math.round(v.reduce((a, x) => a + x.v, 0) / v.length * 100) : null }; }), note: r["Заметки"] || "" }; }).filter(x => inM(x.date) && st(x.station));
  /* находки ОСК и ОСБ: открытые — за все месяцы (висят, пока не исправят), за месяц — найдено */
  const finds = (sheet["Находки ОСК и ОСБ"] || []).map(r => ({ date: isoDate(r["Дата"]), who: r["Кто нашёл"] || "", station: r["Станция"], what: r["Что случилось"] || "", to: r["Кому передали"] || "", due: isoDate(r["Срок"]), fixed: yes(r["Исправлено"]) })).filter(x => st(x.station) && x.date);
  /* отзывы → станция по «Названию в отзывах» (точно или вхождением) */
  const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const match = name => { const n = norm(name); if (!n) return null; for (const s of stations) { const r = norm(s.reviewName); if (r && (n === r || n.includes(r) || r.includes(n))) return s.code; }
    for (const [addr, code] of REVIEW_MAP) if (n.includes(norm(addr))) return code; return null; };
  const rv = (reviews || []).map(r => ({ id: r.id, date: r.date, time: r.time || "", station: match(r.station_name), stationName: r.station_name || "", rating: r.rating, text: r.text || "", source: r.source || "", author: r.author || "" }));
  const rvM = rv.filter(r => inM(r.date));
  const unmatched = [...new Set(rv.filter(r => !r.station && r.stationName).map(r => r.stationName))];
  /* специалист ОСК станции: колонка «Специалист ОСК» листа «Станции», иначе — кто проверял её чаще в этом месяце (или последним) */
  const checkers = new Map(); for (const r of sheet["Наблюдения"] || []) { const d = isoDate(r["Дата записи"]), c = r["Станция"], w = String(r["Проверяющий"] || "").trim(); if (!w || !st(c)) continue; const k = c, m = checkers.get(k) || new Map(); const x = m.get(w) || { n: 0, last: "", inM: 0 }; x.n++; if (d > x.last) x.last = d; if (inM(d)) x.inM++; m.set(w, x); checkers.set(k, m); }
  const oskOf = code => { const set = (sheet["Станции"] || []).find(s => s["Станция"] === code)?.["Специалист ОСК"]; if (set) return set.trim(); const m = checkers.get(code); if (!m) return ""; return [...m.entries()].sort((a, b) => b[1].inM - a[1].inM || b[1].last.localeCompare(a[1].last))[0][0]; };
  const card = s => {
    const op = operators.filter(o => o.station === s.code), ps = op.map(o => o.pct).filter(x => x != null), pct = ps.length ? Math.round(avg(ps)) : null;
    const fines = op.reduce((a, o) => a + o.fine, 0), g = gross.filter(x => x.station === s.code).length;
    const it = ITEMS.map((name, i) => { const t = items.get(s.code + "|" + i); return { name, pct: t && t.appl ? Math.round(t.done / t.appl * 100) : null }; });
    const weak = it.filter(x => x.pct != null).sort((a, b) => a.pct - b.pct)[0] || null;
    const sh = shop.filter(x => x.station === s.code).sort((a, b) => b.date.localeCompare(a.date));
    const open = finds.filter(f => f.station === s.code && !f.fixed), overdue = open.filter(f => f.due && f.due < today);
    const rs = rvM.filter(r => r.station === s.code), rating = rs.length ? Math.round(avg(rs.map(r => r.rating)) * 10) / 10 : null, bad = rs.filter(r => r.rating <= 2).length;
    /* светофор: худшее из стандарта, отзывов и просроченных находок */
    const lv = [pct == null ? 0 : pct >= S.norm ? 1 : pct >= S.feedback ? 2 : 3, rating == null ? 0 : rating >= 4.5 ? 1 : rating >= 4 ? 2 : 3, overdue.length ? 3 : open.length ? 2 : 0, g ? 2 : 0];
    const light = ["none", "green", "yellow", "red"][Math.max(...lv)];
    return { ...s, osk: oskOf(s.code), pct, operators: op, fines, managerFine: Math.round(fines * S.managerShare), gross: g, items: it, weak, shop: sh, shopPct: sh[0]?.pct ?? null, open: open.length, overdue: overdue.length, finds: finds.filter(f => f.station === s.code).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30), rating, reviews: rs.length, bad, light };
  };
  const cards = stations.map(card);
  /* специалисты ОСК: за кем какие станции, сколько смен проверено за месяц, средний результат их станций */
  const spec = new Map(); for (const c of cards) if (c.osk) { const x = spec.get(c.osk) || { name: c.osk, stations: [], shifts: 0, pcts: [] }; x.stations.push(c.code); x.shifts += c.operators.reduce((a, o) => a + o.shifts, 0); if (c.pct != null) x.pcts.push(c.pct); spec.set(c.osk, x); }
  const specialists = [...spec.values()].map(x => ({ name: x.name, stations: x.stations, shifts: x.shifts, pct: x.pcts.length ? Math.round(avg(x.pcts)) : null, unchecked: x.stations.filter(code => !cards.find(c => c.code === code).pct && cards.find(c => c.code === code).pct !== 0) }));
  /* для графиков: отзывы по месяцам (12 последних), оценки 1–5 и источники за месяц, станции по отзывам (код или адрес), пункты стандарта по сети */
  const short = n => String(n || "").replace(/^(АЗС|ЭЗС):\s*/, "").replace(/^г\.\s*Махачкала,\s*/, "").replace(/\s*—.*$/, "").trim() || "Станция не указана";
  const months12 = [...Array(12)].map((_, i) => { const d = new Date(Date.parse(month + "-15T00:00:00Z")); d.setUTCMonth(d.getUTCMonth() - 11 + i); return d.toISOString().slice(0, 7); });
  const byMonth = months12.map(m => { const l = rv.filter(r => (r.date || "").slice(0, 7) === m); return { m, n: l.length, bad: l.filter(r => r.rating <= 2).length, avg: l.length ? Math.round(avg(l.map(r => r.rating)) * 100) / 100 : null }; });
  const dist = [5, 4, 3, 2, 1].map(k => ({ stars: k, n: rvM.filter(r => Math.round(r.rating) === k).length }));
  const SRC = ["telegram", "2gis", "yandex", "google"], bySource = SRC.map(k => ({ source: k, n: rvM.filter(r => r.source === k).length })).concat([{ source: "other", n: rvM.filter(r => !SRC.includes(r.source)).length }]).filter(x => x.n);
  const places = new Map(); for (const r of rvM) { const k = r.station || short(r.stationName), x = places.get(k) || { name: k, code: r.station || null, sum: 0, n: 0, bad: 0 }; x.sum += r.rating; x.n++; if (r.rating <= 2) x.bad++; places.set(k, x); }
  const byPlace = [...places.values()].map(x => ({ name: x.name, code: x.code, n: x.n, bad: x.bad, avg: Math.round(x.sum / x.n * 10) / 10 })).sort((a, b) => a.avg - b.avg || b.n - a.n);
  const netItems = ITEMS.map((name, i) => { let d = 0, a = 0; for (const s of stations) { const t = items.get(s.code + "|" + i); if (t) { d += t.done; a += t.appl; } } return { name, pct: a ? Math.round(d / a * 100) : null }; });
  const allP = cards.map(c => c.pct).filter(x => x != null), allR = rvM.map(r => r.rating);
  return {
    month, settings: S, stations: cards,
    net: { pct: allP.length ? Math.round(avg(allP)) : null, checked: allP.length, rating: allR.length ? Math.round(avg(allR) * 10) / 10 : null, reviews: allR.length, bad: rvM.filter(r => r.rating <= 2).length, badToday: rv.filter(r => r.date === today && r.rating <= 2).length, gross: gross.length, fines: cards.reduce((a, c) => a + c.fines, 0), open: cards.reduce((a, c) => a + c.open, 0), overdue: cards.reduce((a, c) => a + c.overdue, 0) },
    reviews: rv.slice(0, 500), unmatched, specialists, charts: { byMonth, dist, bySource, byPlace, netItems },
    months: [...new Set([...(sheet["Наблюдения"] || []).map(r => isoDate(r["Дата записи"]).slice(0, 7)), ...rv.map(r => (r.date || "").slice(0, 7))].filter(Boolean))].sort().reverse(),
  };
}
/* отзыв из админки отзывов → наш вид (телефоны и ники клиентов не берём) */
export const fromApi = r => ({ id: String(r.id ?? ""), date: mskDate(r.created_at), time: mskTime(r.created_at), at: String(r.created_at || ""), station_name: String(r.station_name || ""), rating: Number(r.rating) || 0, text: String(r.review_text || "").slice(0, 1500), source: String(r.source || ""), author: /^(2gis|yandex|google)$/.test(r.source) ? String(r.author_name || r.full_name || "").slice(0, 40) : String(r.full_name || "").split(/\s+/)[0].slice(0, 30) });
const tOf = s => Date.parse(String(s || "").replace(" ", "T").replace(/(\.\d{3})\d+/, "$1") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || "")) ? "" : "Z"));
export function mskTime(s) { const t = tOf(s); return Number.isFinite(t) ? new Date(t + 3 * 3600e3).toISOString().slice(11, 16) : ""; }
export function mskDate(s) { const t = Date.parse(String(s || "").replace(" ", "T").replace(/(\.\d{3})\d+/, "$1") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(s || "")) ? "" : "Z")); return Number.isFinite(t) ? new Date(t + 3 * 3600e3).toISOString().slice(0, 10) : ""; }
