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

    // The setting holds the AMS id (128 and up for an AMS HT)
    const units = device.state?.print?.ams?.ams ?? [];
    const ams = units.find(unit => String(unit.id) === String(amsId)) ?? units[amsId];
    if (!ams) {
      throw new Error('AMS Not Found');
    }

    const { default: BambuAms } = await import('../../lib/BambuAms.mjs');

    return {
      name: BambuAms.getUnitName({ units, unit: ams }),
      humidity: 6 - ams.humidity,
      humidityText: BambuAms.getHumidityText({
        unit: ams,
        __: (key, tokens) => homey.__(key, tokens),
      }),
      temperature: ams.temp,
      trayLoadedId: device.state?.print?.ams?.tray_now,
      trays: ams.tray.map(tray => ({
        id: tray.id,
        color: `#${tray.tray_color?.substr(0, 6)}`,
        type: tray.tray_type,
        loaded: BambuAms.isLoaded({
          print: device.state?.print,
          amsId: ams.id,
          trayId: tray.id,
        }),
        // Only Bambu spools with an RFID tag report what is left
        remain: Number.isFinite(tray.remain) && tray.remain >= 0
          ? tray.remain
          : null,
        brand: tray.tray_sub_brands || null,
        weight: Number(tray.tray_weight) > 0
          ? Number(tray.tray_weight)
          : null,
      })),
    };
  },

};
