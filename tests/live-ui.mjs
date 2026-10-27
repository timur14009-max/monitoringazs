// Живая проверка экрана в настоящем Chrome: вход (cookie), экран, загрузка бланка → предпросмотр → «Добавить» → удаление. Снимки — в папку из аргумента.
import { spawn } from "node:child_process";
import fs from "node:fs";
const [, , OUT, COOKIE, FILE] = process.argv, B = "https://azs-monitor.pamyatka-server.workers.dev", sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 90), T = fs.mkdtempSync(OUT + "/chr-");
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${T}`, "--window-size=1440,1800", "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map();
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = t.find(x => x.type === "page"); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); } } catch {} }
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await cdp("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async n => { const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.result.data, "base64")); };
const out = [];
try {
  await cdp("Network.enable"); await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("DOM.enable");
  const [v] = COOKIE.split(";"); await cdp("Network.setCookie", { name: "m", value: v.replace(/^m=/, ""), url: B, secure: true, httpOnly: true });
  await cdp("Page.navigate", { url: B }); await sleep(6000);
  out.push("плиток станций: " + await ev(`document.querySelectorAll(".st").length`), "отзывов в ленте: " + await ev(`document.querySelectorAll(".feed .rv").length`), "специалисты: " + await ev(`[...document.querySelectorAll(".spec b")].map(x=>x.textContent).join(", ")`), "ошибки страницы: " + await ev(`document.querySelector(".alert")?.textContent?.slice(0,120) || "нет"`));
  await shot("ui-main");
  await ev(`document.querySelector("#up").click()`); await sleep(500);
  const doc = await cdp("DOM.getDocument"), q = await cdp("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#upFile" });
  await cdp("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [FILE] }); await sleep(2500);
  out.push("предпросмотр: " + await ev(`document.querySelector("#upPrev")?.innerText?.replace(/\\s+/g," ").slice(0,300)`));
  await shot("ui-upload");
  await ev(`document.querySelector("#upSave").click()`); await sleep(5000);
  out.push("после «Добавить»: " + await ev(`document.querySelector("#upPrev")?.innerText?.replace(/\\s+/g," ").slice(0,120)`), "в списке загруженных: " + await ev(`document.querySelectorAll("[data-del]").length`));
  await shot("ui-saved");
  /* убрать проверочную загрузку: двойное нажатие «Убрать» */
  await ev(`document.querySelector("[data-del]").click()`); await sleep(200); await ev(`document.querySelector("[data-del]").click()`); await sleep(4000);
  out.push("после удаления в списке: " + await ev(`document.querySelectorAll("[data-del]").length`));
} catch (e) { out.push("ОШИБКА " + e.message); }
console.log(out.join("\n")); ws?.close(); chrome.kill(); await sleep(500); try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
