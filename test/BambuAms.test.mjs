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
    humidity_raw: '43',
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
    ['bambu_ams_humidity.ams0', 'AMS vochtigheid', 'vochtig (43%)'],
    ['bambu_filament_remaining.ams0_slot1', 'AMS slot 1: Geel PLA Tough+', 170],
    ['bambu_filament_remaining.ams0_slot2', 'AMS slot 2: Wit PLA Matte', 840],
    ['bambu_filament_remaining.ams0_slot3', 'AMS slot 3: Blauw PLA', null], // no RFID tag: amount unknown
    ['bambu_filament_remaining.ams0_slot4', 'AMS slot 4: leeg', null], // empty slot: no old amount left behind
    ['measure_temperature.ams128', 'AMS HT temperatuur', 23.7],
    ['bambu_ams_humidity.ams128', 'AMS HT vochtigheid', 'erg vochtig'], // no humidity_raw: words only
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

test('getUnitName: the number follows the AMS id, so names stay the same when a unit is unplugged', () => {
  const units = [{ id: '2' }, { id: '0' }, { id: '129' }, { id: '128' }]; // AMS 2 (id 1) unplugged, any order
  assert.deepEqual(units.map(unit => BambuAms.getUnitName({ units, unit })), ['AMS 3', 'AMS 1', 'AMS HT 2', 'AMS HT 1']);
});

test('getLoadedTrays: newer printers report the loaded tray per extruder as (AMS id << 8) | tray', () => {
  // Measured on a P2S with the spool of the AMS HT loaded: tray_now says only the slot
  const print = {
    ams: { tray_now: '0' },
    device: { extruder: { info: [{ id: 0, snow: 32768 }] } },
  };
  assert.deepEqual(BambuAms.getLoadedTrays({ print }), [{ amsId: 128, trayId: 0 }]);
  assert.equal(BambuAms.isLoaded({ print, amsId: '128', trayId: '0' }), true);
  assert.equal(BambuAms.isLoaded({ print, amsId: '0', trayId: '0' }), false);
  // Nothing or the external spool loaded
  assert.deepEqual(BambuAms.getLoadedTrays({ print: { device: { extruder: { info: [{ snow: 65535 }] } } } }), []);
  assert.deepEqual(BambuAms.getLoadedTrays({ print: { device: { extruder: { info: [{ snow: 65280 }] } } } }), []);
});

test('getLoadedTrays: older printers report tray_now, 4 trays per AMS', () => {
  assert.deepEqual(BambuAms.getLoadedTrays({ print: { ams: { tray_now: '5' } } }), [{ amsId: 1, trayId: 1 }]);
  assert.deepEqual(BambuAms.getLoadedTrays({ print: { ams: { tray_now: '255' } } }), []);
  assert.deepEqual(BambuAms.getLoadedTrays({ print: { ams: { tray_now: '254' } } }), []);
  assert.deepEqual(BambuAms.getLoadedTrays({ print: undefined }), []);
});

test('getHumidityText: the level in words (the printer reports 5 as dry), with the percentage when known', () => {
  assert.deepEqual(['5', '4', '3', '2', '1'].map(humidity => BambuAms.getHumidityText({ unit: { humidity }, __: nl })), ['droog', 'droog', 'wat vochtig', 'vochtig', 'erg vochtig']);
  assert.equal(BambuAms.getHumidityText({ unit: { humidity: '1', humidity_raw: '52' }, __: en }), 'very humid (52%)');
});

test('getColorName: the nearest colour name', () => {
  const names = ['#F4D53F', '#FFFFFF', '#0A2989', '#F330F9', '#0ACC38', '#000000', '#8E9089', '#C12E1F', '#FF6A13']
    .map(color => BambuAms.getColorName({ color, __: nl }));
  assert.deepEqual(names, ['Geel', 'Wit', 'Blauw', 'Roze', 'Groen', 'Zwart', 'Grijs', 'Rood', 'Oranje']);
  assert.equal(BambuAms.getColorName({ color: '#undefined', __: nl }), '');
});

test('crossedBelow: once when a spool goes below the limit, and for a low spool put into an empty slot', () => {
  assert.equal(BambuAms.crossedBelow({ previous: 110, grams: 95, limit: 100 }), true);
  assert.equal(BambuAms.crossedBelow({ previous: 95, grams: 90, limit: 100 }), false); // already below
  assert.equal(BambuAms.crossedBelow({ previous: 90, grams: 1000, limit: 100 }), false); // a new full spool
  assert.equal(BambuAms.crossedBelow({ previous: null, grams: 60, limit: 100 }), true); // low spool in an empty slot
  assert.equal(BambuAms.crossedBelow({ previous: null, grams: 900, limit: 100 }), false);
});

test('getHumidityText: nothing for a unit that reports no humidity', () => {
  assert.equal(BambuAms.getHumidityText({ unit: {}, __: nl }), '');
});

test('mergeUnits: a report with only some AMS units or trays keeps the others', () => {
  const current = [
    { id: '0', temp: '21', tray: [{ id: '0', tray_type: 'PLA' }, { id: '1', tray_type: 'PETG' }] },
    { id: '128', temp: '20', tray: [{ id: '0', tray_type: 'TPU' }] },
  ];
  const merged = BambuAms.mergeUnits({
    current,
    incoming: [{ id: '0', temp: '22', tray: [{ id: '1' }] }], // only AMS 0, tray 1 emptied
  });
  assert.deepEqual(merged, [
    { id: '0', temp: '22', tray: [{ id: '0', tray_type: 'PLA' }, { id: '1' }] },
    { id: '128', temp: '20', tray: [{ id: '0', tray_type: 'TPU' }] },
  ]);
});

test('isFullStatus: the answer to pushall has msg 0, a report of changes msg 1', () => {
  assert.equal(BambuAms.isFullStatus({ print: { command: 'push_status', msg: 0 } }), true);
  assert.equal(BambuAms.isFullStatus({ print: { command: 'push_status', msg: 1 } }), false);
  assert.equal(BambuAms.isFullStatus({ system: {} }), false);
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
