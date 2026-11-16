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
  assert.equal(preferences.get(['level', 'message', 'timestamp']).found, false);
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
