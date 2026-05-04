// ==UserScript==
// @name         DockFlow Allocation Recommender
// @namespace    http://tampermonkey.net/
// @version      3.9.1
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
console.log('[AllocRec] v3.9.1 loaded | path: ' + path);

var style = document.createElement('style');
style.textContent = [
'#alloc-rec-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:16px;font-size:13px;font-weight:600;margin-left:10px;vertical-align:middle}',
'#alloc-rec-badge.increase{background:#fde8e8;color:#b91c1c;border:1px solid #f87171}',
'#alloc-rec-badge.decrease{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}',
'#alloc-rec-badge.no-change{background:#e0e7ff;color:#3730a3;border:1px solid #a5b4fc}',
'#alloc-rec-badge.paused{background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1}',
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
'.alloc-rec-list-badge.same{color:#3730a3}',
'.alloc-rec-list-badge.paused{color:#94a3b8}'
].join('');
document.head.appendChild(style);

var CONFIG_KEY = 'dockflow_alloc_config';

var DEFAULTS = {
containerizeRateCase: 85,
containerizeRateTote: 75,
unitsPerTote: 3.5,
dayShiftStart: '07:30',
dayShiftEnd: '18:00',
nightShiftStart: '18:30',
nightShiftEnd: '05:00'
};

var listLoaded = false;

var EXCLUDED_ARCS = ['WMS_KICKOUT', 'KICKOUT', 'DZ-P'];

var SOS_RAMP_MINUTES = 30;

// --- STABILITY PERSISTENCE ------------------------------------------------
// v3.9.1 KEY CHANGE: list view reads sessionStorage cache written by detail view.
// This ensures both views always show the same recommendation for a given arc.
var STABILITY_KEY = 'allocRec_stability_';
var LIST_CACHE_KEY = 'allocRec_listCache';
var LIST_CACHE_TIME_KEY = 'allocRec_listCacheTime';

function getStabilityState(arcKey) {
    try {
        var raw = sessionStorage.getItem(STABILITY_KEY + arcKey);
        if (raw) return JSON.parse(raw);
    } catch(e) {}
    return {delta: null, needed: null, alloc: null, lastCheckTime: 0, pendingDecreaseCount: 0, consensus: null};
}

function setStabilityState(arcKey, state) {
    sessionStorage.setItem(STABILITY_KEY + arcKey, JSON.stringify(state));
}

function getDecreaseCount(arcKey) {
    try {
        var raw = sessionStorage.getItem('allocRec_decCount_' + arcKey);
        return raw ? parseInt(raw, 10) : 0;
    } catch(e) { return 0; }
}

function setDecreaseCount(arcKey, count) {
    sessionStorage.setItem('allocRec_decCount_' + arcKey, String(count));
}
// --- END STABILITY PERSISTENCE --------------------------------------------

function isExcludedArc(name) {
var upper = name.toUpperCase();
for (var i = 0; i < EXCLUDED_ARCS.length; i++) {
if (upper.indexOf(EXCLUDED_ARCS[i]) !== -1) return true;
}
return false;
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
'        aggregateRate',
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
unitsPerTote: (p.unitsPerTote !== undefined) ? p.unitsPerTote : DEFAULTS.unitsPerTote,
dayShiftStart: (p.dayShiftStart !== undefined) ? p.dayShiftStart : DEFAULTS.dayShiftStart,
dayShiftEnd: (p.dayShiftEnd !== undefined) ? p.dayShiftEnd : DEFAULTS.dayShiftEnd,
nightShiftStart: (p.nightShiftStart !== undefined) ? p.nightShiftStart : DEFAULTS.nightShiftStart,
nightShiftEnd: (p.nightShiftEnd !== undefined) ? p.nightShiftEnd : DEFAULTS.nightShiftEnd
};
}
} catch (e) {}
return {
containerizeRateCase: DEFAULTS.containerizeRateCase,
containerizeRateTote: DEFAULTS.containerizeRateTote,
unitsPerTote: DEFAULTS.unitsPerTote,
dayShiftStart: DEFAULTS.dayShiftStart,
dayShiftEnd: DEFAULTS.dayShiftEnd,
nightShiftStart: DEFAULTS.nightShiftStart,
nightShiftEnd: DEFAULTS.nightShiftEnd
};
}

function saveConfig(cfg) {
localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// --- SHIFT HELPERS --------------------------------------------------------

function parseHHMM(str) {
var parts = str.trim().split(':');
if (parts.length !== 2) return null;
var h = parseInt(parts[0], 10);
var m = parseInt(parts[1], 10);
if (isNaN(h) || isNaN(m)) return null;
return h * 60 + m;
}

function getActiveShiftEnd() {
var cfg = getConfig();
var now = new Date();
var cur = now.getHours() * 60 + now.getMinutes();
var dayStart  = parseHHMM(cfg.dayShiftStart);
var dayEnd    = parseHHMM(cfg.dayShiftEnd);
var nightStart = parseHHMM(cfg.nightShiftStart);
var nightEnd  = parseHHMM(cfg.nightShiftEnd);
if (dayStart !== null && dayEnd !== null && cur >= dayStart && cur < dayEnd) {
return dayEnd;
}
if (nightStart !== null && nightEnd !== null) {
if (nightEnd < nightStart) {
if (cur >= nightStart || cur < nightEnd) return nightEnd;
} else {
if (cur >= nightStart && cur < nightEnd) return nightEnd;
}
}
return null;
}

function isInActiveShift() {
return getActiveShiftEnd() !== null;
}

function isInAutoFreeze() {
var shiftEnd = getActiveShiftEnd();
if (shiftEnd === null) return false;
var now = new Date();
var cur = now.getHours() * 60 + now.getMinutes();
var diff;
if (shiftEnd < cur) {
diff = (1440 - cur) + shiftEnd;
} else {
diff = shiftEnd - cur;
}
return diff <= 45 && diff > 0;
}

function isInSosRamp() {
var cfg = getConfig();
var now = new Date();
var cur = now.getHours() * 60 + now.getMinutes();
var dayStart   = parseHHMM(cfg.dayShiftStart);
var nightStart = parseHHMM(cfg.nightShiftStart);
if (dayStart !== null) {
var elapsed = cur - dayStart;
if (elapsed >= 0 && elapsed < SOS_RAMP_MINUTES) return true;
}
if (nightStart !== null) {
if (cur >= nightStart) {
var elapsed = cur - nightStart;
if (elapsed >= 0 && elapsed < SOS_RAMP_MINUTES) return true;
} else {
var elapsed = (1440 - nightStart) + cur;
if (elapsed >= 0 && elapsed < SOS_RAMP_MINUTES) return true;
}
}
return false;
}

function clampDelta(delta) {
if (isInSosRamp() && delta < 0) {
console.log('[AllocRec] SOS ramp active, clamping decrease to 0');
return 0;
}
return delta;
}

// --- END SHIFT HELPERS ----------------------------------------------------

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
'<label for="alloc-cfg-upt">Units Per Tote</label>' +
'<input type="number" id="alloc-cfg-upt" value="' + cfg.unitsPerTote + '" min="0.1" step="0.5" />' +
'<label for="alloc-cfg-ds">Day Shift Start (HH:MM)</label>' +
'<input type="text" id="alloc-cfg-ds" value="' + cfg.dayShiftStart + '" placeholder="07:30" />' +
'<label for="alloc-cfg-de">Day Shift End (HH:MM)</label>' +
'<input type="text" id="alloc-cfg-de" value="' + cfg.dayShiftEnd + '" placeholder="18:00" />' +
'<label for="alloc-cfg-ns">Night Shift Start (HH:MM)</label>' +
'<input type="text" id="alloc-cfg-ns" value="' + cfg.nightShiftStart + '" placeholder="18:30" />' +
'<label for="alloc-cfg-ne">Night Shift End (HH:MM)</label>' +
'<input type="text" id="alloc-cfg-ne" value="' + cfg.nightShiftEnd + '" placeholder="05:00" />' +
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
var c   = parseInt(document.getElementById('alloc-cfg-cases').value) || DEFAULTS.containerizeRateCase;
var t   = parseInt(document.getElementById('alloc-cfg-totes').value) || DEFAULTS.containerizeRateTote;
var upt = parseFloat(document.getElementById('alloc-cfg-upt').value) || DEFAULTS.unitsPerTote;
var ds  = document.getElementById('alloc-cfg-ds').value.trim();
var de  = document.getElementById('alloc-cfg-de').value.trim();
var ns  = document.getElementById('alloc-cfg-ns').value.trim();
var ne  = document.getElementById('alloc-cfg-ne').value.trim();
saveConfig({
containerizeRateCase: c,
containerizeRateTote: t,
unitsPerTote: upt,
dayShiftStart: ds,
dayShiftEnd: de,
nightShiftStart: ns,
nightShiftEnd: ne
});
ov.remove();
listLoaded = false;
clearDetailTimer();
clearListTimer();
run();
});
}

// --- CALCULATION FUNCTIONS ------------------------------------------------
// v3.9.1 consensus model: all three windows (1HR, 2HR, 4HR) must agree
// on direction vs current allocation before recommending a change.
// When consensus exists, the recommendation increments/decrements by 1.
// Decreases require 3 consecutive unanimous checks before firing.
// Results are written to sessionStorage so the list view can read them
// directly instead of recalculating independently.

function consensusCalc(perInterval, alloc, minA, arcKey) {
var oneHr  = perInterval[2].needed;
var twoHr  = perInterval[3].needed;
var fourHr = perInterval[4].needed;

var dir1 = oneHr  > alloc ? 1 : (oneHr  < alloc ? -1 : 0);
var dir2 = twoHr  > alloc ? 1 : (twoHr  < alloc ? -1 : 0);
var dir4 = fourHr > alloc ? 1 : (fourHr < alloc ? -1 : 0);

var pn;
var consensus;

if (dir1 > 0 && dir2 > 0 && dir4 > 0) {
    pn = alloc + 1;
    consensus = 'increase';
    setDecreaseCount(arcKey, 0);
} else if (dir1 < 0 && dir2 < 0 && dir4 < 0) {
    setDecreaseCount(arcKey, getDecreaseCount(arcKey) + 1);
    if (getDecreaseCount(arcKey) >= 3) {
        pn = alloc - 1;
        pn = Math.max(pn, minA);
        consensus = 'decrease';
    } else {
        pn = alloc;
        consensus = 'pending-decrease (' + getDecreaseCount(arcKey) + '/3)';
    }
} else {
    pn = alloc;
    consensus = 'none';
    setDecreaseCount(arcKey, 0);
}

var delta = clampDelta(pn - alloc);

console.log('[AllocRec] Consensus | ' + arcKey + ' | 1HR=' + oneHr + ' 2HR=' + twoHr + ' 4HR=' + fourHr +
    ' | dirs=' + dir1 + '/' + dir2 + '/' + dir4 +
    ' | consensus=' + consensus + ' | target=' + pn + ' | delta=' + delta);

return {primaryNeeded: pn, primaryDelta: delta, consensus: consensus};
}


function calcDetail() {
var arcName = getArcName();
if (isExcludedArc(arcName)) return null;
var avg = getAvg(arcName);
var wip = scrapeFuture();
var alloc = scrapeAlloc();
console.log('[AllocRec] Detail | arc: ' + arcName + ' | type: ' + getArcType(arcName) + ' | rate: ' + avg + ' JPH | wip: ' + JSON.stringify(wip) + ' | alloc: ' + alloc);
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
var w = (getArcType(arcName) === 'TOTE') ? wip[i] / getConfig().unitsPerTote : wip[i];
if (w > 0) n = Math.round(w / hm[i] / avg);
n = Math.max(n, minA);
per.push({interval: intervals[i], needed: n, delta: n - alloc});
}
var result = consensusCalc(per, alloc, minA, arcName);
return {
currentAlloc:      alloc,
containerizeRate:  avg,
arcType:           getArcType(arcName),
perInterval:       per,
primaryDelta:      result.primaryDelta,
primaryNeeded:     result.primaryNeeded,
minAlloc:          minA,
consensus:         result.consensus
};
}

// calcDetailFromGQL is used ONLY by the list view for arcs that have no cached
// sessionStorage state yet (e.g. the operator has not yet visited the detail page).
// v3.9.1: calcDetailFromGQL does NOT call consensusCalc; it returns a raw
// calculation marked as preliminary. The list view prefers the sessionStorage
// cache from the detail view whenever available.
function calcDetailFromGQL(arcName, projected, workcells) {
if (isExcludedArc(arcName)) return null;
var avg = getAvg(arcName);
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
console.log('[AllocRec] GQL raw | arc: ' + arcName + ' | rate: ' + avg + ' JPH | wip: ' + JSON.stringify(wip) + ' | alloc: ' + alloc);
var minA = 0;
for (var i = 0; i < 4; i++) {
if (wip[i] > 0) { minA = 1; break; }
}
var intervals = ['15 MIN', '30 MIN', '1 HR', '2 HR', '4 HR', '8 HR', '24 HR'];
var hm = [0.25, 0.5, 1, 2, 4, 8, 24];
var per = [];
for (var i = 0; i < wip.length; i++) {
var n = 0;
var w = (getArcType(arcName) === 'TOTE') ? wip[i] / getConfig().unitsPerTote : wip[i];
if (w > 0) n = Math.round(w / hm[i] / avg);
n = Math.max(n, minA);
per.push({interval: intervals[i], needed: n, delta: n - alloc});
}
// Raw average of 1HR + 2HR + 4HR (no consensus gate, no stability rules)
var oneHr  = per[2].needed;
var twoHr  = per[3].needed;
var fourHr = per[4].needed;
var pn = Math.max(Math.round((oneHr + twoHr + fourHr) / 3), minA);
var delta = pn - alloc;
return {
currentAlloc:      alloc,
containerizeRate:  avg,
arcType:           getArcType(arcName),
perInterval:       per,
primaryDelta:      delta,
primaryNeeded:     pn,
minAlloc:          minA,
consensus:         'preliminary'
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
var projected     = (arc.workState && arc.workState.rate && arc.workState.rate.projected) || [];
var workcells     = arc.workcells || [];
var aggregateRate = (arc.workState && arc.workState.rate) ? (arc.workState.rate.aggregateRate || 0) : 0;
return {projected: projected, workcells: workcells, aggregateRate: aggregateRate};
}).catch(function(e) {
console.warn('[AllocRec] fetchArcData error for ' + arcName + ': ' + e);
return null;
});
}

// --- DETAIL VIEW RENDERING ------------------------------------------------

var detailRefreshTimer = null;
var REFRESH_INTERVAL_MS = 1200000; // 20 minutes

function clearDetailTimer() {
if (detailRefreshTimer) { clearTimeout(detailRefreshTimer); detailRefreshTimer = null; }
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
// Render per-interval forecast row
var label = document.getElementById('alloc-rec-forecast-label');
var row   = document.getElementById('alloc-rec-forecast-row');
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
label.textContent = 'Needed Allocations (' + rec.containerizeRate + ' JPH ' + rec.arcType + ')';
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

function renderDetailPaused() {
var badge = document.getElementById('alloc-rec-badge');
if (!badge) {
badge = document.createElement('span');
badge.id = 'alloc-rec-badge';
var hdr = findAssignH2();
if (hdr) {
hdr.appendChild(badge);
} else {
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
badge.className = 'paused';
badge.textContent = '\u23F8 Outside shift hours';
}

function waitForShiftStart() {
clearDetailTimer();
clearListTimer();
detailRefreshTimer = setTimeout(function() {
if (isInActiveShift()) {
console.log('[AllocRec] Shift started, activating');
listLoaded = false;
run();
} else {
waitForShiftStart();
}
}, 60000);
}

function runDetailRefresh() {
if (!isInActiveShift()) {
console.log('[AllocRec] Outside shift hours, pausing');
renderDetailPaused();
waitForShiftStart();
return;
}
if (isInAutoFreeze()) {
console.log('[AllocRec] Auto-freeze active, holding badge');
scheduleDetailRefresh();
return;
}
var rec = calcDetail();
renderDetailBadge(rec);
// v3.9.1: persist result to sessionStorage so list view can read it
if (rec) {
var arcName = getArcName();
setStabilityState(arcName, {
    delta:                rec.primaryDelta,
    needed:               rec.primaryNeeded,
    alloc:                rec.currentAlloc,
    lastCheckTime:        Date.now(),
    pendingDecreaseCount: getDecreaseCount(arcName),
    consensus:            rec.consensus
});
}
console.log('[AllocRec] Detail refreshed | delta: ' + (rec ? rec.primaryDelta : 'null'));
scheduleDetailRefresh();
}

function scheduleDetailRefresh() {
clearDetailTimer();
detailRefreshTimer = setTimeout(runDetailRefresh, REFRESH_INTERVAL_MS);
}

function renderDetail() {
if (detailRefreshTimer) return;
if (!isInActiveShift()) {
console.log('[AllocRec] Outside shift hours, showing paused badge');
renderDetailPaused();
waitForShiftStart();
return;
}
var arcName = getArcName();
var ss  = getStabilityState(arcName);
var now = Date.now();
// Use cached sessionStorage badge if within the 20-minute refresh window
if (ss.delta !== null && (now - ss.lastCheckTime) < REFRESH_INTERVAL_MS) {
console.log('[AllocRec] Detail using cached badge for ' + arcName + ' | delta: ' + ss.delta);
renderDetailBadge({
    primaryDelta:   ss.delta,
    primaryNeeded:  ss.needed,
    currentAlloc:   ss.alloc,
    consensus:      ss.consensus
});
// Rebuild forecast row with a fresh DOM scrape since the badge is cached
var rec = calcDetail();
if (rec) renderDetailBadge(rec);
scheduleDetailRefresh();
return;
}
var rec = calcDetail();
renderDetailBadge(rec);
if (rec) {
setStabilityState(arcName, {
    delta:                rec.primaryDelta,
    needed:               rec.primaryNeeded,
    alloc:                rec.currentAlloc,
    lastCheckTime:        now,
    pendingDecreaseCount: getDecreaseCount(arcName),
    consensus:            rec.consensus
});
}
console.log('[AllocRec] Detail initial render | delta: ' + (rec ? rec.primaryDelta : 'null'));
scheduleDetailRefresh();
}

// --- LIST VIEW ------------------------------------------------------------
// v3.9.1 KEY FIX: renderList now reads sessionStorage (written by detail view)
// for each arc before falling back to a fresh GQL fetch + raw calculation.
// This guarantees the list view always matches the detail view for arcs the
// operator has already drilled into.

var listRefreshTimer = null;

function clearListTimer() {
if (listRefreshTimer) { clearTimeout(listRefreshTimer); listRefreshTimer = null; }
}

function scheduleListRefresh() {
clearListTimer();
listRefreshTimer = setTimeout(runListRefresh, REFRESH_INTERVAL_MS);
}

function runListRefresh() {
if (!isInActiveShift()) {
console.log('[AllocRec] List refresh outside shift hours, pausing');
waitForShiftStart();
return;
}
if (isInAutoFreeze()) {
console.log('[AllocRec] List refresh auto-freeze active, holding badges');
scheduleListRefresh();
return;
}
console.log('[AllocRec] List refresh triggered');
var bb = document.querySelectorAll('.alloc-rec-list-badge');
for (var i = 0; i < bb.length; i++) bb[i].remove();
listLoaded = false;
renderList();
}

function renderList() {
if (listLoaded) return;

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

if (!isInActiveShift()) {
console.log('[AllocRec] List view outside shift hours, skipping');
waitForShiftStart();
return;
}

var rows = document.querySelectorAll('tr');
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
scheduleListRefresh();
return;
}
listLoaded = true;

// v3.9.1: separate arcs into cached (have sessionStorage state) and uncached
var cachedArcs   = [];
var uncachedArcs = [];
for (var i = 0; i < arcRows.length; i++) {
var ss = getStabilityState(arcRows[i].name);
var now = Date.now();
if (ss.delta !== null && (now - ss.lastCheckTime) < REFRESH_INTERVAL_MS) {
cachedArcs.push({arcRow: arcRows[i], ss: ss});
} else {
uncachedArcs.push(arcRows[i]);
}
}
console.log('[AllocRec] List | cached: ' + cachedArcs.length + ' | uncached: ' + uncachedArcs.length);

// Render cached arcs immediately from sessionStorage
for (var i = 0; i < cachedArcs.length; i++) {
var entry  = cachedArcs[i];
var arcRow = entry.arcRow;
var ss     = entry.ss;
var oldBadge = arcRow.row.querySelector('.alloc-rec-list-badge');
if (oldBadge) oldBadge.remove();
var b = document.createElement('span');
b.className = 'alloc-rec-list-badge';
var delta = ss.delta;
if (delta > 0) {
b.className += ' up';
b.textContent = '\u25B2 +' + delta;
b.title = 'Need ~' + ss.needed + ', currently ' + ss.alloc + ' (cached from detail view)';
} else if (delta < 0) {
b.className += ' down';
b.textContent = '\u25BC ' + delta;
b.title = 'Need ~' + ss.needed + ', currently ' + ss.alloc + ' (cached from detail view)';
} else {
b.className += ' same';
b.textContent = '\u2714';
b.title = 'On target (' + ss.alloc + ') (cached from detail view)';
}
arcRow.aCell.appendChild(b);
console.log('[AllocRec] List cached | ' + arcRow.name + ' | delta: ' + delta + ' | consensus: ' + ss.consensus);
}

// Show loading spinners for uncached arcs while GQL fetches run
for (var i = 0; i < uncachedArcs.length; i++) {
var oldBadge = uncachedArcs[i].row.querySelector('.alloc-rec-list-badge');
if (oldBadge) oldBadge.remove();
var lb = document.createElement('span');
lb.className = 'alloc-rec-list-badge same';
lb.textContent = '\u23F3';
lb.title = 'Loading...';
uncachedArcs[i].aCell.appendChild(lb);
uncachedArcs[i].loadBadge = lb;
}

if (uncachedArcs.length === 0) {
scheduleListRefresh();
return;
}

// Fetch GQL data for uncached arcs (preliminary, raw calc — no consensus gate)
var siteName       = getSiteName();
var pending        = 0;
var MAX_CONCURRENT = 3;
var idx            = 0;
var completed      = 0;
var total          = uncachedArcs.length;

function processNext() {
while (pending < MAX_CONCURRENT && idx < uncachedArcs.length) {
(function(arcRow) {
pending++;
fetchArcData(siteName, arcRow.name).then(function(data) {
pending--;
completed++;
var lb = arcRow.loadBadge;
if (lb) lb.remove();
var b = document.createElement('span');
b.className = 'alloc-rec-list-badge';
if (!data) {
b.className += ' same';
b.textContent = '\u2753';
b.title = 'API error for ' + arcRow.name;
} else {
// v3.9.1: check sessionStorage one more time in case detail view ran
// while GQL was in flight
var ss2  = getStabilityState(arcRow.name);
var now2 = Date.now();
var rec;
if (ss2.delta !== null && (now2 - ss2.lastCheckTime) < REFRESH_INTERVAL_MS) {
rec = {primaryDelta: ss2.delta, primaryNeeded: ss2.needed,
       currentAlloc: ss2.alloc, consensus: ss2.consensus + ' (late-cache)'};
} else {
rec = calcDetailFromGQL(arcRow.name, data.projected, data.workcells);
}
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
console.log('[AllocRec] Row: ' + arcRow.name + ' | need: ' + rec.primaryNeeded + ' | alloc: ' + rec.currentAlloc + ' | delta: ' + delta + ' | consensus: ' + rec.consensus);
}
}
arcRow.aCell.appendChild(b);
if (completed >= total) {
console.log('[AllocRec] List batch complete (' + total + ' uncached arcs), scheduling refresh');
scheduleListRefresh();
}
processNext();
});
})(uncachedArcs[idx]);
idx++;
}
}
processNext();
}

// --- CLEANUP / RUN / OBSERVER ---------------------------------------------

function cleanup() {
var ids = ['alloc-rec-badge', 'alloc-rec-settings-btn', 'alloc-rec-list-settings-btn'];
for (var i = 0; i < ids.length; i++) {
var el = document.getElementById(ids[i]);
if (el) el.remove();
}
var bb = document.querySelectorAll('.alloc-rec-list-badge');
for (var i = 0; i < bb.length; i++) bb[i].remove();
listLoaded = false;
clearDetailTimer();
clearListTimer();
}

function run() {
console.log('[AllocRec] run | detail: ' + isDetail() + ' | list: ' + isList() + ' | inShift: ' + isInActiveShift() + ' | sosRamp: ' + isInSosRamp() + ' | autoFreeze: ' + isInAutoFreeze());
if (isDetail()) {
var arcName = getArcName();
if (arcName && isExcludedArc(arcName)) {
var existing = document.querySelector('.alloc-badge');
if (existing) existing.remove();
clearDetailTimer();
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
if (h && (w || !isInActiveShift())) {
clearInterval(ck);
console.log('[AllocRec] Detail ready');
run();
startObs();
}
} else if (isList()) {
var tds = document.querySelectorAll('tr td');
if (tds.length > 0 || !isInActiveShift()) {
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
path    = window.location.pathname;
console.log('[AllocRec] Nav: ' + path);
setTimeout(init, 1000);
}
}).observe(document, {subtree: true, childList: true});

init();

})();
