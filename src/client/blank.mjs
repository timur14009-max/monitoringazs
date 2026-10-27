// Разбор бланка ОСК станции (Excel, один файл — одна станция за месяц) — в браузере, без сервера.
// Ищем по подписям, а не по номерам строк: версии бланка у станций разные. Результат — строки в колонках таблицы «ОСК — сеть».
import { ITEMS, stationCode } from "./calc.mjs";

/* xlsx — это zip: центральный каталог → нужные xml, распаковка штатным DecompressionStream */
async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf instanceof ArrayBuffer ? buf : u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
  let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("это не файл Excel (.xlsx)");
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
    const ds = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = u8.subarray(ds, ds + csize);
    out[name] = method === 0 ? dec.decode(raw) : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  }
  return out;
}
const unx = s => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
/* книга → { лист: { "строка|колонка": значение } } */
export async function readXlsx(buf) {
  const z = await unzip(buf), wb = z["xl/workbook.xml"] || "", rels = z["xl/_rels/workbook.xml.rels"] || "";
  const S = [...(z["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unx([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join("")));
  const tgt = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = /Id="([^"]+)"/.exec(m[0])?.[1], t = /Target="([^"]+)"/.exec(m[0])?.[1]; if (id && t) tgt[id] = t.replace(/^\/?(xl\/)?/, "xl/"); }
  const book = {};
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unx(/name="([^"]+)"/.exec(m[0])?.[1] || ""), rid = /r:id="([^"]+)"/.exec(m[0])?.[1], x = z[tgt[rid]]; if (!x) continue;
    const g = {}; for (const c of x.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, col, row, attr, inner = ""] = c, v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1], is = /<is>([\s\S]*?)<\/is>/.exec(inner)?.[1];
      const val = /t="s"/.test(attr) && v != null ? S[+v] : is != null ? unx(is.replace(/<[^>]+>/g, "")) : v != null ? unx(v) : null;
      if (val != null && String(val).trim() !== "") g[row + "|" + col] = String(val);
    }
    book[name] = g;
  }
  return book;
}
const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const rowsOf = g => [...new Set(Object.keys(g).map(k => +k.split("|")[0]))].sort((a, b) => a - b);
const at = (g, r, c) => String(g[r + "|" + c] ?? "").trim();
const rightOf = (g, r, c) => { for (let i = COLS.indexOf(c) + 1; i < COLS.length; i++) { const v = at(g, r, COLS[i]); if (v) return v; } return ""; };
const findLabel = (g, re) => { for (const k of Object.keys(g)) if (re.test(String(g[k]).trim())) { const [r, c] = k.split("|"); return { r: +r, c }; } return null; };
const xdate = v => { const s = String(v || "").trim(), m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) return `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${m[3]}`; const n = Number(s); if (Number.isFinite(n) && n > 30000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`; } return ""; };
const xtime = v => { const s = String(v || "").trim(); if (/^\d{1,2}:\d{2}/.test(s)) return s; const n = Number(s); if (Number.isFinite(n) && n > 0 && n < 1) { const t = Math.round(n * 86400); return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor(t % 3600 / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; } return s; };
const mk = v => { const s = String(v || "").trim().toLowerCase(); if (!s) return ""; if (/^н\/?п$/.test(s)) return "н/п"; if (/^(1|да|\+)$/.test(s)) return "1"; if (/^(0|нет|-)$/.test(s)) return "0"; if (/^(0[.,]5|частично)$/.test(s)) return "0.5"; return s; };
const ITEM_RE = [/^поприв/i, /^уточнил заказ/i, /^уточнил способ/i, /^спросил про карт/i, /^предложил оформ/i, /^озвучил/i, /^попрощ/i];

/* бланк → { station, month, checker, manager, operators, obs, gross, shop, warnings } */
export function parseBlank(book) {
  const W = [], names = Object.keys(book), ops = book[names.find(n => /^операторы/i.test(n))] || {};
  const lab = re => { const f = findLabel(ops, re); return f ? rightOf(ops, f.r, f.c) : ""; };
  const station = stationCode(lab(/^станция:?$/i)), checker = lab(/^проверяющ/i), manager = lab(/^управляющ/i);
  if (!station) W.push("не нашёл код станции на листе «Операторы» (строка «Станция:»)");
  const opNames = {}; const fio = findLabel(ops, /^фио оператора/i);
  if (fio) for (const r of rowsOf(ops).filter(r => r > fio.r)) { const n = +at(ops, r, "A"), nm = at(ops, r, fio.c); if (n >= 1 && n <= 30 && nm) opNames[n] = nm; }
  const obs = [], gross = [];
  for (const sn of names) {
    const m = /^оператор\s*(\d+)$/i.exec(sn.trim()); if (!m) continue; const g = book[sn], rows = rowsOf(g), opName = opNames[+m[1]] || "";
    if (!opName) { if (rows.some(r => /^\d+$/.test(at(g, r, "A")) && ["B", "C", "D"].some(c => at(g, r, c)))) W.push(`лист «${sn}»: есть отметки, но нет фамилии оператора на листе «Операторы»`); continue; }
    for (const r0 of rows) {
      const sm = /^смена\s*(\d)/i.exec(at(g, r0, "A")); if (!sm) continue;
      const dl = COLS.find(c => /^дата записи/i.test(at(g, r0, c))), date = xdate(dl ? rightOf(g, r0, dl) : ""), hr = rows.find(r => r > r0 && /^№/.test(at(g, r, "A"))); if (!hr) continue;
      const colOf = {}; for (const c of COLS) { const h = at(g, hr, c); ITEM_RE.forEach((re, i) => { if (re.test(h)) colOf[i] = c; }); if (/^тайм/i.test(h)) colOf.t = c; if (/^коммент/i.test(h)) colOf.k = c; }
      let any = false;
      for (const r of rows.filter(r => r > hr)) {
        const a = at(g, r, "A"); if (!/^\d+$/.test(a)) break;
        const marks = ITEMS.map((_, i) => mk(colOf[i] ? at(g, r, colOf[i]) : "")); if (!marks.some(Boolean)) continue;
        any = true; obs.push({ "Дата записи": date, "Станция": station, "Оператор": opName, "Смена": sm[1], "Проверяющий": checker, "№ клиента": a, ...Object.fromEntries(ITEMS.map((it, i) => [it, marks[i]])), "Тайм-код": colOf.t ? xtime(at(g, r, colOf.t)) : "", "Комментарий": colOf.k ? at(g, r, colOf.k) : "" });
      }
      if (any && !date) W.push(`${opName}, смена ${sm[1]}: нет даты записи — смена не попадёт ни в один месяц`);
    }
    /* грубые нарушения: «1», «2», «1,1,1» (так тоже пишут) — число случаев */
    const gh = rows.find(r => /^грубые нарушения/i.test(at(g, r, "A")));
    if (gh) { const hh = rows.find(r => r > gh && /^№/.test(at(g, r, "A"))), sc = {}; if (hh) for (const c of COLS) { const s = /^см\.?\s*(\d)/i.exec(at(g, hh, c)); if (s) sc[s[1]] = c; if (/^тайм/i.test(at(g, hh, c))) sc.t = c; }
      for (const r of rows.filter(r => r > (hh || gh))) { if (/^грубых нарушений/i.test(at(g, r, "A"))) break; const what = at(g, r, "B"); if (!what) continue;
        for (const k of ["1", "2", "3"]) { const v = sc[k] ? at(g, r, sc[k]) : ""; const cnt = (v.match(/\d+/g) || []).reduce((a, x) => a + +x, 0); /* «1,1,1» — три случая, а не 1,1 */ if (!cnt) continue;
          const d = obs.find(o => o["Оператор"] === opName && o["Смена"] === k)?.["Дата записи"] || "";
          for (let i = 0; i < cnt; i++) gross.push({ "Дата": d, "Станция": station, "Оператор": opName, "Смена": k, "Нарушение": what, "Тайм-код": sc.t ? xtime(at(g, r, sc.t)) : "", "Описание": "", "Проверяющий": checker }); } } }
  }
  /* тайный покупатель: строки с номером пункта, колонка «Оценка»; дата — «Дата и время:» */
  const shop = []; const tn = names.find(n => /тайного покупателя/i.test(n));
  if (tn) { const g = book[tn], rows = rowsOf(g), hd = rows.find(r => /^№$/.test(at(g, r, "A"))), oc = hd ? COLS.find(c => /^оценка/i.test(at(g, hd, c))) : null, dl = findLabel(g, /^дата и время/i), date = xdate(dl ? rightOf(g, dl.r, dl.c) : "");
    if (oc) { const row = { "Дата": date, "Станция": station, "Проверил": (() => { const f = findLabel(g, /^проверил/i); return f ? rightOf(g, f.r, f.c) : ""; })(), "Заметки": "" }; let n = 0;
      for (const r of rows.filter(r => r > hd)) { const k = at(g, r, "A"); if (!/^\d+$/.test(k)) continue; const v = mk(at(g, r, oc)); if (v) { row["П" + k] = v; n++; } }
      if (n) { if (!date) W.push("тайный покупатель: нет даты"); shop.push(row); } } }
  const months = {}; for (const o of obs) { const d = o["Дата записи"]; if (d) { const k = d.slice(6, 10) + "-" + d.slice(3, 5); months[k] = (months[k] || 0) + 1; } }
  const month = Object.entries(months).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  if (!obs.length) W.push("в бланке нет отметок по клиентам");
  if (Object.keys(months).length > 1) W.push(`в бланке смены за разные месяцы (${Object.keys(months).join(", ")}) — бланк будет записан на ${month}`);
  return { station, month, checker, manager, operators: Object.values(opNames), obs, gross, shop, warnings: W };
}
