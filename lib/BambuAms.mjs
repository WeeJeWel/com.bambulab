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
