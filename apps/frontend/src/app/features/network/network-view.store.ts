import { Injectable } from '@angular/core';
import { UtilityKind } from '@smart-home-inventory/shared';

export interface NetworkViewState {
  /** Saved-positions key the view belongs to (mode / map / routes). */
  key: string;
  mapKind: UtilityKind | null;
  selectedTypes: string[];
  cam: { x: number; y: number; w: number; h: number };
  selectedEdge: string | null;
  selectedParent: string | null;
}

/**
 * Remembers how the Network map was left (filters, zoom/pan, selected link)
 * while you visit a device, so coming back lands on the same view. In
 * memory only: a page reload starts fresh.
 */
@Injectable({ providedIn: 'root' })
export class NetworkViewStore {
  private state: NetworkViewState | null = null;

  save(s: NetworkViewState): void {
    this.state = s;
  }

  restore(): NetworkViewState | null {
    return this.state;
  }
}
