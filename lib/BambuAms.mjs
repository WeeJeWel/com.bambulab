/**
 * The spools in the AMS units whose filament left is known: Bambu spools with an RFID tag report `remain` (percentage,
 * -1 when unknown) and `tray_weight` (grams of a full spool). A unit with one slot is an AMS HT; units with four slots
 * are numbered only when there are several.
 */
export function amsSpools(units = []) {
  const four = (units ?? []).filter(unit => (unit.tray ?? []).length > 1);

  return (units ?? []).flatMap(unit => {
    const trays = unit.tray ?? [];
    let name = 'AMS';
    if (trays.length <= 1) name = 'AMS HT';
    else if (four.length > 1) name = `AMS ${four.indexOf(unit) + 1}`;

    return trays
      .map(tray => {
        const percent = Number(tray.remain);
        const weight = Number(tray.tray_weight);
        if (!tray.tray_type || !(percent >= 0) || !(weight > 0)) return null;

        return {
          key: `ams${unit.id}_slot${Number(tray.id) + 1}`,
          ams: name,
          slot: Number(tray.id) + 1,
          type: tray.tray_type,
          brand: tray.tray_sub_brands || tray.tray_type,
          color: `#${String(tray.tray_color ?? '').substr(0, 6)}`,
          percent,
          grams: Math.round((percent / 100) * weight),
        };
      })
      .filter(Boolean);
  });
}

/** True when the filament left went from at or above the limit to below it (not for a new spool, not at start-up). */
export function crossedBelow(previous, now, limit) {
  return typeof previous === 'number' && previous >= limit && now < limit;
}

// The colour names a spool gets, with a typical colour for each; a spool gets the nearest one.
const COLORS = [
  ['#FFFFFF', 'Wit', 'White'], ['#000000', 'Zwart', 'Black'], ['#808080', 'Grijs', 'Grey'],
  ['#D32F2F', 'Rood', 'Red'], ['#FF7F00', 'Oranje', 'Orange'], ['#FFD700', 'Geel', 'Yellow'],
  ['#2E9E3E', 'Groen', 'Green'], ['#1F4FBF', 'Blauw', 'Blue'], ['#7EC8E3', 'Lichtblauw', 'Light blue'],
  ['#7B3FA0', 'Paars', 'Purple'], ['#FF4FD8', 'Roze', 'Pink'], ['#7B4A2A', 'Bruin', 'Brown'],
  ['#E8D8B0', 'Beige', 'Beige'],
];

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16));

/** The name of the colour nearest to a spool's colour code (#RRGGBB), in Dutch ('nl') or English; '' if unknown. */
export function colorName(hex, language = 'en') {
  if (!/^#[0-9a-f]{6}$/i.test(hex ?? '')) return '';
  const [r, g, b] = rgb(hex);
  let best = null;
  let bestDistance = Infinity;
  for (const [code, nl, en] of COLORS) {
    const [r2, g2, b2] = rgb(code);
    // "redmean": a cheap distance that follows how people see colour better than plain RGB
    const mean = (r + r2) / 2;
    const distance = (2 + mean / 256) * (r - r2) ** 2 + 4 * (g - g2) ** 2 + (2 + (255 - mean) / 256) * (b - b2) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = language === 'nl' ? nl : en;
    }
  }
  return best;
}

/** How a spool is named in Homey, e.g. 'AMS slot 1: Geel PLA Tough+'. */
export function spoolTitle(spool, language = 'en') {
  const color = colorName(spool.color, language);
  return `${spool.ams} slot ${spool.slot}: ${color ? `${color} ` : ''}${spool.brand}`;
}
