// Разбор настоящего бланка ОСК (А-2, октябрь): итог должен совпасть с бланком
import { readFileSync } from "node:fs";
import { readXlsx, parseBlank } from "../src/client/blank.mjs";
import { build, mergeUploads, parseCsv } from "../src/client/calc.mjs";
let pass = 0, fail = 0; const ok = (n, c, d = "") => { c ? pass++ : fail++; if (!c) console.log("❌", n, d); };
const file = process.argv[2]; if (!file) { console.log("нужен путь к бланку"); process.exit(1); }
const B = parseBlank(await readXlsx(readFileSync(file).buffer.slice(0)));
ok("бланк: станция, месяц, проверяющий, управляющий, 6 операторов", B.station === "А-2" && B.month === "2026-10" && B.checker === "Раисат" && /Абдурахманов/.test(B.manager) && B.operators.length === 6, JSON.stringify({ ...B, obs: B.obs.length, gross: B.gross.length }));
ok("бланк: 210 клиентов, 4 грубых (вкл. «1,1,1»)", B.obs.length === 210 && B.gross.length === 4, `${B.obs.length} ${B.gross.length}`);
const X = JSON.parse(readFileSync(new URL("./a2.json", import.meta.url)));
const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n");
const sheet = Object.fromEntries(Object.entries(X).map(([k, v]) => [k, parseCsv(csv(v))]));
const D = build(mergeUploads(sheet, [B]), [], { month: "2026-10", today: "2026-10-27" }), a2 = D.stations.find(s => s.code === "А-2");
ok("загруженный бланк заменяет строки таблицы (не удваивает): А-2 64%, 4 грубых, 24 800 ₽", a2.pct === 64 && a2.gross === 4 && a2.fines === 24800 && a2.operators.reduce((a, o) => a + o.shifts, 0) === 6, `${a2.pct} ${a2.gross} ${a2.fines}`);
ok("специалист ОСК станции — из бланка", a2.osk === "Раисат" && D.specialists.some(s => s.name === "Раисат" && s.stations.includes("А-2")), JSON.stringify(D.specialists));
console.log(fail ? `⛔ бланк: ${pass} прошло, ${fail} упало` : `✅ бланк: все ${pass} прошли`); process.exit(fail ? 1 : 0);
