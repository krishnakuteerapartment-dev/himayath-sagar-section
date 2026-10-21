// Smoke test of the Android app on an emulator (GitHub Actions). Uses made-up test data only.
// Installs the debug APK, drives the WebView with Playwright, takes real device screenshots
// (status bar, native camera scanner behind the page) and writes shots/report.json.
import { _android as android } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PKG = 'com.himayathsagar.dtrverify';
const ACT = 'com.himayathsagar.dtrverify.MainActivity';
const APK = process.argv[2] || 'apk/app-debug.apk';
mkdirSync('shots', { recursive: true });
const report = { steps: [], errors: [], console: [] };
const adb = c => { try { return execSync('adb ' + c, { encoding: 'utf8', timeout: 60000 }).trim(); } catch (e) { return 'ERR ' + (e.stdout || e.message); } };
const step = (name, data) => { report.steps.push({ name, ...data }); console.log('STEP', name, JSON.stringify(data || {})); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeSection() {
  const lines = [], STR = {}, AR = {};
  for (let d = 1; d <= 40; d++) {
    const code = '1516014' + String(d).padStart(3, '0');
    STR[code] = ['TEST STRUCTURE ' + d, d % 3 ? 'APRMT' : 'PUBLIC', '11 KV TEST FEEDER ' + (1 + d % 3), '17011124010' + (d % 3), d % 2 ? '100' : '63', '33/11 KV TEST SS'];
    const ac = '311' + (d % 5);
    AR[ac] = AR[ac] || ['TEST AREA ' + (d % 5), {}];
    for (let i = 1; i <= 25; i++) {
      const n = d * 100 + i;
      lines.push(['31' + String(10 + d % 5) + ' ' + String(n).padStart(5, '0'), String(114000000 + n), 'AF' + (400000 + n), code, 'TEST CONSUMER ' + n, 'H NO ' + n + ', TEST COLONY', i % 7 ? 1 : 3, '1', 2, 'HPL', 1000 + n, '10/2026', 'SL' + n, '01', 1, 'TEST AREA ' + (d % 5), 0, i % 9 ? code : '1516014099'].join('\t'));
      AR[ac][1][code] = (AR[ac][1][code] || 0) + 1;
    }
  }
  return { txt: lines.join('\n'), STR, AR, meta: { mapOn: 'test', masterOn: 'test', src: 'CI test data', loaded: Date.now() } };
}

async function main() {
  const [device] = await android.devices({ omitDriverInstall: true });
  step('device', { model: device.model(), serial: device.serial(), sdk: adb('shell getprop ro.build.version.sdk'), webview: adb('shell dumpsys webviewupdate | grep -m1 "Current WebView package"') });
  const shot = async (name) => { try { await device.screenshot({ path: `shots/${name}.png` }); } catch (e) { report.errors.push('shot ' + name + ': ' + e.message); } };

  // the CI emulator's launcher sometimes shows "isn't responding"; hide such system dialogs so they don't swallow key presses
  adb('shell settings put global hide_error_dialogs 1'); adb('shell settings put global anr_show_background 0');
  adb(`uninstall ${PKG}`);
  step('install', { out: adb(`install -r -g ${APK}`) });
  adb(`shell pm grant ${PKG} android.permission.CAMERA`);
  const t0 = Date.now();
  adb(`shell am start -W -n ${PKG}/${ACT}`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  const page = await webview.page();
  page.on('console', m => report.console.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => report.errors.push('pageerror: ' + e.message));
  await page.waitForSelector('#lgUser', { timeout: 30000 });
  step('login screen', { ms: Date.now() - t0 });
  await sleep(1500); await shot('01-login');

  await page.fill('#lgUser', 'admin'); await page.fill('#lgPw', '123456'); await page.click('#lgBtn');
  await page.waitForSelector('#gsForm', { timeout: 20000 });
  await sleep(800); await shot('02-setup');

  // load made-up section data straight into the app's IndexedDB, then reload
  await page.evaluate(async (P) => {
    localStorage.setItem('yrg_test', '1');
    await new Promise((res, rej) => { const r = indexedDB.open('hsagar-dtr', 2);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv'); if (!db.objectStoreNames.contains('ent')) db.createObjectStore('ent'); };
      r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'); t.objectStore('kv').put(P, 'section'); t.oncomplete = () => { r.result.close(); res(); }; t.onerror = () => rej(t.error); };
      r.onerror = () => rej(r.error); });
  }, fakeSection());
  const t1 = Date.now();
  await page.reload();
  await page.waitForSelector('#dtrPick', { timeout: 30000 });
  step('data loaded and first screen', { ms: Date.now() - t1 });
  await sleep(1200); await shot('03-verify');
  step('insets', await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { top: cs.getPropertyValue('--safe-area-inset-top'), bottom: cs.getPropertyValue('--safe-area-inset-bottom'), sat: getComputedStyle(document.querySelector('.top')).top, plugins: Object.keys((window.Capacitor && Capacitor.Plugins) || {}).join(',') }; }));

  // DTR list sheet
  await page.click('#dtrPick'); await page.waitForSelector('.sheet.on'); await sleep(500); await shot('04-dtr-sheet');
  await page.fill('#dsQ', '4007'); await sleep(300); await shot('05-dtr-sheet-typed');
  await page.click('[data-pick="1516014007"]'); await page.waitForSelector('.sheet', { state: 'detached' }).catch(() => {});
  await sleep(400);
  step('picked DTR', { label: await page.textContent('#dtrPick') });

  // native ML Kit scanner
  await page.click('#scanBtn');
  await sleep(3500);
  const scanning = await page.evaluate(() => document.documentElement.classList.contains('scanning') && !!document.getElementById('scanOv'));
  step('native scanner open', { scanning, noNative: await page.evaluate(() => !!window.__yrg && window.__yrg.S.noNativeScan) });
  await shot('06-scanner');
  await page.evaluate(() => window.__yrg.scan('AF400701', 'QR (test)')); await sleep(900); await shot('07-scanner-verified');
  await page.evaluate(() => window.__yrg.scan('AF401001', 'QR (test)')); await sleep(900); await shot('08-scanner-other-dtr');
  const hasConfirm = await page.$('#scanOv [data-pa="confirm"]');
  if (hasConfirm) { await hasConfirm.click(); await sleep(700); }
  await page.evaluate(() => window.__yrg.scan('ZZ999999', 'Barcode (test)')); await sleep(900); await shot('09-scanner-unknown');
  step('scanner results', { stats: await page.textContent('#scanOv .so-stats').catch(() => '') });
  adb('shell input keyevent 4'); await sleep(1200); // back button closes the scanner
  step('after back', { scanning: await page.evaluate(() => document.documentElement.classList.contains('scanning')), tabs: await page.textContent('#stabsBox', { timeout: 8000 }).catch(e => 'MISSING') });
  await shot('10-after-scan');
  // open and close the scanner again (camera restarts cleanly)
  await page.click('#scanBtn'); await sleep(3000); await shot('10b-scanner-again');
  step('scanner again', { scanning: await page.evaluate(() => document.documentElement.classList.contains('scanning')) });
  await page.click('#soClose'); await sleep(1000);
  step('closed with X', { scanning: await page.evaluate(() => document.documentElement.classList.contains('scanning')), list: await page.evaluate(() => !!document.getElementById('svcList')) });

  // list: open a row and mark it
  await page.click('#svcList .li'); await sleep(300); await shot('11-row-open');
  await page.click('[data-mark="ok"]'); await sleep(500);
  step('marked', { tabs: await page.textContent('#stabsBox') });

  // keyboard hides the bottom bar
  await page.click('#manual'); await sleep(1500);
  step('keyboard', { kb: await page.evaluate(() => document.documentElement.classList.contains('kb')), tabsVisible: await page.evaluate(() => getComputedStyle(document.querySelector('.tabs')).display) });
  await shot('12-keyboard'); adb('shell input keyevent 4'); await sleep(800);

  const closeKb = async () => { if (await page.evaluate(() => document.documentElement.classList.contains('kb'))) { adb('shell input keyevent 4'); await sleep(900); } };
  for (const [tab, name] of [['feeder', '13-feeders'], ['area', '14-areas'], ['report', '15-report'], ['search', '16-search'], ['guide', '17-guide']]) {
    await closeKb(); await page.click(`[data-tab="${tab}"]`, { timeout: 10000 }); await sleep(900); await shot(name);
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(500); await shot('17b-guide-bottom');

  // hamburger menu: opens, Android back closes it, an item navigates
  await closeKb(); await page.click('#menuBtn'); await page.waitForSelector('.drawer.on'); await sleep(1500); await shot('17c-menu');
  const menuOpen = await page.evaluate(() => { const d = document.querySelector('.drawer.on'); if (!d) return false; const r = d.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { left: Math.round(r.left), width: Math.round(r.width), transform: getComputedStyle(d).transform, onTop: !!(hit && d.contains(hit)), items: d.querySelectorAll('.dr-item').length }; });
  adb('shell input keyevent 4'); await sleep(700);
  const closedByBack = await page.evaluate(() => !document.querySelector('.drawer'));
  await page.click('#menuBtn'); await sleep(600); await page.click('.dr-item[data-act="go:feeder"]'); await sleep(700);
  step('menu', { menuOpen, closedByBack, view: await page.evaluate(() => document.querySelector('.tab[aria-current="page"]').dataset.tab) });

  // Service-wise: look up one service, move it to another DTR with a remark
  await closeKb(); await page.click('[data-tab="search"]'); await sleep(400);
  await page.fill('#q', '311201205'); await sleep(800); await closeKb(); await sleep(300); await shot('21-service');
  await page.click('[data-sv="move"]'); await sleep(300); await page.click('#mvTo'); await page.waitForSelector('.sheet.on');
  await page.fill('#dsQ', '4013'); await sleep(300); await page.click('[data-pick="1516014013"]'); await sleep(500);
  await page.selectOption('#mvReason', { index: 2 }); await page.fill('#mvRemark', 'CI test remark'); await closeKb(); await sleep(300);
  await page.click('#mvSave'); await sleep(700); await shot('22-service-moved');
  step('service move', { status: (await page.textContent('#svcCard .res')).slice(0, 200) });

  // Documents backup file
  const fb = await page.evaluate(async () => { const F = window.__yrg.FileBackup; F.dirty = true; await F.write(); return { ok: F.ok, name: F.name() }; });
  step('documents backup', { ...fb, ls: adb('shell ls -l "/sdcard/Documents/Himayath Sagar DTR/"') });

  // Google Sheet: no link is built into the test build, so the app must say it is not syncing
  step('sheet not set', { ready: await page.evaluate(() => window.__yrg.Backup.ready()), badge: await page.textContent('#storeBadge') });

  // pull down to sync (not set up -> friendly message)
  await closeKb(); await page.click('[data-tab="verify"]'); await sleep(600);
  adb('shell input swipe 540 600 540 1500 400'); await sleep(1200); await shot('18-pull-to-sync');

  // dark mode
  adb('shell cmd uimode night yes'); await sleep(2500); await shot('19-dark');
  adb('shell cmd uimode night no'); await sleep(1000);

  // back button from another tab returns to Services, then exits
  await page.click('[data-tab="report"]'); await sleep(500); adb('shell input keyevent 4'); await sleep(700);
  step('back to services', { view: await page.evaluate(() => document.querySelector('.tab[aria-current="page"]').dataset.tab) });

  // relaunch: entries still there (IndexedDB)
  adb(`shell am force-stop ${PKG}`); await sleep(1000);
  const t2 = Date.now(); adb(`shell am start -W -n ${PKG}/${ACT}`);
  const wv2 = await device.webView({ pkg: PKG }, { timeout: 60000 }); const p2 = await wv2.page();
  await p2.waitForSelector('#dtrPick', { timeout: 30000 });
  step('cold start to first screen', { ms: Date.now() - t2, tabs: await p2.textContent('#stabsBox') });
  await sleep(800); await shot('20-relaunch');
  await device.close();
}

main().catch(e => { report.errors.push('FATAL ' + (e.stack || e.message)); console.error(e); })
  .finally(() => { writeFileSync('shots/report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.steps, null, 1)); console.log('errors', report.errors); process.exit(0); });
