import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import BambuAms from '../lib/BambuAms.mjs';

// A stand-in for this.homey.__(), reading the app's own locales
const translator = language => {
  const strings = JSON.parse(fs.readFileSync(new URL(`../locales/${language}.json`, import.meta.url)));
  return (key, tokens = {}) => {
    const text = key.split('.').reduce((node, part) => node?.[part], strings);
    if (typeof text !== 'string') throw new Error(`Missing translation: ${key}`);
    return text.replace(/__(\w+)__/g, (match, name) => tokens[name]);
  };
};
const nl = translator('nl');
const en = translator('en');

const units = [
  {
    id: '0',
    humidity: '2',
    temp: '25.2',
    tray: [
      { id: '0', remain: 17, tray_weight: '1000', tray_type: 'PLA', tray_sub_brands: 'PLA Tough+', tray_color: 'F4D53FFF' },
      { id: '1', remain: 84, tray_weight: '1000', tray_type: 'PLA', tray_sub_brands: 'PLA Matte', tray_color: 'FFFFFFFF' },
      { id: '2', remain: -1, tray_weight: '0', tray_type: 'PLA', tray_sub_brands: '', tray_color: '0A2989FF' }, // no RFID tag
      { id: '3' }, // empty slot
    ],
  },
  {
    id: '128',
    humidity: '1',
    temp: '23.7',
    tray: [
      { id: '0', remain: 50, tray_weight: '500', tray_type: 'PETG', tray_sub_brands: 'PETG HF', tray_color: '0ACC38FF' },
    ],
  },
];

test('getCapabilities: every AMS with its temperature and humidity, every slot with the grams left', () => {
  assert.deepEqual(BambuAms.getCapabilities({ units, __: nl }).map(({ id, title, value }) => [id, title, value]), [
    ['measure_temperature.ams0', 'AMS temperatuur', 25.2],
    ['bambu_ams_humidity.ams0', 'AMS vochtigheid', 'vochtig'],
    ['bambu_filament_remaining.ams0_slot1', 'AMS slot 1: Geel PLA Tough+', 170],
    ['bambu_filament_remaining.ams0_slot2', 'AMS slot 2: Wit PLA Matte', 840],
    ['bambu_filament_remaining.ams0_slot3', 'AMS slot 3: Blauw PLA', null], // no RFID tag: amount unknown
    ['bambu_filament_remaining.ams0_slot4', 'AMS slot 4: leeg', null], // empty slot: no old amount left behind
    ['measure_temperature.ams128', 'AMS HT temperatuur', 23.7],
    ['bambu_ams_humidity.ams128', 'AMS HT vochtigheid', 'erg vochtig'],
    ['bambu_filament_remaining.ams128_slot1', 'AMS HT slot 1: Groen PETG HF', 250],
  ]);
});

test('getCapabilities: the spool of a slot, for the filament_low tokens', () => {
  const [slot1] = BambuAms.getCapabilities({ units, __: en }).filter(capability => capability.spool);
  assert.deepEqual(slot1.spool, {
    ams: 'AMS', slot: 1, type: 'PLA', brand: 'PLA Tough+', color: '#F4D53F', colorName: 'Yellow', grams: 170, percent: 17,
  });
});

test('getCapabilities: nothing without an AMS', () => {
  assert.deepEqual(BambuAms.getCapabilities({ units: undefined, __: nl }), []);
});

test('getStaleCapabilities: the AMS capabilities of a unit that is gone, never other capabilities', () => {
  const capabilities = BambuAms.getCapabilities({ units: [units[0]], __: nl });
  assert.deepEqual(BambuAms.getStaleCapabilities({
    current: ['measure_temperature.nozzle', 'measure_temperature.ams0', 'measure_temperature.ams128', 'bambu_ams_humidity.ams128', 'bambu_filament_remaining.ams128_slot1'],
    capabilities,
  }), ['measure_temperature.ams128', 'bambu_ams_humidity.ams128', 'bambu_filament_remaining.ams128_slot1']);
});

test('getUnitName: AMS or AMS HT (id 128 and up), numbered when there are several of a kind', () => {
  assert.equal(BambuAms.getUnitName({ units, unit: units[0] }), 'AMS');
  assert.equal(BambuAms.getUnitName({ units, unit: units[1] }), 'AMS HT');
  const four = [{ id: '0' }, { id: '1' }, { id: '128' }, { id: '129' }];
  assert.deepEqual(four.map(unit => BambuAms.getUnitName({ units: four, unit })), ['AMS 1', 'AMS 2', 'AMS HT 1', 'AMS HT 2']);
});

test('getTrayNow: 4 per AMS, an AMS HT has its own number', () => {
  assert.equal(BambuAms.getTrayNow({ amsId: '0', trayId: '2' }), 2);
  assert.equal(BambuAms.getTrayNow({ amsId: '1', trayId: '0' }), 4);
  assert.equal(BambuAms.getTrayNow({ amsId: '128', trayId: '0' }), 128);
});

test('getHumidityText: the level (1 dry to 5 very humid) in words', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(level => BambuAms.getHumidityText({ level, __: nl })), ['droog', 'droog', 'wat vochtig', 'vochtig', 'erg vochtig']);
  assert.equal(BambuAms.getHumidityText({ level: 5, __: en }), 'very humid');
});

test('getColorName: the nearest colour name', () => {
  const names = ['#F4D53F', '#FFFFFF', '#0A2989', '#F330F9', '#0ACC38', '#000000', '#8E9089', '#C12E1F', '#FF6A13']
    .map(color => BambuAms.getColorName({ color, __: nl }));
  assert.deepEqual(names, ['Geel', 'Wit', 'Blauw', 'Roze', 'Groen', 'Zwart', 'Grijs', 'Rood', 'Oranje']);
  assert.equal(BambuAms.getColorName({ color: '#undefined', __: nl }), '');
});

test('crossedBelow: once when a spool goes below the limit, not for a new spool or at start-up', () => {
  assert.equal(BambuAms.crossedBelow({ previous: 110, grams: 95, limit: 100 }), true);
  assert.equal(BambuAms.crossedBelow({ previous: 95, grams: 90, limit: 100 }), false);
  assert.equal(BambuAms.crossedBelow({ previous: 90, grams: 1000, limit: 100 }), false);
  assert.equal(BambuAms.crossedBelow({ previous: null, grams: 90, limit: 100 }), false);
});

test('runLatest: one run at a time, and one more run for what came in meanwhile', async () => {
  let runs = 0;
  let release;
  const run = BambuAms.runLatest(async () => {
    runs++;
    if (runs === 1) await new Promise(resolve => { release = resolve; });
  });

  const first = run();
  run(); // while the first runs
  run(); // and another one: still only one extra run
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runs, 2);
});
