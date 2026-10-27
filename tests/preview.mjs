// Локальный предпросмотр экрана: данные А-2 из бланка + несколько ПРИМЕРНЫХ отзывов (вымышленные), без сети.
import { readFileSync, writeFileSync } from "node:fs";
import { build, parseCsv } from "../src/client/calc.mjs";
const X = JSON.parse(readFileSync(new URL("./a2.json", import.meta.url)));
const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n");
const sheet = Object.fromEntries(Object.entries(X).map(([k, v]) => [k, parseCsv(csv(v))]));
sheet["Станции"] = sheet["Станции"].map(s => s["Станция"] === "А-5" || s["Станция"] === "А-7" ? { ...s, "Название в отзывах": "Пример " + s["Станция"] } : s["Станция"] === "А-2" ? { ...s, "Название в отзывах": "Пример А-2" } : s);
sheet["Находки ОСК и ОСБ"] = [{ "Дата": "20.10.2026", "Кто нашёл": "ОСБ", "Станция": "А-7", "Что случилось": "Пример: заправщик не подошёл к машине", "Кому передали": "Управляющий А-7", "Срок": "24.10.2026", "Исправлено": "нет" }];
const R = (id, st, rating, text, date, source = "telegram") => ({ id, station_name: st, rating, text, date, source, author: "Пример" });
const rv = [R(1, "Пример А-2", 2, "Пример отзыва: долго ждал на кассе", "2026-10-27"), R(2, "Пример А-7", 5, "Пример: вежливый оператор", "2026-10-27", "yandex"), R(3, "Пример А-7", 4, "Пример: всё хорошо", "2026-10-26", "2gis"), R(4, "АЗС: г. Махачкала, ул. Пример", 1, "Пример без привязки", "2026-10-25")];
const D = { ...build(sheet, rv, { month: "2026-10", today: "2026-10-27" }), errors: [], at: Date.now() };
const page = readFileSync(new URL("../src/page.html", import.meta.url), "utf8").replace("__AUTH__", "1").replace("__ERR__", "0")
  .replace("<script>", `<script>window.fetch = async () => ({ status: 200, json: async () => (${JSON.stringify(D)}) });</script><script>`);
writeFileSync(process.argv[2], page); console.log("ok", D.stations.length, D.net);
