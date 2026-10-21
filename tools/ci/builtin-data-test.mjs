// Checks the "full APK" path with made-up data: data.js added to the APK (tools/add-data.py),
// re-signed with a throwaway key, installed, and the app must open straight to the DTR screen
// with the built-in data (no data file, no Sheet).
import { _android as android } from 'playwright-core';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const PKG = 'com.himayathsagar.dtrverify', ACT = 'com.himayathsagar.dtrverify.MainActivity';
const sh = c => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
const adb = c => { try { return sh('adb ' + c); } catch (e) { return 'ERR ' + (e.stdout || e.message); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = existsSync('shots/report.json') ? JSON.parse(readFileSync('shots/report.json', 'utf8')) : { steps: [], errors: [] };
const step = (name, data) => { report.steps.push({ name, ...data }); console.log('STEP', name, JSON.stringify(data || {})); };

// made-up section in the data.js format: 30 DTRs x 20 services
const lines = [], structs = {}, areas = {};
for (let d = 1; d <= 30; d++) {
  const code = '1518008' + String(d).padStart(3, '0');
  structs[code] = ['BUILTIN DTR ' + d, 'PUBLIC', '11 KV BUILTIN FEEDER ' + (d % 2), '17011124030' + (d % 2), '100', '33/11 KV BUILTIN SS'];
  const ac = '312' + (d % 3); areas[ac] = areas[ac] || ['BUILTIN AREA ' + (d % 3), {}];
  for (let i = 1; i <= 20; i++) {
    const n = d * 100 + i;
    lines.push(['3126 ' + String(n).padStart(5, '0'), String(115000000 + n), 'BI' + (500000 + n), code, 'BUILTIN CONSUMER ' + n, 'PLOT ' + n, 1, '1', 1, 'HPL', n, '10/2026', 'SL' + n, '01', 1, 'BUILTIN AREA ' + (d % 3), 0, code].join('\t'));
    areas[ac][1][code] = (areas[ac][1][code] || 0) + 1;
  }
}
const data = { app: 'hsagar-dtr', v: 1, meta: { section: 'TEST', mapOn: 'test', masterOn: 'test' }, records: gzipSync(lines.join('\n')).toString('base64'), structs, areas, sync: '' };
writeFileSync('ci-data.js', 'window.__HS_DATA=' + JSON.stringify(data) + ';\n');

async function main() {
  sh('python3 tools/add-data.py apk/app-debug.apk ci-data.js apk/app-data-unsigned.apk');
  sh('keytool -genkeypair -keystore ci.p12 -storetype PKCS12 -storepass cipass123 -keypass cipass123 -alias ci -keyalg RSA -keysize 2048 -validity 2 -dname CN=ci -noprompt');
  sh('python3 tools/apksign.py apk/app-data-unsigned.apk apk/app-data.apk ci.p12 cipass123 ci');
  adb(`uninstall ${PKG}`);
  step('builtin: install', { out: adb('install -r -g apk/app-data.apk') });
  adb(`shell am start -W -n ${PKG}/${ACT}`);
  const [device] = await android.devices({ omitDriverInstall: true });
  const page = await (await device.webView({ pkg: PKG }, { timeout: 60000 })).page();
  page.on('pageerror', e => report.errors.push('builtin pageerror: ' + e.message));
  await page.waitForSelector('#lgUser', { timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('yrg_test', '1'));
  await page.fill('#lgUser', 'admin'); await page.fill('#lgPw', '123456'); await page.click('#lgBtn');
  const t = Date.now();
  const ok = await page.waitForSelector('#dtrPick', { timeout: 30000 }).then(() => true).catch(() => false);
  await sleep(1000);
  try { await device.screenshot({ path: 'shots/30-builtin-data.png' }); } catch (e) {}
  step('builtin: opens with data', { ok, ms: Date.now() - t, info: ok ? await page.evaluate(() => ({ recs: window.__yrg.S.recs.length, dtrs: window.__yrg.S.dtrs.length, src: window.__yrg.S.meta.src, pick: document.getElementById('dtrPick').textContent })) : await page.textContent('main') });
  await device.close();
}
main().catch(e => { report.errors.push('builtin FATAL ' + (e.stack || e.message)); console.error(e); })
  .finally(() => { writeFileSync('shots/report.json', JSON.stringify(report, null, 2)); process.exit(0); });
