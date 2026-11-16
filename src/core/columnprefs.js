'use strict';

const STATE_KEY = 'jsonlViewer.columnPreferences.v1';
const PROFILE_STATE_KEY = 'jsonlViewer.columnProfiles.v1';
const MAX_COLUMNS = 300;
const MAX_PROFILES = 50;

function columnNames(columns) {
  if (!Array.isArray(columns)) return [];
  const names = [];
  for (const name of columns.slice(0, MAX_COLUMNS)) {
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
      const found = Object.prototype.hasOwnProperty.call(all, key);
      return {
        schema: key,
        found,
        ...cleanPreferences(found ? all[key] : null, names),
      };
    },

    async set(columns, value) {
      const names = columnNames(columns);
      const key = schemaKey(names);
      const all = allPreferences();
      await workspaceState.update(STATE_KEY, {
        ...all,
        [key]: cleanPreferences(value, names),
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
