// Снимок вкладки «Отзывы» в настоящем Chrome: node tests/live-tab.mjs <папка> <cookie m=…> [ширина]
import { spawn } from "node:child_process"; import fs from "node:fs";
const [, , OUT, COOKIE, W = "1440"] = process.argv, B = "https://azs-monitor.pamyatka-server.workers.dev", sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 90), T = fs.mkdtempSync(OUT + "/chr-");
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${T}`, `--window-size=${W},1400`, "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map();
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = t.find(x => x.type === "page"); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); } } catch {} }
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await cdp("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp("Network.enable"); await cdp("Page.enable"); if (+W < 600) await cdp("Emulation.setDeviceMetricsOverride", { width: +W, height: 1400, deviceScaleFactor: 2, mobile: true });
await cdp("Network.setCookie", { name: "m", value: COOKIE.replace(/^m=/, ""), url: B, secure: true, httpOnly: true });
await cdp("Page.navigate", { url: B }); await sleep(6000);
await ev(`document.querySelector('[data-tab="reviews"]').click()`); await sleep(800);
console.log("строк:", await ev(`document.querySelectorAll(".rtab tbody tr").length`), "| итог:", await ev(`document.querySelector(".rsum")?.innerText`), "| шире экрана:", await ev(`document.documentElement.scrollWidth > innerWidth`), "| ошибки:", await ev(`document.querySelector(".alert")?.innerText?.slice(0,80) || "нет"`));
await ev(`(()=>{const s=document.querySelector('#rf [name="rate"]'); s.value="bad"; s.onchange();})()`); await sleep(500);
console.log("плохие:", await ev(`document.querySelector(".rsum")?.innerText`));
await ev(`(()=>{const s=document.querySelector('#rf [name="rate"]'); s.value=""; s.onchange();})()`); await sleep(300);
const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/tab-${W}.png`, Buffer.from(r.result.data, "base64"));
ws.close(); chrome.kill(); await sleep(400); try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
