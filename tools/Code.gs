/**
 * Himayath Sagar DTR Verify: Google Sheet backup and sync (no backup key)
 *
 * Setup (once, on a computer):
 *   1. Create a new Google Sheet (sheets.new) and name it, e.g. "Himayath Sagar DTR Backup".
 *   2. In the Sheet: Extensions > Apps Script. Delete the sample code, paste this whole file, and Save.
 *   3. Deploy > New deployment > Select type (gear icon): Web app
 *        Description: Himayath Sagar sync
 *        Execute as: Me
 *        Who has access: Anyone
 *      Click Deploy, allow access when Google asks, and copy the Web app URL (it ends in /exec).
 *   4. In the app (signed in as admin): menu > Google Sheet sync > paste the URL > Save and test.
 *      Staff phones: paste the same URL, or use the APK the admin shares (the link can be built in).
 *
 * There is no backup key: anyone who has the Web app URL can read and change the entries.
 * Share the URL only with your staff. To cut off an old URL: Deploy > Manage deployments > Archive,
 * then make a new deployment and give the new URL to your staff.
 *
 * Check: choose testSetup in the function list at the top and click Run. The log shows your Sheet's name.
 * To change this code later: Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy.
 * The web app URL stays the same.
 *
 * Tabs the app writes: Services, Unknown meters, Feeder checks, Area checks (entries, keyed on the KEY
 * column; an incoming row replaces the stored one only if its T_MS time is newer or equal, and removals
 * arrive with STATUS_CODE "del" so they reach the other phones), Backup log (who synced from which phone),
 * and optionally App data and Section master (put there by the admin from the app).
 */

// Leave empty when this script was opened from the Sheet (Extensions > Apps Script).
// If you created the script on script.google.com instead, paste the Sheet's ID here:
// it is the long part of the Sheet's address between /d/ and /edit.
const SHEET_ID = '';

const ENTRY_TABS = ['Services', 'Unknown meters', 'Feeder checks', 'Area checks'];
const WRITABLE = ENTRY_TABS.concat(['App data', 'Section master']);

function book_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No Sheet found: open this script from your Sheet (Extensions > Apps Script) or set SHEET_ID');
  return ss;
}

function testSetup() {
  Logger.log('Sheet: ' + book_().getName() + ' - ready. Deploy it as a Web app (Anyone) and paste the URL in the app.');
}

function doPost(e) {
  try { return handlePost_(e); } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function handlePost_(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Request was not valid JSON' }); }
  const names = Object.keys((body && body.sheets) || {});
  const bad = names.filter(function (n) { return WRITABLE.indexOf(n) < 0; });
  if (bad.length) return json_({ ok: false, error: 'Unknown tab: ' + bad.join(', ') });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = book_();
    const result = {};
    names.forEach(function (name) {
      const part = body.sheets[name];
      result[name] = (part.mode === 'replace' || part.mode === 'append') ? writeAll_(ss, name, part) : upsert_(ss, name, part);
    });
    log_(ss, body, result);
    return json_({ ok: true, result: result, at: new Date().toISOString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  try { return handleGet_(e); } catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function handleGet_(e) {
  const p = (e && e.parameter) || {};
  const ss = book_();
  if (p.ping) return json_({ ok: true, sheet: ss.getName(), app: 'Himayath Sagar DTR Verify' });
  const names = p.sheets ? String(p.sheets).split(',') : ENTRY_TABS;
  const sheets = {};
  names.forEach(function (n) {
    const sh = ss.getSheetByName(n);
    if (!sh || sh.getLastRow() < 1) { sheets[n] = { header: [], rows: [] }; return; }
    const v = sh.getDataRange().getDisplayValues();
    sheets[n] = { header: v[0], rows: v.slice(1) };
  });
  return json_({ ok: true, sheets: sheets });
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheetFor_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // keep every cell as plain text so meter and service numbers keep their leading zeros
  const cols = Math.max(header.length, 1);
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  sh.getRange(1, 1, sh.getMaxRows(), cols).setNumberFormat('@');
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

function ensureRows_(sh, lastRowNeeded) {
  const max = sh.getMaxRows();
  if (lastRowNeeded > max) sh.insertRowsAfter(max, lastRowNeeded - max);
}

function upsert_(ss, name, part) {
  const header = part.header || [], rows = part.rows || [];
  if (!rows.length) return { added: 0, updated: 0 };
  const sh = sheetFor_(ss, name, header);
  const width = header.length, lastRow = sh.getLastRow();
  const existing = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, width).getValues() : [];
  const tCol = header.indexOf('T_MS');
  const index = {};
  existing.forEach(function (r, i) { index[String(r[0])] = i; });
  const extra = [];
  let added = 0, updated = 0, changed = false;
  rows.forEach(function (r) {
    r = r.slice(0, width); while (r.length < width) r.push('');
    r = r.map(function (c) { return c == null ? '' : String(c); });
    const k = r[0], i = index[k];
    const newer = function (old) { return tCol < 0 || Number(r[tCol]) >= Number(old[tCol]); };
    if (i === undefined) { index[k] = existing.length + extra.length; extra.push(r); added++; }
    else if (i < existing.length) { if (newer(existing[i])) { existing[i] = r; updated++; changed = true; } }
    else if (newer(extra[i - existing.length])) { extra[i - existing.length] = r; }
  });
  if (changed) sh.getRange(2, 1, existing.length, width).setValues(existing);
  if (extra.length) {
    const start = existing.length + 2;
    ensureRows_(sh, start + extra.length - 1);
    sh.getRange(start, 1, extra.length, width).setNumberFormat('@').setValues(extra);
  }
  return { added: added, updated: updated };
}

function writeAll_(ss, name, part) {
  const header = part.header || [], rows = (part.rows || []).map(function (r) { return r.map(function (c) { return c == null ? '' : String(c); }); });
  let sh = ss.getSheetByName(name);
  if (part.mode === 'replace' && sh) sh.clear();
  sh = sheetFor_(ss, name, header);
  if (!rows.length) return { written: 0 };
  const start = sh.getLastRow() + 1;
  ensureRows_(sh, start + rows.length - 1);
  sh.getRange(start, 1, rows.length, header.length).setNumberFormat('@').setValues(rows);
  return { written: rows.length };
}

function log_(ss, body, result) {
  const header = ['TIME', 'DEVICE', 'USER', 'APP_VERSION', 'RESULT'];
  let sh = ss.getSheetByName('Backup log');
  if (!sh) { sh = ss.insertSheet('Backup log'); sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold'); sh.setFrozenRows(1); }
  sh.appendRow([new Date(), body.device || '', body.user || '', body.app || '', JSON.stringify(result)]);
}
