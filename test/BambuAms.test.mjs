// Run with: node --test test/BambuAms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { amsSpools, crossedBelow } from '../lib/BambuAms.mjs';

const ams = [
  {
    id: '0',
    tray: [
      { id: '0', remain: 17, tray_weight: '1000', tray_type: 'PLA', tray_sub_brands: 'PLA Tough+', tray_color: 'F4D53FFF' },
      { id: '1', remain: 84, tray_weight: '1000', tray_type: 'PLA', tray_sub_brands: 'PLA Matte', tray_color: 'FFFFFFFF' },
      { id: '2', remain: -1, tray_weight: '0', tray_type: 'PLA', tray_sub_brands: '', tray_color: '0A2989FF' }, // no tag
      { id: '3' }, // empty slot
    ],
  },
  { id: '128', tray: [{ id: '0', remain: 50, tray_weight: '500', tray_type: 'PETG', tray_sub_brands: 'PETG HF', tray_color: '0ACC38FF' }] },
];

test('lists the spools whose filament left is known, in grams and percent', () => {
  assert.deepEqual(amsSpools(ams), [
    { key: 'ams0_slot1', ams: 'AMS', slot: 1, type: 'PLA', brand: 'PLA Tough+', color: '#F4D53F', percent: 17, grams: 170 },
    { key: 'ams0_slot2', ams: 'AMS', slot: 2, type: 'PLA', brand: 'PLA Matte', color: '#FFFFFF', percent: 84, grams: 840 },
    { key: 'ams128_slot1', ams: 'AMS HT', slot: 1, type: 'PETG', brand: 'PETG HF', color: '#0ACC38', percent: 50, grams: 250 },
  ]);
});

test('numbers the AMS units when there are several with four slots', () => {
  const unit = id => ({ id, tray: [0, 1, 2, 3].map(t => ({ id: String(t), remain: 50, tray_weight: '1000', tray_type: 'PLA' })) });
  assert.deepEqual([...new Set(amsSpools([unit('0'), unit('1')]).map(s => s.ams))], ['AMS 1', 'AMS 2']);
});

test('is empty without an AMS', () => {
  assert.deepEqual(amsSpools(undefined), []);
});

test('says when a spool goes below a limit, once, and not for a new full spool', () => {
  assert.equal(crossedBelow(110, 95, 100), true);
  assert.equal(crossedBelow(95, 90, 100), false); // already below: no second message
  assert.equal(crossedBelow(90, 1000, 100), false); // a new spool
  assert.equal(crossedBelow(undefined, 90, 100), false); // just started: nothing known before
});
