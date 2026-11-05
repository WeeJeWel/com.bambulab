export default class BambuAms {

  static CAPABILITY_PREFIXES = [
    'measure_temperature.ams',
    'bambu_ams_humidity.',
    'bambu_filament_remaining.',
  ];

  static COLORS = [
    ['#FFFFFF', 'white'],
    ['#000000', 'black'],
    ['#808080', 'grey'],
    ['#D32F2F', 'red'],
    ['#FF7F00', 'orange'],
    ['#FFD700', 'yellow'],
    ['#2E9E3E', 'green'],
    ['#1F4FBF', 'blue'],
    ['#7EC8E3', 'lightBlue'],
    ['#7B3FA0', 'purple'],
    ['#FF4FD8', 'pink'],
    ['#7B4A2A', 'brown'],
    ['#E8D8B0', 'beige'],
  ];

  static isHt(unit) {
    return Number(unit.id) >= 128;
  }

  static getUnitName({ units = [], unit }) {
    const kind = this.isHt(unit)
      ? 'AMS HT'
      : 'AMS';
    const same = (units ?? []).filter(other => this.isHt(other) === this.isHt(unit));
    if (same.length <= 1) return kind;

    // Numbered by id (AMS 0-3, AMS HT 128 and up), so a name stays when another unit is unplugged
    const number = this.isHt(unit)
      ? Number(unit.id) - 127
      : Number(unit.id) + 1;
    return `${kind} ${number}`;
  }

  static getLoadedTrays({ print }) {
    // Newer printers (e.g. the P2S) report the loaded tray per extruder as (AMS id << 8) | tray;
    // their ams.tray_now is only the tray within its AMS
    const extruders = print?.device?.extruder?.info;
    if (Array.isArray(extruders) && extruders.length > 0) {
      return extruders
        .map(extruder => ({
          amsId: extruder.snow >> 8,
          trayId: extruder.snow & 0xFF,
        }))
        .filter(({ amsId }) => Number.isFinite(amsId) && amsId < 254); // 254: external spool, 255: nothing
    }

    // Older printers: 4 trays per AMS, 254 is the external spool, 255 nothing
    const trayNow = Number(print?.ams?.tray_now);
    if (!Number.isFinite(trayNow) || trayNow >= 254) return [];

    return [{
      amsId: Math.floor(trayNow / 4),
      trayId: trayNow % 4,
    }];
  }

  static isLoaded({ print, amsId, trayId }) {
    return this.getLoadedTrays({ print })
      .some(tray => tray.amsId === Number(amsId) && tray.trayId === Number(trayId));
  }

  static getHumidityText({ unit, __ }) {
    // The printer reports 5 as dry; newer AMS units also report the relative humidity
    const level = Math.min(5, Math.max(1, 6 - Math.round(Number(unit.humidity))));
    const text = __(`ams.humidityLevels.${level}`);
    return Number.isFinite(Number.parseFloat(unit.humidity_raw))
      ? `${text} (${unit.humidity_raw}%)`
      : text;
  }

  static getColorName({ color, __ }) {
    if (!/^#[0-9a-f]{6}$/i.test(color ?? '')) return '';

    // Redmean distance, closer to how people see colour than plain RGB
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));
    const [r, g, b] = rgb(color);
    const distance = code => {
      const [r2, g2, b2] = rgb(code);
      const mean = (r + r2) / 2;
      return (2 + mean / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - mean) / 256) * (b - b2) ** 2;
    };

    const [, name] = this.COLORS.reduce((best, current) => (distance(current[0]) < distance(best[0])
      ? current
      : best));
    return __(`ams.colors.${name}`);
  }

  static getSpool({
    units, unit, tray, __,
  }) {
    if (!tray.tray_type) return null; // Empty slot

    // Only Bambu spools with an RFID tag report what is left
    const remain = Number(tray.remain);
    const weight = Number(tray.tray_weight);
    const known = remain >= 0 && weight > 0;
    const color = `#${String(tray.tray_color ?? '').substr(0, 6)}`;

    return {
      ams: this.getUnitName({ units, unit }),
      slot: Number(tray.id) + 1,
      type: tray.tray_type,
      brand: tray.tray_sub_brands || tray.tray_type,
      color,
      colorName: this.getColorName({ color, __ }),
      grams: known
        ? Math.round((remain / 100) * weight)
        : null,
      percent: known
        ? remain
        : null,
    };
  }

  static getCapabilities({ units = [], __ }) {
    return (units ?? []).flatMap(unit => {
      const name = this.getUnitName({ units, unit });
      const capabilities = [];

      // Temperature & Humidity
      if (Number.isFinite(Number.parseFloat(unit.temp))) {
        capabilities.push({
          id: `measure_temperature.ams${unit.id}`,
          title: __('ams.temperature', { name }),
          value: Number(unit.temp),
        });
      }

      if (Number.isFinite(Number.parseFloat(unit.humidity))) {
        capabilities.push({
          id: `bambu_ams_humidity.ams${unit.id}`,
          title: __('ams.humidity', { name }),
          value: this.getHumidityText({ unit, __ }),
        });
      }

      // Filament Left
      for (const tray of unit.tray ?? []) {
        const spool = this.getSpool({
          units, unit, tray, __,
        });
        const slot = Number(tray.id) + 1;

        capabilities.push({
          id: `bambu_filament_remaining.ams${unit.id}_slot${slot}`,
          title: __('ams.slot', {
            ams: name,
            slot,
            spool: spool
              ? `${spool.colorName} ${spool.brand}`.trim()
              : __('ams.empty'),
          }),
          value: spool?.grams ?? null,
          spool,
        });
      }

      return capabilities;
    });
  }

  static getStaleCapabilities({ current = [], capabilities = [] }) {
    const wanted = new Set(capabilities.map(capability => capability.id));
    return current.filter(id => this.CAPABILITY_PREFIXES.some(prefix => id.startsWith(prefix)) && !wanted.has(id));
  }

  static crossedBelow({ previous, grams, limit }) {
    return typeof previous === 'number' && previous >= limit && grams < limit;
  }

  // Runs fn one at a time; calls that come in meanwhile result in one more run afterwards
  static runLatest(fn) {
    let running = null;
    let again = false;

    return async () => {
      if (running) {
        again = true;
        return running;
      }

      running = (async () => {
        try {
          do {
            again = false;
            await fn();
          } while (again);
        } finally {
          running = null;
        }
      })();

      return running;
    };
  }

}
