// Run with: node --test test/BambuAms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { amsSpools, amsUnitName, amsUnits, colorName, crossedBelow, humidityText, spoolTitle, trayNow } from '../lib/BambuAms.mjs';

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

test('lists every loaded spool, with the filament left in grams and percent when the printer knows it', () => {
  assert.deepEqual(amsSpools(ams), [
    { key: 'ams0_slot1', ams: 'AMS', slot: 1, type: 'PLA', brand: 'PLA Tough+', color: '#F4D53F', percent: 17, grams: 170 },
    { key: 'ams0_slot2', ams: 'AMS', slot: 2, type: 'PLA', brand: 'PLA Matte', color: '#FFFFFF', percent: 84, grams: 840 },
    { key: 'ams0_slot3', ams: 'AMS', slot: 3, type: 'PLA', brand: 'PLA', color: '#0A2989', percent: null, grams: null }, // no tag
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

test('names the colour of a spool in Dutch or English', () => {
  assert.equal(colorName('#F4D53F', 'nl'), 'Geel');
  assert.equal(colorName('#FFFFFF', 'nl'), 'Wit');
  assert.equal(colorName('#0A2989', 'nl'), 'Blauw');
  assert.equal(colorName('#F330F9', 'nl'), 'Roze');
  assert.equal(colorName('#0ACC38', 'nl'), 'Groen');
  assert.equal(colorName('#000000', 'nl'), 'Zwart');
  assert.equal(colorName('#8E9089', 'nl'), 'Grijs');
  assert.equal(colorName('#C12E1F', 'nl'), 'Rood');
  assert.equal(colorName('#FF6A13', 'nl'), 'Oranje');
  assert.equal(colorName('#F4D53F', 'en'), 'Yellow');
  assert.equal(colorName('#undefined', 'nl'), '');
});

test('titles a spool by AMS, slot, colour and filament', () => {
  const [first] = amsSpools(ams);
  assert.equal(spoolTitle(first, 'nl'), 'AMS slot 1: Geel PLA Tough+');
  assert.equal(spoolTitle({ ...first, ams: 'AMS 2', slot: 3 }, 'en'), 'AMS 2 slot 3: Yellow PLA Tough+');
});

test('names an AMS unit the same way everywhere; an AMS HT has id 128 and up', () => {
  assert.equal(amsUnitName(ams, ams[0]), 'AMS');
  assert.equal(amsUnitName(ams, ams[1]), 'AMS HT');
  // an AMS with one spool loaded is still an AMS, not an HT
  assert.equal(amsUnitName([{ id: '0', tray: [{ id: '0' }] }], { id: '0', tray: [{ id: '0' }] }), 'AMS');
  const two = [{ id: '0', tray: [] }, { id: '1', tray: [] }, { id: '128', tray: [] }, { id: '129', tray: [] }];
  assert.deepEqual(two.map(u => amsUnitName(two, u)), ['AMS 1', 'AMS 2', 'AMS HT 1', 'AMS HT 2']);
});

test('knows the number the printer uses for the loaded spool, also on an AMS HT (id 128 and up)', () => {
  assert.equal(trayNow('0', '2'), 2);
  assert.equal(trayNow('1', '0'), 4);
  assert.equal(trayNow('128', '0'), 128);
});

test('gives each AMS unit with its temperature and humidity level (1 dry to 5 very humid)', () => {
  const units = [{ id: '0', humidity: '2', temp: '25.2', tray: [{}, {}, {}, {}] }, { id: '128', humidity: '1', temp: '23.7', tray: [{}] }];
  assert.deepEqual(amsUnits(units), [
    { key: 'ams0', name: 'AMS', temperature: 25.2, humidity: 4 },
    { key: 'ams128', name: 'AMS HT', temperature: 23.7, humidity: 5 },
  ]);
});

test('says how humid an AMS is in words', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(l => humidityText(l, 'nl')), ['droog', 'droog', 'wat vochtig', 'vochtig', 'erg vochtig']);
  assert.equal(humidityText(5, 'en'), 'very humid');
});
