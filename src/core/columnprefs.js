'use strict';

const STATE_KEY = 'jsonlViewer.columnPreferences.v1';
const GLOBAL_STATE_KEY = 'jsonlViewer.columnPreferencesByName.v1';
const PROFILE_STATE_KEY = 'jsonlViewer.columnProfiles.v1';
const MAX_COLUMNS = 300;
const MAX_GLOBAL_COLUMNS = 10000;
const MAX_PROFILES = 50;

function columnNames(columns, limit = MAX_COLUMNS) {
  if (!Array.isArray(columns)) return [];
  const names = [];
  for (const name of columns.slice(0, limit)) {
    if (typeof name === 'string' && name.length <= 1024 && !names.includes(name)) names.push(name);
  }
  return names;
}

function schemaKey(columns) {
  return JSON.stringify(columnNames(columns).sort());
}

function cleanPreferences(value, names) {
  const allowed = new Set(names);
  const hidden = Array.isArray(value && value.hidden)
    ? [...new Set(value.hidden.filter(name => allowed.has(name)))].slice(0, MAX_COLUMNS)
    : [];
  const order = Array.isArray(value && value.order)
    ? [...new Set(value.order.filter(name => allowed.has(name)))].slice(0, MAX_COLUMNS)
    : [];
  for (const name of names) if (!order.includes(name)) order.push(name);
  const widths = [];
  const input = value && value.widths;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const name of names) {
      const width = input[name];
      if (Number.isFinite(width) && width >= 40 && width <= 2000) widths.push([name, Math.round(width)]);
    }
  }
  return { hidden, widths: Object.fromEntries(widths), order };
}

function mergeColumnOrder(previous, current) {
  const currentNames = new Set(current);
  const remaining = previous.filter(name => !currentNames.has(name));
  const first = previous.findIndex(name => currentNames.has(name));
  const at = first < 0 ? remaining.length : previous.slice(0, first).filter(name => !currentNames.has(name)).length;
  remaining.splice(at, 0, ...current);
  return remaining.slice(0, MAX_GLOBAL_COLUMNS);
}

function globalPreferences(workspaceState) {
  const value = workspaceState.get(GLOBAL_STATE_KEY, {});
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { order: [], hidden: [], widths: {} };
  const order = columnNames(value.order, MAX_GLOBAL_COLUMNS);
  const allowed = new Set(order);
  const hidden = Array.isArray(value.hidden)
    ? [...new Set(value.hidden.filter(name => allowed.has(name)))].slice(0, MAX_GLOBAL_COLUMNS)
    : [];
  const widths = {};
  const input = value.widths;
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const name of order) {
      const width = input[name];
      if (Number.isFinite(width) && width >= 40 && width <= 2000) widths[name] = Math.round(width);
    }
  }
  return { order, hidden, widths };
}

function bestLegacyPreferences(names, all, exactKey) {
  const wanted = new Set(names);
  let best = null;
  let bestOverlap = 0;
  let bestRecency = -1;
  let sequence = 0;
  for (const [key, value] of Object.entries(all)) {
    const recency = Number.isFinite(value && value.updatedAt) ? value.updatedAt : sequence;
    sequence++;
    if (key === exactKey) continue;
    let savedNames;
    try { savedNames = columnNames(JSON.parse(key)); } catch { continue; }
    const overlap = savedNames.filter(name => wanted.has(name)).length;
    if (overlap > bestOverlap || (overlap === bestOverlap && overlap > 0 && recency >= bestRecency)) {
      best = value;
      bestOverlap = overlap;
      bestRecency = recency;
    }
  }
  return bestOverlap ? cleanPreferences(best, names) : null;
}

function normalizeProfileName(value) {
  if (typeof value !== 'string') throw new Error('Enter a name for this column layout.');
  const name = value.trim();
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/.test(name) || name === '__proto__') {
    throw new Error('Layout names must be 1–60 characters and cannot contain control characters.');
  }
  return name;
}

function createColumnPreferences(workspaceState) {
  function allPreferences() {
    const value = workspaceState.get(STATE_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function allProfiles() {
    const value = workspaceState.get(PROFILE_STATE_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  return {
    get(columns) {
      const names = columnNames(columns);
      const key = schemaKey(names);
      const all = allPreferences();
      const exactFound = Object.prototype.hasOwnProperty.call(all, key);
      const legacy = exactFound ? null : bestLegacyPreferences(names, all, key);
      const baselineFound = exactFound || !!legacy;
      const baseline = cleanPreferences(exactFound ? all[key] : legacy, names);
      const global = globalPreferences(workspaceState);
      const globalNames = new Set(global.order);
      const allowed = new Set(names);
      const globalMatch = names.some(name => globalNames.has(name));
      const hidden = new Set(baseline.hidden.filter(name => !globalNames.has(name)));
      for (const name of global.hidden) if (allowed.has(name)) hidden.add(name);
      const widths = Object.assign(Object.create(null), baseline.widths);
      for (const name of names) {
        if (!globalNames.has(name)) continue;
        delete widths[name];
        if (Object.prototype.hasOwnProperty.call(global.widths, name)) widths[name] = global.widths[name];
      }
      const order = [
        ...global.order.filter(name => allowed.has(name)),
        ...baseline.order.filter(name => allowed.has(name) && !globalNames.has(name)),
        ...names,
      ];
      const result = {
        schema: key,
        found: baselineFound || globalMatch,
        ...cleanPreferences({ hidden: [...hidden], widths, order }, names),
      };
      if (baselineFound && !globalMatch) result.syncGlobal = true;
      return result;
    },

    async set(columns, value) {
      const names = columnNames(columns);
      const key = schemaKey(names);
      const all = allPreferences();
      const preferences = cleanPreferences(value, names);
      const global = globalPreferences(workspaceState);
      const current = new Set(names);
      const widths = Object.assign(Object.create(null), global.widths);
      for (const name of names) delete widths[name];
      Object.assign(widths, preferences.widths);
      await workspaceState.update(STATE_KEY, {
        ...all,
        [key]: { ...preferences, updatedAt: Date.now() },
      });
      await workspaceState.update(GLOBAL_STATE_KEY, {
        order: mergeColumnOrder(global.order, preferences.order),
        hidden: [
          ...global.hidden.filter(name => !current.has(name)),
          ...preferences.hidden,
        ],
        widths,
      });
    },

    listProfiles() {
      return Object.keys(allProfiles())
        .filter(name => {
          try { return normalizeProfileName(name) === name; } catch { return false; }
        })
        .slice(0, MAX_PROFILES);
    },

    getProfile(name, columns) {
      const profileName = normalizeProfileName(name);
      const names = columnNames(columns);
      const profiles = allProfiles();
      const found = Object.prototype.hasOwnProperty.call(profiles, profileName);
      return {
        name: profileName,
        schema: schemaKey(names),
        found,
        ...cleanPreferences(found ? profiles[profileName] : null, names),
      };
    },

    async saveProfile(name, columns, value) {
      const profileName = normalizeProfileName(name);
      const profiles = allProfiles();
      if (!Object.prototype.hasOwnProperty.call(profiles, profileName) && Object.keys(profiles).length >= MAX_PROFILES) {
        throw new Error(`You can save up to ${MAX_PROFILES} column layouts in this workspace.`);
      }
      const next = Object.assign(Object.create(null), profiles);
      next[profileName] = cleanPreferences(value, columnNames(columns));
      await workspaceState.update(PROFILE_STATE_KEY, next);
    },

    async deleteProfile(name) {
      const profileName = normalizeProfileName(name);
      const profiles = allProfiles();
      if (!Object.prototype.hasOwnProperty.call(profiles, profileName)) return;
      const next = Object.assign(Object.create(null), profiles);
      delete next[profileName];
      await workspaceState.update(PROFILE_STATE_KEY, next);
    },
  };
}

module.exports = { createColumnPreferences, schemaKey };
