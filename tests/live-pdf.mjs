// PDF по сети и по станции в настоящем Chrome: нажать кнопку → сохранить печать как PDF (как «Сохранить как PDF» у человека)
import { spawn } from "node:child_process"; import fs from "node:fs";
const [, , OUT, COOKIE] = process.argv, B = "https://azs-monitor.pamyatka-server.workers.dev", sleep = ms => new Promise(r => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 90), T = fs.mkdtempSync(OUT + "/chr-");
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${T}`, "--window-size=1300,1000", "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map();
for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const pg = t.find(x => x.type === "page"); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r); } } catch {} }
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => (await cdp("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp("Network.enable"); await cdp("Page.enable"); await cdp("Runtime.enable");
await cdp("Network.setCookie", { name: "m", value: COOKIE.replace(/^m=/, ""), url: B, secure: true, httpOnly: true });
await cdp("Page.navigate", { url: B }); await sleep(6000);
await ev(`window.print = () => {}; document.querySelector("#pdfAll").click()`); await sleep(800);
console.log("в отчёте станций:", await ev(`document.querySelectorAll("#printBox .dlg").length - 1`), "| разрывов страниц:", await ev(`document.querySelectorAll("#printBox .pbreak").length`));
let r = await cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(`${OUT}/network.pdf`, Buffer.from(r.result.data, "base64"));
await ev(`document.body.classList.remove("printing"); document.querySelector('.st[data-code="А-2"]').click()`); await sleep(600);
await ev(`window.print = () => {}; document.querySelector("#pdf").click()`); await sleep(500);
r = await cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }); fs.writeFileSync(`${OUT}/station.pdf`, Buffer.from(r.result.data, "base64"));
console.log("сохранено: network.pdf, station.pdf");
ws.close(); chrome.kill(); await sleep(400); try { fs.rmSync(T, { recursive: true, force: true }); } catch {}
