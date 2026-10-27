// Проверка расчётов на примере станции А-2 (бланк ОСК, октябрь 2026): проценты операторов и станции — как в бланке.
import { readFileSync } from "node:fs";
import { build, parseCsv, isoDate, measure, settings, fromApi, mskDate } from "../src/client/calc.mjs";
let pass = 0, fail = 0; const ok = (n, c, d = "") => { c ? pass++ : fail++; if (!c) console.log("❌", n, d); };
const X = JSON.parse(readFileSync(new URL("./a2.json", import.meta.url)));
const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v).join(",")).join("\n");
const sheet = Object.fromEntries(Object.entries(X).map(([k, v]) => [k, parseCsv(csv(v))]));
ok("CSV: кавычки, запятые и переводы строк внутри поля", JSON.stringify(parseCsv('a,b\n"x, ""y""","1\n2"\n')) === JSON.stringify([{ a: 'x, "y"', b: "1\n2" }]));
ok("даты: 07.10.2026, 2026-10-07, 10/7/2026", isoDate("07.10.2026") === "2026-10-07" && isoDate("2026-10-07") === "2026-10-07" && isoDate("10/7/2026") === "2026-10-07");
const D = build(sheet, [], { month: "2026-10", today: "2026-10-27" }), a2 = D.stations.find(s => s.code === "А-2");
const P = Object.fromEntries(a2.operators.map(o => [o.name, o.pct]));
ok("А-2: проценты операторов как в бланке (92, 58, 73, 59, 58, 44)", P["Сакина"] === 92 && P["Алипат"] === 58 && P["Асият"] === 73 && P["Диана"] === 59 && P["Мадина"] === 58 && P["Патя"] === 44, JSON.stringify(P));
ok("А-2: станция 64%", a2.pct === 64, a2.pct);
ok("А-2: грубых 4 (в бланке «1,1,1» в одной ячейке не посчиталось)", a2.gross === 4, a2.gross);
ok("А-2: взыскание 24 800 ₽ (бланк: 24 200 + 3 × 200), управляющий 12 400 ₽", a2.fines === 24800 && a2.managerFine === 12400, `${a2.fines} ${a2.managerFine}`);
ok("А-2: слабый пункт — «Предложил оформить карту» (2%)", a2.weak?.name === "Предложил оформить карту" && a2.weak.pct === 2, JSON.stringify(a2.weak));
ok("А-2: красная (стандарт ниже 70)", a2.light === "red");
ok("другая станция без данных — серая, без процентов", D.stations.find(s => s.code === "А-1").light === "none");
ok("шкала: 90 кандидат на поощрение, 85 норма, 84 обратная связь, 69 обучение, 49 максимум", ["Кандидат на поощрение", "Норма", "Обратная связь", "Обучение, предупреждение", "Максимальное взыскание"].join() === [90, 85, 84, 69, 49].map(p => measure(p, settings([])).name).join());
{ const a = D.stations.find(s => s.code === "А-2"), al = a.operators.find(o => o.name === "Алипат");
  const nAl = a.now.operators.find(o => o.name === "Алипат");
  ok("состояние сейчас: последняя смена 04.10 → 23 дня назад, «пора проверить»; план — 6 операторов × 3 = 18, сделано 6", nAl.now === 58 && nAl.days === 23 && nAl.fresh === "due" && a.now.plan.need === 18 && a.now.plan.done === 6 && a.now.pct === 64, JSON.stringify({ nAl, plan: a.now.plan, pct: a.now.pct }));
  ok("резервный фонд октября: взыскания операторов + управляющего, 1-й месяц квартала — поощрений нет", a.fund && a.fund.balance === 24800 + 12400 && a.fund.quarterMonth === 1 && a.fund.paid === 0, JSON.stringify(a.fund)); }
const rv = [{ id: 1, created_at: "2026-10-26T21:30:00Z", station_name: "АЗС: г. Махачкала, пр. Тест 1", rating: 2, review_text: "долго", source: "telegram", full_name: "Иван Петров", phone: "+7900" }].map(fromApi);
ok("отзыв: дата по Москве, телефон не берём, имя — только первое слово", rv[0].date === "2026-10-27" && !JSON.stringify(rv).includes("+7900") && rv[0].author === "Иван", JSON.stringify(rv[0]));
const sh2 = { ...sheet, "Станции": sheet["Станции"].map(s => s["Станция"] === "А-2" ? { ...s, "Название в отзывах": "пр. Тест 1" } : s) };
const D2 = build(sh2, rv, { month: "2026-10", today: "2026-10-27" }), b = D2.stations.find(s => s.code === "А-2");
ok("отзыв привязан к станции по «Названию в отзывах», плохой — посчитан", b.reviews === 1 && b.bad === 1 && b.rating === 2 && D2.net.badToday === 1);
ok("непривязанная станция из отзывов — в списке «без привязки»", build(sheet, rv, { month: "2026-10", today: "2026-10-27" }).unmatched[0] === "АЗС: г. Махачкала, пр. Тест 1");
const F = { ...sheet, "Находки ОСК и ОСБ": [{ "Дата": "20.10.2026", "Кто нашёл": "ОСБ", "Станция": "А-1", "Что случилось": "x", "Срок": "25.10.2026", "Исправлено": "нет" }] };
const fa1 = build(F, [], { month: "2026-10", today: "2026-10-27" }).stations.find(s => s.code === "А-1");
ok("находка: не исправлена после срока — просрочена, станция красная", fa1.open === 1 && fa1.overdue === 1 && fa1.light === "red");
ok("время по Москве: 23:30 UTC — уже следующий день", mskDate("2026-10-26 21:30:00") === "2026-10-27");
{ /* квартал: Хорошая — 100 % три месяца, Слабая — 0 %; к декабрю в фонде 3 × (9 000 + 4 500), половина — Хорошей, вниз до 10 ₽ */
  const ITEMS7 = ["Поприветствовал", "Уточнил заказ", "Уточнил способ оплаты", "Спросил про карту лояльности", "Предложил оформить карту", "Озвучил сумму и сдачу", "Попрощался"];
  const row = (d, op, v) => ({ "Дата записи": d, "Станция": "А-3", "Оператор": op, "Смена": "1", "Проверяющий": "Тест", ...Object.fromEntries(ITEMS7.map(i => [i, v])) });
  const Q = { ...sheet, "Наблюдения": ["05.10.2026", "05.11.2026", "05.12.2026"].flatMap(d => [row(d, "Хорошая", "1"), row(d, "Слабая", "0")]), "Грубые нарушения": [] };
  const f = build(Q, [], { month: "2026-12", today: "2026-12-28" }).stations.find(s => s.code === "А-3").fund;
  ok("резервный фонд: в 3-м месяце квартала поощрение Хорошей (≥90 %, грубых ≤3), Слабой — нет; остаток переходит", f.quarterMonth === 3 && f.winners.join() === "Хорошая" && f.each === 20250 && f.balance === 40500 - 20250, JSON.stringify(f));
  const QQ = { ...Q, "Наблюдения": [...Q["Наблюдения"], { ...row("20.12.2026", "Слабая", "1"), "Смена": "2" }] }, ns = build(QQ, [], { month: "2026-12", today: "2026-12-28" }).stations.find(s => s.code === "А-3").now.operators.find(o => o.name === "Слабая");
  ok("состояние сейчас: 3 последние смены (100, 0, 0 → 33 %), тренд к прошлым (0) +33, свежо", ns.now === 33 && ns.trend === 33 && ns.fresh === "fresh" && ns.shifts === 4, JSON.stringify(ns));
  { /* рейтинг: Растущая 50 → 60 → 80 (исправилась), Падающая 90 → 80 → 60 (падает постоянно), Ровная 85 → 86 */
    const mk = (d, op, ones) => ({ "Дата записи": d, "Станция": "А-4", "Оператор": op, "Смена": "1", ...Object.fromEntries(ITEMS7.map((i, n) => [i, n < ones ? "1" : "0"])) });
    const P = (op, arr) => ["10.10.2026", "10.11.2026", "10.12.2026"].map((d, i) => mk(d, op, arr[i]));
    const R = build({ ...sheet, "Наблюдения": [...P("Растущая", [3.5, 4.2, 5.6].map(Math.round)), ...P("Падающая", [7, 6, 4]), ...P("Ровная", [6, 6, 6])], "Грубые нарушения": [], "Станции": sheet["Станции"].map(s => s["Станция"] === "А-4" ? { ...s, "Управляющий": "Тестов Управ" } : s) }, [], { month: "2026-12", today: "2026-12-20" }).rating;
    const g = n => R.operators.find(o => o.name === n);
    ok("рейтинг: исправилась / падает постоянно / на месте; первое место — лучший «после»", g("Растущая").status === "up" && g("Падающая").status === "falling" && g("Ровная").status === "flat" && R.operators.at(-1).name === "Падающая" && g("Растущая").before === 57 && g("Растущая").after === 86, JSON.stringify(R.operators.map(o => [o.name, o.before, o.after, o.status])));
    const M = R.managers.find(m => m.name === "Тестов Управ"); ok("рейтинг управляющих: станция А-4, исправились 1 из проблемных", M && M.stations.join() === "А-4" && M.fixed === 1 && M.problem >= 1, JSON.stringify(M)); }
  const f11 = build(Q, [], { month: "2026-11", today: "2026-11-28" }).stations.find(s => s.code === "А-3").fund;
  ok("резервный фонд: во 2-м месяце копится, поощрений нет", f11.quarterMonth === 2 && f11.paid === 0 && f11.balance === 27000 && f11.candidates[0].ok, JSON.stringify(f11)); }
const C = D2.charts;
ok("графики: 12 месяцев, распределение оценок, источники, станции по отзывам, пункты по сети", C.byMonth.length === 12 && C.byMonth.at(-1).m === "2026-10" && C.byMonth.at(-1).n === 1 && C.dist.find(x => x.stars === 2).n === 1 && C.bySource[0].source === "telegram" && C.byPlace[0].code === "А-2" && C.netItems.find(x => x.name === "Предложил оформить карту").pct === 2, JSON.stringify(C).slice(0, 300));
const M = build(sheet, [{ id: 9, date: "2026-10-20", station_name: "АЗС: г. Махачкала, ул. Хаджи Булача, 10/1", rating: 2, text: "", source: "2gis" }, { id: 10, date: "2026-10-20", station_name: "АЗС: г. Махачкала, пр. Гамидова, 1а/2", rating: 5, text: "", source: "2gis" }, { id: 11, date: "2026-10-20", station_name: "АЗС: г. Махачкала, ул. Акушинского, 94", rating: 4, text: "", source: "2gis" }], { month: "2026-10", today: "2026-10-27" });
ok("адреса из отзывов → коды (ответ Тимура): Хаджи Булача → А-10, Гамидова → А-5 (плиткой, хоть её нет в ОСК), Акушинского 94 → А-1", M.stations.find(x => x.code === "А-10").reviews === 1 && M.stations.find(x => x.code === "А-5")?.reviews === 1 && M.stations.find(x => x.code === "А-1").reviews === 1 && !M.unmatched.length);
{ const T = build(sheet, [{ id: 21, date: "2026-10-20", station_name: "АЗС: Каякент, ФАД Кавказ 888 км + 400 м", rating: 4, source: "2gis" }, { id: 22, date: "2026-10-20", station_name: "АЗС: Каякент, ФАД Кавказ 888 км", rating: 3, source: "2gis" }], { month: "2026-10", today: "2026-10-27" });
  ok("трасса: «888 км + 400» → А-15, «888 км» → А-14; А-16 Турали — плиткой с адресом", T.stations.find(x => x.code === "А-15").reviews === 1 && T.stations.find(x => x.code === "А-14").reviews === 1 && /Турали/.test(T.stations.find(x => x.code === "А-16")?.name || "")); }
console.log(fail ? `⛔ расчёты: ${pass} прошло, ${fail} упало` : `✅ расчёты: все ${pass} прошли`); process.exit(fail ? 1 : 0);
