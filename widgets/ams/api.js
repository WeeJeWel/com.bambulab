'use strict';

async function getDevice({ homey, query }) {
  const { deviceId } = query;
  return homey.app.getDevice({ deviceId });
}

module.exports = {
  async getStatus({ homey, query }) {
    const device = await getDevice({ homey, query });

    const { amsId } = query;
    if (!amsId) {
      throw new Error('AMS ID Not Found');
    }

    // the setting holds the AMS id (an AMS HT has 128 and up), older callers its place in the list
    const units = device.state?.print?.ams?.ams ?? [];
    const ams = units.find(unit => String(unit.id) === String(amsId)) ?? units[amsId];
    if (!ams) {
      throw new Error('AMS Not Found');
    }

    // the shared AMS helpers are an ES module; this file is CommonJS
    const { amsUnitName, humidityText } = await import('../../lib/BambuAms.mjs');
    const language = homey.i18n.getLanguage();

    return {
      name: amsUnitName(units, ams),
      humidity: 6 - ams.humidity,
      humidityText: humidityText(6 - ams.humidity, language),
      temperature: ams.temp,
      trayLoadedId: device.state?.print?.ams?.tray_now,
      // whether the 'filament left' capabilities could be made (installed apps show no logs)
      filamentStatus: device.filamentStatus ?? null,
      trays: ams.tray.map(tray => ({
        id: tray.id,
        // tray_now counts 4 per AMS; an AMS HT (id 128 and up) has its own number (see trayNow in lib/BambuAms.mjs)
        loaded: Number(device.state?.print?.ams?.tray_now)
          === (Number(ams.id) >= 128 ? Number(ams.id) + Number(tray.id) : Number(ams.id) * 4 + Number(tray.id)),
        color: `#${tray.tray_color?.substr(0, 6)}`,
        type: tray.tray_type,
        // percentage of filament left; only known for Bambu spools with an RFID tag (the printer sends -1 otherwise)
        remain: Number.isFinite(tray.remain) && tray.remain >= 0 ? tray.remain : null,
        brand: tray.tray_sub_brands || null,
        // weight of a full spool in grams, so the grams left can be worked out
        weight: Number(tray.tray_weight) > 0 ? Number(tray.tray_weight) : null,
      })),
    };
  },

};
