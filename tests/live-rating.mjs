// Снимок вкладки «Рейтинг» (все три раздела) в настоящем Chrome
import { spawn } from "node:child_process"; import fs from "node:fs";
const [, , OUT, COOKIE] = process.argv, B = "https://azs-monitor.pamyatka-server.workers.dev", sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9700 + Math.floor(Math.random() * 90), T = fs.mkdtempSync(OUT + "/chr-");
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${T}`, "--window-size=1440,1100", "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map();
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = t.find(x => x.type === "page"); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); } } catch {} }
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await cdp("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp("Network.enable"); await cdp("Page.enable"); await cdp("Runtime.enable");
const errs = []; ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails?.exception?.description?.slice(0, 160)); });
await cdp("Network.setCookie", { name: "m", value: COOKIE.replace(/^m=/, ""), url: B, secure: true, httpOnly: true });
await cdp("Page.navigate", { url: B }); await sleep(6000);
await ev(`document.querySelector('[data-tab="rating"]').click()`); await sleep(600);
for (const k of ["operators", "stations", "managers"]) { await ev(`document.querySelector('[data-rk="${k}"]').click()`); await sleep(400); console.log(k, "строк:", await ev(`document.querySelectorAll(".rtab tbody tr").length`), "|", await ev(`document.querySelector(".rsum")?.innerText`)); const r = await cdp("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/rating-${k}.png`, Buffer.from(r.result.data, "base64")); }
console.log("ошибки JS:", errs.length ? errs : "нет");
ws.close(); chrome.kill(); await sleep(400); try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
