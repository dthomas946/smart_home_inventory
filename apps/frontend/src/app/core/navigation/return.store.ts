import { Injectable } from '@angular/core';

export interface ReturnTarget {
  /** Full router URL including query params (filters, search, sort). */
  url: string;
  /** Short label for the back link: "Devices", "Connections". */
  label: string;
}

/** Key used for "New device" opened from a list (no id yet). */
export const NEW_DEVICE = '__new__';

/**
 * Remembers which filtered list a device was opened from, so the device
 * page can link back to it and Save returns there — instead of dropping the
 * user on an unfiltered list. Keyed by device id, so opening some other
 * device from the network map doesn't inherit a stale list.
 */
@Injectable({ providedIn: 'root' })
export class ReturnStore {
  private readonly targets = new Map<string, ReturnTarget>();

  remember(deviceId: string, url: string, label: string): void {
    this.targets.set(deviceId, { url, label });
  }

  for(deviceId: string | null | undefined): ReturnTarget | null {
    return deviceId ? (this.targets.get(deviceId) ?? null) : null;
  }

  /** Move a "new device" return target onto the id it was saved under. */
  adopt(fromKey: string, toDeviceId: string): void {
    const t = this.targets.get(fromKey);
    if (!t) return;
    this.targets.delete(fromKey);
    this.targets.set(toDeviceId, t);
  }
}

/** Shared click-to-sort state for list tables. */
export type SortDir = 'asc' | 'desc';

export function compareValues(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // blanks always last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortRows<T>(
  rows: T[],
  key: string | null,
  dir: SortDir,
  getters: Record<string, (row: T) => unknown>
): T[] {
  const get = key ? getters[key] : undefined;
  if (!get) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((x, y) => {
    const vx = get(x);
    const vy = get(y);
    const blankX = vx === null || vx === undefined || vx === '';
    const blankY = vy === null || vy === undefined || vy === '';
    if (blankX !== blankY) return blankX ? 1 : -1; // blanks last in both directions
    return sign * compareValues(vx, vy);
  });
}
