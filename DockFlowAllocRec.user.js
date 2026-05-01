// ==UserScript==
// @name         DockFlow Allocation Recommender
// @namespace    http://tampermonkey.net/
// @version      3.3.0
// @description  Recommends allocation changes on OBA detail and Arcs list pages
// @author       Jake
// @match        https://prod-na.dockflow.robotics.a2z.com/*
// @grant        none
// @license      MIT
// @homepageURL  https://github.com/ludjacob/DockFlowAllocRec
// @supportURL   https://github.com/ludjacob/DockFlowAllocRec/issues
// @downloadURL  https://github.com/ludjacob/DockFlowAllocRec/raw/main/DockFlowAllocRec.user.js
// @updateURL    https://github.com/ludjacob/DockFlowAllocRec/raw/main/DockFlowAllocRec.user.js
// ==/UserScript==
(function() {
'use strict';

var path = window.location.pathname;

if (path.indexOf('/oba') === -1 && !/\/wc(\?|$)/i.test(path)) return;

console.log('[AllocRec] v3.3.0 loaded | path: ' + path);

var style = document.createElement('style');

style.textContent = [
'#alloc-rec-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:16px;font-size:13px;font-weight:600;margin-left:10px;vertical-align:middle}',
'#alloc-rec-badge.increase{background:#fde8e8;color:#b91c1c;border:1px solid #f87171}',
'#alloc-rec-badge.decrease{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}',
'#alloc-rec-badge.no-change{background:#e0e7ff;color:#3730a3;border:1px solid #a5b4fc}',
'#alloc-rec-badge.dark-window{background:#f8f8f8;color:#94a3b8;border:1px dashed #cbd5e1}',
'#alloc-rec-settings-btn{cursor:pointer;background:none;border:none;font-size:18px;margin-left:8px;vertical-align:middle;opacity:0.7}',
'#alloc-rec-settings-btn:hover{opacity:1}',
'#alloc-rec-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:99999;display:flex;align-items:center;justify-content:center}',
'#alloc-rec-modal{background:#fff;border-radius:12px;padding:24px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif}',
'#alloc-rec-modal h3{margin:0 0 16px 0;font-size:16px;color:#1e293b}',
'#alloc-rec-modal label{display:block;margin-bottom:4px;font-size:13px;font-weight:500;color:#475569}',
'#alloc-rec-modal input{width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;margin-bottom:14px;box-sizing:border-box}',
'#alloc-rec-modal input:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,0.2)}',
'.alloc-rec-btn-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}',
'.alloc-rec-btn{padding:8px 16px;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;border:none}',
'.alloc-rec-btn.primary{background:#4f46e5;color:#fff}',
'.alloc-rec-btn.primary:hover{background:#4338ca}',
'.alloc-rec-btn.secondary{background:#f1f5f9;color:#475569}',
'.alloc-rec-btn.secondary:hover{background:#e2e8f0}',
'#alloc-rec-forecast-row{display:flex;gap:0;margin-top:6px;padding:4px 0}',
'#alloc-rec-forecast-row .alloc-cell{flex:1;text-align:center;padding:4px 6px;font-size:12px;font-weight:600;border-right:1px solid #e2e8f0}',
'#alloc-rec-forecast-row .alloc-cell:last-child{border-right:none}',
'#alloc-rec-forecast-label{font-size:12px;font-weight:600;color:#64748b;margin-top:10px;margin-bottom:2px}',
'.alloc-rec-list-badge{display:inline-flex;align-items:center;gap:2px;font-size:12px;font-weight:700;margin-left:6px;white-space:nowrap;cursor:default}',
'.alloc-rec-list-badge.up{color:#b91c1c}',
'.alloc-rec-list-badge.down{color:#065f46}',
'.alloc-rec-list-badge.same{color:#3730a3}'
].join('');

document.head.appendChild(style);

var CONFIG_KEY = 'dockflow_alloc_config';

// DEFAULTS now include dark window fields and units per tote
var DEFAULTS = {
containerizeRateCase: 85,
containerizeRateTote: 75,
darkWindows: '05:00-07:30,18:00-18:30',
unitsPerTote: 3.5
};

var listLoaded = false;
    var EXCLUDED_ARCS = ['KICKOUT', 'DZ-P'];

function isExcludedArc(name) {
    var upper = name.toUpperCase();
    for (var i = 0; i < EXCLUDED_ARCS.length; i++) {
        if (upper.indexOf(EXCLUDED_ARCS[i]) !== -1) return true;
    }
    return false;
}

// Returns true if the arc name ends with _TOTE (case-insensitive)
function isToteSuffix(name) {
    return name.toUpperCase().indexOf('_TOTE') === name.length - 5 && name.length >= 5;
}

var GRAPHQL_ENDPOINT = 'https://rtyxxulvlvberovj325a3rxppq.appsync-api.us-east-1.amazonaws.com/graphql';

var GQL_QUERY = [
'query getOutboundArc($siteName: String!, $outboundArcName: String!) {',
'  outboundArc(siteName: $siteName, outboundArcName: $outboundArcName) {',
'    name',
'    workcells {',
'      id {',
'        name',
'        type',
'        siteName',
'      }',
'    }',
'    workState {',
'      rate {',
'        projected {',
'          interval',
'          rate',
'        }',
'      }',
'    }',
'  }',
'}'
].join('');

function getConfig() {
try {
var s = localStorage.getItem(CONFIG_KEY);
if (s) {
var p = JSON.parse(s);
return {
containerizeRateCase: p.containerizeRateCase || DEFAULTS.containerizeRateCase,
containerizeRateTote: p.containerizeRateTote || DEFAULTS.containerizeRateTote,
darkWindows: (p.darkWindows !== undefined) ? p.darkWindows : DEFAULTS.darkWindows,
unitsPerTote: (p.unitsPerTote !== undefined && p.unitsPerTote > 0) ? p.unitsPerTote : DEFAULTS.unitsPerTote
};
}
} catch (e) {}
return {
containerizeRateCase: DEFAULTS.containerizeRateCase,
containerizeRateTote: DEFAULTS.containerizeRateTote,
darkWindows: DEFAULTS.darkWindows,
unitsPerTote: DEFAULTS.unitsPerTote
};
}

function saveConfig(cfg) {
localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// ── DARK WINDOW HELPERS ──────────────────────────────────────────────────────

// Parse "HH:MM" into total minutes since midnight
function parseHHMM(str) {
var parts = str.trim().split(':');
if (parts.length !== 2) return null;
var h = parseInt(parts[0], 10);
var m = parseInt(parts[1], 10);
if (isNaN(h) || isNaN(m)) return null;
return h * 60 + m;
}

// Parse the darkWindows string ("05:00-07:30,18:00-18:30") into
// an array of {start, end} objects (minutes since midnight).
function parseDarkWindows(str) {
if (!str || !str.trim()) return [];
var windows = [];
var segments = str.split(',');
for (var i = 0; i < segments.length; i++) {
var seg = segments[i].trim();
if (!seg) continue;
var dash = seg.indexOf('-');
if (dash === -1) continue;
var s = parseHHMM(seg.substring(0, dash));
var e = parseHHMM(seg.substring(dash + 1));
if (s !== null && e !== null) windows.push({start: s, end: e});
}
return windows;
}

// Return true if the current local time falls inside any configured dark window
function isInDarkWindow() {
var cfg = getConfig();
var windows = parseDarkWindows(cfg.darkWindows);
if (!windows.length) return false;
var now = new Date();
var cur = now.getHours() * 60 + now.getMinutes();
for (var i = 0; i < windows.length; i++) {
if (cur >= windows[i].start && cur < windows[i].end) return true;
}
return false;
}

// Return milliseconds until the next dark window ends (or 0 if none active)
function msUntilDarkWindowEnd() {
var cfg = getConfig();
var windows = parseDarkWindows(cfg.darkWindows);
var now = new Date();
var cur = now.getHours() * 60 + now.getMinutes();
for (var i = 0; i < windows.length; i++) {
if (cur >= windows[i].start && cur < windows[i].end) {
var minsLeft = windows[i].end - cur;
minsLeft -= (now.getSeconds() / 60);
return Math.max(0, minsLeft * 60 * 1000);
}
}
return 0;
}

// ── END DARK WINDOW HELPERS ──────────────────────────────────────────────────

function containsPID(str) {
return str.toUpperCase().indexOf('PID') !== -1;
}

function getArcType(name) {
return name.toUpperCase().indexOf('TOTE') !== -1 ? 'TOTE' : 'CASE';
}

function getAvg(name) {
var c = getConfig();
return getArcType(name) === 'TOTE' ? c.containerizeRateTote : c.containerizeRateCase;
}

function getArcName() {
var parts = path.split('/');
return parts[parts.length - 1] || '';
}

function getSiteName() {
var parts = path.split('/');
var out = [];
for (var i = 0; i < parts.length; i++) {
if (parts[i].length > 0) out.push(parts[i]);
}
return out.length >= 1 ? out[0] : '';
}

function getSegs() {
var s = path.split('/');
var out = [];
for (var i = 0; i < s.length; i++) {
if (s[i].length > 0) out.push(s[i]);
}
return out;
}

function isDetail() {
var s = getSegs();
return s.length >= 3 && s[1] === 'oba' && s[2].length > 0;
}

function isList() {
var s = getSegs();
if (s.length === 2 && s[1] === 'oba') return true;
var h2s = document.querySelectorAll('h2');
for (var i = 0; i < h2s.length; i++) {
if ((/arcs\s*\(/i).test(h2s[i].textContent)) return true;
}
return false;
}

function findCSHeading(text) {
var spans = document.querySelectorAll('h2 span[data-analytics-funnel-key="substep-name"]');
for (var i = 0; i < spans.length; i++) {
var nodes = spans[i].childNodes;
var t = '';
for (var j = 0; j < nodes.length; j++) {
if (nodes[j].nodeType === Node.TEXT_NODE) t += nodes[j].textContent.trim();
}
if (t.toLowerCase().indexOf(text.toLowerCase()) !== -1) return spans[i];
}
return null;
}

function findH2(text) {
var h2s = document.querySelectorAll('h2');
for (var i = 0; i < h2s.length; i++) {
if (h2s[i].textContent.toLowerCase().indexOf(text.toLowerCase()) !== -1) return h2s[i];
}
return null;
}

function scrapeFuture() {
var h = findCSHeading('Future');
if (!h) return null;
var box = h.closest('[class*="content-wrapper"]');
if (!box) {
box = h;
for (var i = 0; i < 6; i++) {
box = box.parentElement;
if (!box) return null;
if (box.className && box.className.indexOf('content-wrapper') !== -1) break;
}
}
var els = box.querySelectorAll('*');
var nums = [];
for (var i = 0; i < els.length; i++) {
if (/^\d+$/.test(els[i].textContent.trim()) && els[i].children.length === 0) {
nums.push(els[i]);
}
}
if (nums.length >= 7) {
var r = [];
for (var i = 0; i < 7; i++) r.push(parseInt(nums[i].textContent.trim()));
return r;
}
return null;
}

function scrapeAlloc() {
var assignH2 = findAssignH2();
if (assignH2) {
var container = assignH2.closest('[class*="content-wrapper"]');
if (!container) {
container = assignH2;
for (var i = 0; i < 8; i++) {
container = container.parentElement;
if (!container) break;
if (container.className && container.className.indexOf('content-wrapper') !== -1) break;
}
}
if (container) {
var allEls = container.querySelectorAll('*');
var cur = 0;
for (var i = 0; i < allEls.length; i++) {
var el = allEls[i];
if (el.children.length > 0) continue;
var txt = el.textContent.trim();
if (txt.toLowerCase() === 'sorterlane') {
var nameEl = el.previousElementSibling ||
(el.parentElement ? el.parentElement.previousElementSibling : null);
if (!nameEl && el.parentElement) {
var siblings = el.parentElement.querySelectorAll('*');
for (var j = 0; j < siblings.length; j++) {
if (siblings[j].textContent.trim().toLowerCase() !== 'sorterlane' &&
siblings[j].children.length === 0 &&
siblings[j].textContent.trim().length > 2) {
nameEl = siblings[j];
break;
}
}
}
var wcName = nameEl ? nameEl.textContent.trim() : '';
if (!containsPID(wcName)) cur++;
}
}
if (cur > 0) {
console.log('[AllocRec] scrapeAlloc scoped count: ' + cur);
return cur;
}
}
}
var spans = document.querySelectorAll('span[class*="counter"]');
for (var i = 0; i < spans.length; i++) {
var prev = spans[i].previousElementSibling;
if (prev && (/Arc Assignments/i).test(prev.textContent)) {
var m = spans[i].textContent.match(/(\d+)/);
if (m) return parseInt(m[1]);
}
}
var all = document.querySelectorAll('*');
for (var i = 0; i < all.length; i++) {
var el = all[i];
var txt = el.textContent.trim();
var m = txt.match(/Arc Assignments\s*\((\d+)\)/i);
if (m && el.children.length < 5) return parseInt(m[1]);
}
return null;
}

function findAssignH2() {
var h = findCSHeading('Arc Assignments');
if (h) return h.closest('h2') || h.parentElement;
var all = document.querySelectorAll('h2, div, span');
for (var i = 0; i < all.length; i++) {
var el = all[i];
if ((/Arc Assignments/i).test(el.textContent.trim()) && el.children.length < 5) return el;
}
return null;
}

function findFutureBox() {
var h = findCSHeading('Future');
if (!h) return null;
var box = h.closest('[class*="content-wrapper"]');
if (!box) {
box = h;
for (var i = 0; i < 6; i++) {
box = box.parentElement;
if (!box) return null;
if (box.className && box.className.indexOf('content-wrapper') !== -1) break;
}
}
return box;
}

// Settings modal now includes dark window fields and units per tote
function showSettings() {
var cfg = getConfig();
var old = document.getElementById('alloc-rec-overlay');
if (old) old.remove();
var ov = document.createElement('div');
ov.id = 'alloc-rec-overlay';
ov.innerHTML = '<div id="alloc-rec-modal">' +
'<h3>&#9881;&#65039; Allocation Recommender Settings</h3>' +
'<label for="alloc-cfg-cases">Case Containerize Rate (JPH)</label>' +
'<input type="number" id="alloc-cfg-cases" value="' + cfg.containerizeRateCase + '" min="1" />' +
'<label for="alloc-cfg-totes">Tote Containerize Rate (JPH)</label>' +
'<input type="number" id="alloc-cfg-totes" value="' + cfg.containerizeRateTote + '" min="1" />' +
'<label for="alloc-cfg-upt">Units Per Tote (for _TOTE arcs only)</label>' +
'<input type="number" id="alloc-cfg-upt" value="' + cfg.unitsPerTote + '" min="0.1" step="0.1" />' +
'<label for="alloc-cfg-dark">Dark Windows (HH:MM-HH:MM, comma-separated)</label>' +
'<input type="text" id="alloc-cfg-dark" value="' + cfg.darkWindows + '" ' +
'placeholder="05:00-07:30,18:00-18:30" />' +
'<div class="alloc-rec-btn-row">' +
'<button class="alloc-rec-btn secondary" id="alloc-cfg-cancel">Cancel</button>' +
'<button class="alloc-rec-btn primary" id="alloc-cfg-save">Save</button>' +
'</div></div>';
document.body.appendChild(ov);
document.getElementById('alloc-cfg-cancel').addEventListener('click', function() {
ov.remove();
});
ov.addEventListener('click', function(e) {
if (e.target === ov) ov.remove();
});
document.getElementById('alloc-cfg-save').addEventListener('click', function() {
var c = parseInt(document.getElementById('alloc-cfg-cases').value) || DEFAULTS.containerizeRateCase;
var t = parseInt(document.getElementById('alloc-cfg-totes').value) || DEFAULTS.containerizeRateTote;
var upt = parseFloat(document.getElementById('alloc-cfg-upt').value);
if (isNaN(upt) || upt <= 0) upt = DEFAULTS.unitsPerTote;
var dw = document.getElementById('alloc-cfg-dark').value.trim();
saveConfig({containerizeRateCase: c, containerizeRateTote: t, unitsPerTote: upt, darkWindows: dw});
ov.remove();
listLoaded = false;
run();
});
}

// calcDetail — applies unitsPerTote conversion for _TOTE suffix arcs
function calcDetail() {
var arcName = getArcName();
    if (isExcludedArc(arcName)) return null;
var avg = getAvg(arcName);
var cfg = getConfig();
var applyUPT = isToteSuffix(arcName);
var upt = applyUPT ? cfg.unitsPerTote : 1;
var wip = scrapeFuture();
var alloc = scrapeAlloc();
console.log('[AllocRec] Detail | arc: ' + arcName + ' | type: ' + getArcType(arcName) + ' | rate: ' + avg + ' JPH | upt: ' + upt + ' | wip: ' + JSON.stringify(wip) + ' | alloc: ' + alloc);
if (!wip || alloc === null) return null;
var minA = 0;
for (var i = 0; i < 4; i++) {
if (wip[i] > 0) { minA = 1; break; }
}
var intervals = ['15 MIN', '30 MIN', '1 HR', '2 HR', '4 HR', '8 HR', '24 HR'];
var hm = [0.25, 0.5, 1, 2, 4, 8, 24];
var per = [];
for (var i = 0; i < wip.length; i++) {
var n = 0;
if (wip[i] > 0) n = Math.round((wip[i] / upt) / hm[i] / avg);
n = Math.max(n, minA);
per.push({interval: intervals[i], needed: n, delta: n - alloc});
}
var oneHr = per[2].needed;
var twoHr = per[3].needed;
var fourHr = per[4].needed;
var pn = Math.max(Math.round((oneHr + twoHr + fourHr) / 3), minA);
return {
currentAlloc: alloc,
containerizeRate: avg,
arcType: getArcType(arcName),
unitsPerTote: applyUPT ? upt : null,
perInterval: per,
primaryDelta: pn - alloc,
primaryNeeded: pn,
minAlloc: minA
};
}

// calcDetailFromGQL — applies unitsPerTote conversion for _TOTE suffix arcs
function calcDetailFromGQL(arcName, projected, workcells) {
    if (isExcludedArc(arcName)) return null;
var avg = getAvg(arcName);
var cfg = getConfig();
var applyUPT = isToteSuffix(arcName);
var upt = applyUPT ? cfg.unitsPerTote : 1;
var intervalKeys = ['MIN_15', 'MIN_30', 'HR_1', 'HR_2', 'HR_4', 'HR_8', 'HR_24'];
var wip = [];
for (var k = 0; k < intervalKeys.length; k++) {
var found = 0;
for (var j = 0; j < projected.length; j++) {
if (projected[j].interval === intervalKeys[k]) {
found = projected[j].rate || 0;
break;
}
}
wip.push(found);
}
var alloc = 0;
for (var i = 0; i < workcells.length; i++) {
var wcName = (workcells[i].id && workcells[i].id.name) ? workcells[i].id.name : '';
if (!containsPID(wcName)) alloc++;
}
console.log('[AllocRec] GQL | arc: ' + arcName + ' | rate: ' + avg + ' JPH | upt: ' + upt + ' | wip: ' + JSON.stringify(wip) + ' | alloc: ' + alloc);
var minA = 0;
for (var i = 0; i < 4; i++) {
if (wip[i] > 0) { minA = 1; break; }
}
var intervals = ['15 MIN', '30 MIN', '1 HR', '2 HR', '4 HR', '8 HR', '24 HR'];
var hm = [0.25, 0.5, 1, 2, 4, 8, 24];
var per = [];
for (var i = 0; i < wip.length; i++) {
var n = 0;
if (wip[i] > 0) n = Math.round((wip[i] / upt) / hm[i] / avg);
n = Math.max(n, minA);
per.push({interval: intervals[i], needed: n, delta: n - alloc});
}
var oneHr = per[2].needed;
var twoHr = per[3].needed;
var fourHr = per[4].needed;
var pn = Math.max(Math.round((oneHr + twoHr + fourHr) / 3), minA);
return {
currentAlloc: alloc,
containerizeRate: avg,
arcType: getArcType(arcName),
unitsPerTote: applyUPT ? upt : null,
perInterval: per,
primaryDelta: pn - alloc,
primaryNeeded: pn,
minAlloc: minA
};
}

function fetchArcData(siteName, arcName) {
var token = localStorage.getItem('dockflow.localStorageIdToken');
var body = JSON.stringify({
operationName: 'getOutboundArc',
query: GQL_QUERY,
variables: {siteName: siteName, outboundArcName: arcName}
});
return fetch(GRAPHQL_ENDPOINT, {
method: 'POST',
headers: {
'Content-Type': 'application/json',
'Authorization': 'Bearer ' + token
},
body: body
}).then(function(resp) {
if (!resp.ok) throw new Error('HTTP ' + resp.status);
return resp.json();
}).then(function(json) {
var arc = json && json.data && json.data.outboundArc;
if (!arc) return null;
var projected = (arc.workState && arc.workState.rate && arc.workState.rate.projected) || [];
var workcells = arc.workcells || [];
return {projected: projected, workcells: workcells};
}).catch(function(e) {
console.warn('[AllocRec] fetchArcData error for ' + arcName + ': ' + e);
return null;
});
}

// 30-minute median burst cycle, 3 samples 10 minutes apart.
// First-cycle baseline protection: Cycle 1 is preliminary, Cycle 2 confirms by
// taking the max of both medians. Cycle 3+ uses normal rules: increases immediate,
// decreases require two consecutive cycles.
//
// During configured dark windows the script holds the last rendered recommendation
// and skips all sampling. When the dark window ends a fresh burst cycle starts
// with first-cycle baseline protection (detailCycleCount reset to 0).

var detailSamples = [];
var detailBurstTimer = null;
var detailCycleTimer = null;
var detailDarkTimer = null;
var detailPendingDecrease = null;
var detailCycleCount = 0;
var detailCycle1Median = null;

var BURST_INTERVAL_MS = 600000;  // 10 minutes between samples
var BURST_COUNT = 3;             // 3 samples per burst
var CYCLE_MS = 1800000;          // 30 minutes between burst cycles

function medianOf(arr) {
if (!arr.length) return 0;
var sorted = arr.slice().sort(function(a, b) { return a - b; });
var mid = Math.floor(sorted.length / 2);
return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Show the held-recommendation badge during a dark window
function renderDarkWindowBadge() {
var badge = document.getElementById('alloc-rec-badge');
if (!badge) return;
badge.className = 'dark-window';
badge.textContent = '\uD83C\uDF19 Paused \u2014 dark window active';
}

// Clear all running timers (burst + cycle + dark)
function clearAllDetailTimers() {
if (detailBurstTimer) { clearTimeout(detailBurstTimer); detailBurstTimer = null; }
if (detailCycleTimer) { clearTimeout(detailCycleTimer); detailCycleTimer = null; }
if (detailDarkTimer)  { clearTimeout(detailDarkTimer);  detailDarkTimer  = null; }
}

// Called when a dark window is detected. Holds the badge and waits for exit.
function pauseForDarkWindow() {
clearAllDetailTimers();
detailSamples = [];
renderDarkWindowBadge();
var wait = msUntilDarkWindowEnd();
console.log('[AllocRec] Dark window active \u2014 pausing ' + Math.round(wait / 60000) + ' min');
detailDarkTimer = setTimeout(function() {
detailDarkTimer = null;
console.log('[AllocRec] Dark window ended \u2014 starting fresh cycle (baseline protection)');
detailCycleCount = 0;
detailCycle1Median = null;
detailPendingDecrease = null;
startDetailBurst();
}, wait);
}

function renderDetailWithSample(rec) {
if (!rec) return;
detailSamples.push(rec.primaryNeeded);
if (detailSamples.length === 1) {
renderDetailBadge(rec);
}
if (detailSamples.length >= BURST_COUNT) {
var medianNeeded = medianOf(detailSamples);
var alloc = rec.currentAlloc;
var delta = medianNeeded - alloc;
var stableRec = Object.assign({}, rec, {
primaryNeeded: medianNeeded,
primaryDelta: delta
});
if (detailCycleCount === 0) {
detailCycle1Median = medianNeeded;
detailCycleCount = 1;
renderDetailBadge(stableRec);
console.log('[AllocRec] Detail burst Cycle 1 (preliminary) | samples: ' + detailSamples.join(',') + ' | median: ' + medianNeeded);
} else if (detailCycleCount === 1) {
var confirmedNeeded = Math.max(detailCycle1Median, medianNeeded);
var confirmedDelta = confirmedNeeded - alloc;
var confirmedRec = Object.assign({}, rec, {
primaryNeeded: confirmedNeeded,
primaryDelta: confirmedDelta
});
detailCycleCount = 2;
detailPendingDecrease = null;
renderDetailBadge(confirmedRec);
console.log('[AllocRec] Detail burst Cycle 2 (confirmed) | c1: ' + detailCycle1Median + ' | c2: ' + medianNeeded + ' | confirmed: ' + confirmedNeeded);
} else {
if (delta > 0) {
detailPendingDecrease = null;
renderDetailBadge(stableRec);
console.log('[AllocRec] Detail burst complete (increase) | samples: ' + detailSamples.join(',') + ' | median: ' + medianNeeded);
} else if (delta < 0) {
if (detailPendingDecrease !== null && detailPendingDecrease === medianNeeded) {
renderDetailBadge(stableRec);
console.log('[AllocRec] Detail burst complete (decrease confirmed) | samples: ' + detailSamples.join(',') + ' | median: ' + medianNeeded);
detailPendingDecrease = null;
} else {
detailPendingDecrease = medianNeeded;
console.log('[AllocRec] Detail burst complete (decrease pending) | samples: ' + detailSamples.join(',') + ' | median: ' + medianNeeded);
}
} else {
detailPendingDecrease = null;
renderDetailBadge(stableRec);
console.log('[AllocRec] Detail burst complete (no-change) | samples: ' + detailSamples.join(',') + ' | median: ' + medianNeeded);
}
}
detailSamples = [];
if (detailBurstTimer) { clearTimeout(detailBurstTimer); detailBurstTimer = null; }
if (detailCycleTimer) clearTimeout(detailCycleTimer);
detailCycleTimer = setTimeout(function() {
detailCycleTimer = null;
if (isInDarkWindow()) {
pauseForDarkWindow();
} else {
startDetailBurst();
}
}, CYCLE_MS);
}
}

function startDetailBurst() {
    if (detailCycleTimer || detailBurstTimer) return;
    if (isInDarkWindow()) {
        var rec = calcDetail();
        if (rec) renderDetailBadge(rec);
        var wait = msUntilDarkWindowEnd();
        console.log('[AllocRec] Dark window - showing preliminary, real cycle in ' + Math.round(wait / 60000) + ' min');
        detailDarkTimer = setTimeout(function() {
            detailDarkTimer = null;
            detailCycleCount = 0;
            detailCycle1Median = null;
            detailPendingDecrease = null;
            startDetailBurst();
        }, wait);
        return;
    }
    detailSamples = [];
    var count = 0;
    function takeSample() {
        if (isInDarkWindow()) {
            pauseForDarkWindow();
            return;
        }
        var rec = calcDetail();
        renderDetailWithSample(rec);
        count++;
        if (count < BURST_COUNT) {
            detailBurstTimer = setTimeout(takeSample, BURST_INTERVAL_MS);
        }
    }
    takeSample();
}


function renderDetailBadge(rec) {
var badge = document.getElementById('alloc-rec-badge');
if (!badge) {
badge = document.createElement('span');
badge.id = 'alloc-rec-badge';
var hdr = findAssignH2();
if (hdr) {
hdr.appendChild(badge);
} else {
console.warn('[AllocRec] No Arc Assignments heading found');
return;
}
}
if (!document.getElementById('alloc-rec-settings-btn') && badge.parentElement) {
var sb = document.createElement('button');
sb.id = 'alloc-rec-settings-btn';
sb.textContent = '\u2699\uFE0F';
sb.title = 'Settings';
sb.addEventListener('click', function(e) {
e.stopPropagation();
showSettings();
});
badge.parentElement.appendChild(sb);
}
if (!rec) {
badge.className = 'no-change';
badge.textContent = '\u2753 Unable to calculate';
return;
}
var d = rec.primaryDelta;
if (d > 0) {
badge.className = 'increase';
badge.innerHTML = '\u25B2 +' + d + ' allocation' + (d > 1 ? 's' : '') + ' recommended (need ~' + rec.primaryNeeded + ')';
} else if (d < 0) {
badge.className = 'decrease';
badge.innerHTML = '\u25BC ' + d + ' allocation' + (Math.abs(d) > 1 ? 's' : '') + ' recommended (need ~' + rec.primaryNeeded + ')';
} else {
badge.className = 'no-change';
badge.innerHTML = '\u2714 Allocations on target (' + rec.currentAlloc + ')';
}
var label = document.getElementById('alloc-rec-forecast-label');
var row = document.getElementById('alloc-rec-forecast-row');
if (!rec.perInterval) {
if (row) row.remove();
if (label) label.remove();
return;
}
var box = findFutureBox();
if (!box) return;
if (!label) {
label = document.createElement('div');
label.id = 'alloc-rec-forecast-label';
box.appendChild(label);
}
var labelText = 'Needed Allocations (' + rec.containerizeRate + ' JPH ' + rec.arcType;
if (rec.unitsPerTote !== null) {
labelText += ' | ' + rec.unitsPerTote + ' UPT';
}
labelText += ')';
label.textContent = labelText;
if (!row) {
row = document.createElement('div');
row.id = 'alloc-rec-forecast-row';
box.appendChild(row);
}
var html = '';
for (var i = 0; i < rec.perInterval.length; i++) {
var p = rec.perInterval[i];
html += '<div class="alloc-cell">' + p.needed + '</div>';
}
row.innerHTML = html;
}

function renderDetail() {
startDetailBurst();
}

function renderList() {
if (listLoaded) return;
var rows = document.querySelectorAll('tr');
var count = 0;
console.log('[AllocRec] List | TRs: ' + rows.length);
var arcRows = [];
for (var r = 0; r < rows.length; r++) {
var cells = rows[r].querySelectorAll('td');
if (cells.length < 5) continue;
var name = cells[0].textContent.trim();
if (!name || name.length < 3 || !/[A-Za-z]/.test(name)) continue;
if ((/^arc\s*name$/i).test(name)) continue;
    if (isExcludedArc(name)) continue;
arcRows.push({row: rows[r], name: name, aCell: cells[4]});
}
console.log('[AllocRec] List | arc rows found: ' + arcRows.length);
if (arcRows.length === 0) {
if (!document.getElementById('alloc-rec-list-settings-btn')) {
var ah = findH2('arcs');
if (ah) {
var gb = document.createElement('button');
gb.id = 'alloc-rec-list-settings-btn';
gb.textContent = '\u2699\uFE0F';
gb.title = 'Settings';
gb.style.cssText = 'cursor:pointer;background:none;border:none;font-size:16px;margin-left:6px;vertical-align:middle;opacity:0.7;';
gb.addEventListener('click', function(e) {
e.stopPropagation();
showSettings();
});
ah.appendChild(gb);
}
}
return;
}
listLoaded = true;
for (var i = 0; i < arcRows.length; i++) {
var oldBadge = arcRows[i].row.querySelector('.alloc-rec-list-badge');
if (oldBadge) oldBadge.remove();
var lb = document.createElement('span');
lb.className = 'alloc-rec-list-badge same';
lb.textContent = '\u23F3';
lb.title = 'Loading...';
arcRows[i].aCell.appendChild(lb);
arcRows[i].loadBadge = lb;
}
var siteName = getSiteName();
var pending = 0;
var MAX_CONCURRENT = 3;
var idx = 0;
function processNext() {
while (pending < MAX_CONCURRENT && idx < arcRows.length) {
(function(arcRow) {
pending++;
fetchArcData(siteName, arcRow.name).then(function(data) {
pending--;
var lb = arcRow.loadBadge;
if (lb) lb.remove();
var b = document.createElement('span');
b.className = 'alloc-rec-list-badge';
if (!data) {
b.className += ' same';
b.textContent = '\u2753';
b.title = 'API error for ' + arcRow.name;
} else {
var rec = calcDetailFromGQL(arcRow.name, data.projected, data.workcells);
if (!rec) {
b.className += ' same';
b.textContent = '\u2753';
b.title = 'Unable to calculate';
} else {
var delta = rec.primaryDelta;
if (delta > 0) {
b.className += ' up';
b.textContent = '\u25B2 +' + delta;
b.title = 'Need ~' + rec.primaryNeeded + ', currently ' + rec.currentAlloc;
} else if (delta < 0) {
b.className += ' down';
b.textContent = '\u25BC ' + delta;
b.title = 'Need ~' + rec.primaryNeeded + ', currently ' + rec.currentAlloc;
} else {
b.className += ' same';
b.textContent = '\u2714';
b.title = 'On target (' + rec.currentAlloc + ')';
}
console.log('[AllocRec] Row: ' + arcRow.name + ' | need: ' + rec.primaryNeeded + ' | alloc: ' + rec.currentAlloc + ' | delta: ' + delta);
}
}
arcRow.aCell.appendChild(b);
processNext();
});
})(arcRows[idx]);
idx++;
}
}
processNext();
if (!document.getElementById('alloc-rec-list-settings-btn')) {
var ah = findH2('arcs');
if (ah) {
var gb = document.createElement('button');
gb.id = 'alloc-rec-list-settings-btn';
gb.textContent = '\u2699\uFE0F';
gb.title = 'Settings';
gb.style.cssText = 'cursor:pointer;background:none;border:none;font-size:16px;margin-left:6px;vertical-align:middle;opacity:0.7;';
gb.addEventListener('click', function(e) {
e.stopPropagation();
showSettings();
});
ah.appendChild(gb);
}
}
}

function cleanup() {
var ids = ['alloc-rec-badge', 'alloc-rec-settings-btn', 'alloc-rec-forecast-label', 'alloc-rec-forecast-row', 'alloc-rec-list-settings-btn'];
for (var i = 0; i < ids.length; i++) {
var el = document.getElementById(ids[i]);
if (el) el.remove();
}
var bb = document.querySelectorAll('.alloc-rec-list-badge');
for (var i = 0; i < bb.length; i++) bb[i].remove();
listLoaded = false;
detailSamples = [];
detailPendingDecrease = null;
detailCycleCount = 0;
detailCycle1Median = null;
clearAllDetailTimers();
}

function run() {
    console.log('[AllocRec] run | detail: ' + isDetail() + ' | list: ' + isList());
    if (isDetail()) {
        var arcName = getArcName();
        if (arcName && isExcludedArc(arcName)) {
            var existing = document.querySelector('.alloc-badge');
            if (existing) existing.remove();
            clearTimeout(detailBurstTimer);
            clearTimeout(detailCycleTimer);
            detailBurstTimer = null;
            detailCycleTimer = null;
            return;
        }
        renderDetail();
    }
    if (isList()) renderList();
}

function startObs() {
var obs = new MutationObserver(function() {
clearTimeout(obs._db);
obs._db = setTimeout(run, 1500);
});
obs.observe(document.body, {childList: true, subtree: true, characterData: true});
}

function init() {
cleanup();
console.log('[AllocRec] init | path: ' + path);
var ck = setInterval(function() {
if (isDetail()) {
var h = findAssignH2();
var w = scrapeFuture();
if (h && w) {
clearInterval(ck);
console.log('[AllocRec] Detail ready');
run();
startObs();
}
} else if (isList()) {
var tds = document.querySelectorAll('tr td');
if (tds.length > 0) {
clearInterval(ck);
console.log('[AllocRec] List ready | TDs: ' + tds.length);
run();
startObs();
}
}
}, 500);
setTimeout(function() {
clearInterval(ck);
console.log('[AllocRec] Timeout');
}, 30000);
}

var lastUrl = location.href;
new MutationObserver(function() {
if (location.href !== lastUrl) {
lastUrl = location.href;
path = window.location.pathname;
console.log('[AllocRec] Nav: ' + path);
setTimeout(init, 1000);
}
}).observe(document, {subtree: true, childList: true});

init();

})();

