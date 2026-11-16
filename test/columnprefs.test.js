'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createColumnPreferences } = require('../src/core/columnprefs');

function stateStore() {
  const data = new Map();
  return {
    get(key, fallback) { return data.has(key) ? data.get(key) : fallback; },
    async update(key, value) { data.set(key, value); },
  };
}

test('workspace column preferences persist and match a schema regardless of column order', async () => {
  const preferences = createColumnPreferences(stateStore());
  assert.equal(preferences.get(['level', 'message']).found, false);

  await preferences.set(['level', 'message'], {
    hidden: ['message'],
    widths: { level: 160, message: 400 },
    order: ['message', 'level'],
  });

  assert.deepEqual(preferences.get(['message', 'level']), {
    schema: JSON.stringify(['level', 'message']),
    found: true,
    hidden: ['message'],
    widths: { level: 160, message: 400 },
    order: ['message', 'level'],
  });
  assert.equal(preferences.get(['level', 'message', 'timestamp']).found, true);
});

test('workspace preferences discard unknown columns and invalid widths', async () => {
  const preferences = createColumnPreferences(stateStore());
  await preferences.set(['level', 'message'], {
    hidden: ['message', 'other'],
    widths: { level: 160.4, message: 20, other: 500 },
    order: ['other', 'message'],
  });

  assert.deepEqual(preferences.get(['level', 'message']).hidden, ['message']);
  assert.deepEqual(preferences.get(['level', 'message']).widths, { level: 160 });
  assert.deepEqual(preferences.get(['level', 'message']).order, ['message', 'level']);
});

test('workspace settings follow shared columns across changing log schemas', async () => {
  const preferences = createColumnPreferences(stateStore());
  await preferences.set(['@t', '@l', '@mt'], {
    hidden: ['@mt'],
    widths: { '@t': 240 },
    order: ['@t', '@l', '@mt'],
  });

  assert.deepEqual(preferences.get(['@t', '@mt', '@r']), {
    schema: JSON.stringify(['@mt', '@r', '@t']),
    found: true,
    hidden: ['@mt'],
    widths: { '@t': 240 },
    order: ['@t', '@mt', '@r'],
  });
});

test('legacy schema settings seed the shared workspace preferences', async () => {
  const state = stateStore();
  await state.update('jsonlViewer.columnPreferences.v1', {
    [JSON.stringify(['level', 'message'])]: {
      hidden: ['message'],
      widths: { level: 180 },
      order: ['message', 'level'],
    },
  });
  const preferences = createColumnPreferences(state);
  const migrated = preferences.get(['message', 'level', 'timestamp']);
  assert.equal(migrated.found, true);
  assert.equal(migrated.syncGlobal, true);
  assert.deepEqual(migrated.hidden, ['message']);
  assert.deepEqual(migrated.widths, { level: 180 });
  assert.deepEqual(migrated.order, ['message', 'level', 'timestamp']);

  await preferences.set(['message', 'level', 'timestamp'], migrated);
  const nextSchema = preferences.get(['timestamp', 'level', 'event']);
  assert.equal(nextSchema.found, true);
  assert.equal(nextSchema.syncGlobal, undefined);
  assert.deepEqual(nextSchema.hidden, []);
  assert.deepEqual(nextSchema.widths, { level: 180 });
  assert.deepEqual(nextSchema.order, ['level', 'timestamp', 'event']);
});

test('named layouts can be reused with different schemas and deleted', async () => {
  const preferences = createColumnPreferences(stateStore());
  await preferences.saveProfile('Compact logs', ['level', 'message'], {
    hidden: ['message'],
    widths: { level: 160, message: 400 },
    order: ['message', 'level'],
  });

  assert.deepEqual(preferences.listProfiles(), ['Compact logs']);
  assert.deepEqual(preferences.getProfile('Compact logs', ['time', 'message', 'level']), {
    name: 'Compact logs',
    schema: '["level","message","time"]',
    found: true,
    hidden: ['message'],
    widths: { level: 160, message: 400 },
    order: ['message', 'level', 'time'],
  });
  await preferences.deleteProfile('Compact logs');
  assert.deepEqual(preferences.listProfiles(), []);
  assert.equal(preferences.getProfile('Compact logs', ['level']).found, false);
});

test('named layouts reject invalid names and enforce the workspace limit', async () => {
  const preferences = createColumnPreferences(stateStore());
  await assert.rejects(preferences.saveProfile('  ', ['level'], {}), /name/);
  for (let i = 0; i < 50; i++) await preferences.saveProfile(`Layout ${i}`, ['level'], {});
  await assert.rejects(preferences.saveProfile('Layout 50', ['level'], {}), /up to 50/);
});
