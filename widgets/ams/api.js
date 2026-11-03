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

    const ams = device.state?.print?.ams?.ams[amsId];
    if (!ams) {
      throw new Error('AMS Not Found');
    }

    return {
      humidity: 6 - ams.humidity,
      temperature: ams.temp,
      trayLoadedId: device.state?.print?.ams?.tray_now,
      trays: ams.tray.map(tray => ({
        id: tray.id,
        color: `#${tray.tray_color?.substr(0, 6)}`,
        type: tray.tray_type,
        // percentage of filament left; only known for Bambu spools with an RFID tag (the printer sends -1 otherwise)
        remain: Number.isFinite(tray.remain) && tray.remain >= 0 ? tray.remain : null,
        brand: tray.tray_sub_brands || null,
      })),
    };
  },

};
