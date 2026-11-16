'use strict';
// Grid math for the virtual table (no DOM). Taken from Zovo's Table Viewer (src/webview/math.js), same author.

const MAX_BODY_PX = 8000000; // stay well under browser element height limits

function isTimestampColumn(name) {
  if (String(name || '').trim().toLowerCase() === '@t') return true;
  const normalized = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const parts = normalized.split('_');
  return parts.some(part => ['timestamp', 'datetime', 'date', 'time', 'ts'].includes(part))
    || /(?:^|_)(?:created|updated|deleted|modified|started|ended|received|sent|logged|event|request|response)_?at$/.test(normalized);
}

function formatTimestamp(value, columnName, mode = 'utc') {
  if (typeof value !== 'string' || mode === 'raw' || !isTimestampColumn(columnName)) return value;
  const match = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?)(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/i.exec(value);
  if (!match) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const date = new Date(`${match[1]}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== match[1]) return value;
  const instant = new Date(parsed);
  const local = mode === 'local';
  const year = local ? instant.getFullYear() : instant.getUTCFullYear();
  const month = (local ? instant.getMonth() : instant.getUTCMonth()) + 1;
  const day = local ? instant.getDate() : instant.getUTCDate();
  const hours = local ? instant.getHours() : instant.getUTCHours();
  const minutes = local ? instant.getMinutes() : instant.getUTCMinutes();
  const seconds = local ? instant.getSeconds() : instant.getUTCSeconds();
  const pad = n => String(n).padStart(2, '0');
  const fraction = (match[2].match(/\.\d+$/) || [''])[0];
  let zone = 'UTC';
  if (local) {
    const offset = -instant.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const absolute = Math.abs(offset);
    zone += `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
  }
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}${fraction} ${zone}`;
}

function scrollToRow(scrollTop, rowCount, rowH, viewportBodyH) {
  const realH = rowCount * rowH;
  const bodyH = Math.min(realH, MAX_BODY_PX);
  const scrollRange = Math.max(0, bodyH - viewportBodyH);
  const realRange = Math.max(0, realH - viewportBodyH);
  const st = Math.max(0, Math.min(scrollTop, scrollRange));
  const offset = scrollRange === realRange ? st : scrollRange > 0 ? (st / scrollRange) * realRange : 0;
  let first = Math.floor(offset / rowH);
  if (first > Math.max(0, rowCount - 1)) first = Math.max(0, rowCount - 1);
  return { first, shift: offset - first * rowH, bodyH };
}

function rowToScroll(row, rowCount, rowH, viewportBodyH) {
  const realH = rowCount * rowH;
  const bodyH = Math.min(realH, MAX_BODY_PX);
  const scrollRange = Math.max(0, bodyH - viewportBodyH);
  const realRange = Math.max(0, realH - viewportBodyH);
  if (realRange === 0) return 0;
  if (realRange === scrollRange) return Math.min(scrollRange, row * rowH);
  return Math.min(scrollRange, (row * rowH / realRange) * scrollRange);
}

function pagesFor(first, last, pageSize) {
  if (last < first) return [];
  const out = [];
  for (let p = Math.floor(first / pageSize); p <= Math.floor(last / pageSize); p++) out.push(p);
  return out;
}

function autoWidth(name, type, samples) {
  const headerPx = String(name).length * 7.6 + String(type || '').length * 6.2 + 48;
  let max = 0;
  for (const s of samples) if (s && s.length > max) max = s.length;
  return Math.max(64, Math.min(360, Math.round(Math.max(headerPx, max * 7.4 + 22))));
}

function gutterWidth(rowCount) {
  return Math.max(48, Math.round(Number(rowCount).toLocaleString('en-US').length * 7.6 + 22));
}

function nextSort(sort, col) {
  if (!sort || sort.col !== col) return { col, dir: 'asc' };
  if (sort.dir === 'asc') return { col, dir: 'desc' };
  return null;
}

function moveColumn(order, source, target, after = false) {
  if (!Array.isArray(order) || !source || source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter(name => name !== source);
  const targetIndex = next.indexOf(target);
  next.splice(targetIndex + (after ? 1 : 0), 0, source);
  return next;
}

function visibleColumns(left, widths, scrollLeft, viewW, gutterW, overscan = 2) {
  const n = widths.length;
  if (!n) return { c0: 0, c1: -1 };
  const x0 = Math.max(0, scrollLeft);
  const x1 = x0 + Math.max(0, viewW - gutterW);
  // binary search for the first column whose right edge is past x0
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (left[mid] + widths[mid] <= x0) lo = mid + 1; else hi = mid; }
  let c1 = lo;
  while (c1 < n - 1 && left[c1 + 1] < x1) c1++;
  return { c0: Math.max(0, lo - overscan), c1: Math.min(n - 1, c1 + overscan) };
}

function columnLefts(widths) {
  const left = new Array(widths.length);
  let x = 0;
  for (let i = 0; i < widths.length; i++) { left[i] = x; x += widths[i]; }
  return left;
}

module.exports = { MAX_BODY_PX, isTimestampColumn, formatTimestamp, scrollToRow, rowToScroll, pagesFor, autoWidth, gutterWidth, nextSort, moveColumn, visibleColumns, columnLefts };
