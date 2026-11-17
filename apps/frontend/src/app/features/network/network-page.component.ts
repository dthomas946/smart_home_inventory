import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  DASH_STYLE_PATTERNS,
  DashStyle,
  NetworkGraphDto,
  NetworkLayoutMode,
  NetworkPositions,
  AreaDto,
  circuitSummary,
  isUtilityKind,
  UTILITY_KINDS,
  UTILITY_LABELS,
  UtilityKind,
} from '@smart-home-inventory/shared';
import {
  mdiBackupRestore,
  mdiFileTreeOutline,
  mdiFitToScreenOutline,
  mdiGraphOutline,
  mdiGrid,
  mdiRefresh,
  mdiUndo,
} from '@mdi/js';
import { AreasApi, AutoLinkApi } from '../../core/api/api.services';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { downstreamOf, H_WRAP, LaidOutNode, layoutGraph, layoutHierarchy, GRID, snapToGrid } from './network-layout';

const MODE_PREF_KEY = 'shi.network.mode';
const WRAP_PREF_KEY = 'shi.network.wrap';
const WRAP_CHOICES = [2, 3, 4, 5, 6];
const SNAP_PREF_KEY = 'shi.network.snap';
const UNDO_LIMIT = 5;
function readSnapPref(): boolean {
  try {
    return localStorage.getItem(SNAP_PREF_KEY) === '1';
  } catch {
    return false;
  }
}
function readWrapPref(): number {
  try {
    const n = Number(localStorage.getItem(WRAP_PREF_KEY));
    return WRAP_CHOICES.includes(n) ? n : H_WRAP;
  } catch {
    return H_WRAP;
  }
}
function readModePref(): NetworkLayoutMode {
  try {
    return localStorage.getItem(MODE_PREF_KEY) === 'radial' ? 'radial' : 'hierarchy';
  } catch {
    return 'hierarchy';
  }
}

/**
 * Network map: every documented connection as a graph, laid out as radial
 * trees around each controller. Edges take the connection type's colour and
 * dash; auto-created links draw slightly lighter than hand-drawn ones.
 * Pan by dragging, zoom with the wheel/pinch, click a node to open it.
 */
@Component({
  selector: 'app-network-page',
  imports: [RouterLink, IconComponent, EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="header">
      <h1>{{ mapKind() ? labels[mapKind()!] + ' map' : 'Network map' }}</h1>
      <div class="head-actions">
        <label class="wrap-pick" title="Show one utility, or every connection">
          Show
          <select class="text" [value]="mapKind() ?? ''" (change)="setMap($any($event.target).value)">
            <option value="">All connections</option>
            @for (u of utilityKinds; track u) {
              <option [value]="u">{{ labels[u] }}</option>
            }
          </select>
        </label>
        <div class="segmented" role="group" aria-label="Layout">
          <button type="button" [class.active]="mode() === 'hierarchy'" (click)="setMode('hierarchy')" title="Top-down tree">
            <app-icon [path]="icons.tree" [size]="16" /> Hierarchy
          </button>
          <button type="button" [class.active]="mode() === 'radial'" (click)="setMode('radial')" title="Hub and spoke">
            <app-icon [path]="icons.graph" [size]="16" /> Radial
          </button>
        </div>
        @if (mode() === 'hierarchy') {
          <label class="wrap-pick" title="Most devices side by side before wrapping to a new row">
            Wrap at
            <select class="text" [value]="wrap()" (change)="setWrap(+$any($event.target).value)">
              @for (n of wrapChoices; track n) {
                <option [value]="n">{{ n }}</option>
              }
            </select>
          </label>
        }
        <button
          class="btn secondary"
          [class.on]="snap()"
          (click)="toggleSnap()"
          [title]="snap() ? 'Snap to grid: on' : 'Snap to grid: off'"
          [attr.aria-pressed]="snap()"
        >
          <app-icon [path]="icons.grid" [size]="18" />
        </button>
        <button
          class="btn secondary"
          (click)="undo()"
          [disabled]="undoStack().length === 0"
          [title]="undoStack().length ? 'Undo move (' + undoStack().length + ' left) · Ctrl+Z' : 'Nothing to undo'"
        >
          <app-icon [path]="icons.undo" [size]="18" />
          @if (undoStack().length) {
            <span class="undo-count">{{ undoStack().length }}</span>
          }
        </button>
        @if (hasOverrides()) {
          <button class="btn secondary" (click)="resetPositions()" title="Forget dragged positions for this layout">
            <app-icon [path]="icons.reset" [size]="18" />
          </button>
        }
        <button class="btn secondary" (click)="fit()" title="Fit to screen">
          <app-icon [path]="icons.fit" [size]="18" />
        </button>
        <button class="btn secondary" (click)="load()" title="Reload">
          <app-icon [path]="icons.refresh" [size]="18" />
        </button>
        <a class="btn secondary" routerLink="/connections">Connections</a>
      </div>
    </div>

    @if (graph(); as g) {
      <div class="chips legend">
        @for (t of usedTypes(); track t.key) {
          <button
            class="chip"
            [class.active]="visibleTypes().has(t.key)"
            (click)="toggleType(t.key)"
            [title]="t.label"
          >
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="1"
                y1="4"
                x2="21"
                y2="4"
                [attr.stroke]="t.color"
                stroke-width="2.5"
                [attr.stroke-dasharray]="dash(t.dash)"
              />
            </svg>
            {{ t.label }}
            <span class="muted">{{ countFor(t.key) }}</span>
          </button>
        }
        <span class="node-legend muted small">
          <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="var(--primary-color, #03a9f4)" /></svg>
          controller
          <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill="var(--secondary-text-color, #9e9e9e)" /></svg>
          smart device
          <svg width="12" height="12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="var(--accent-color, #ff9800)" /></svg>
          non-smart / added by you
        </span>
        <span class="muted small legend-note">
          {{ layout().nodes.length }} devices · {{ layout().edges.length }} links
          @if (layout().unlinked.length) {
            · <button class="linkish" (click)="showUnlinked.set(!showUnlinked())">
              {{ layout().unlinked.length }} unlinked
            </button>
          }
        </span>
      </div>

      @if (layout().edges.length > 0) {
        <div
          class="card canvas"
          #canvas
          (wheel)="onWheel($event)"
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="onPointerUp($event)"
          (pointercancel)="onPointerUp($event)"
          (pointerleave)="onPointerUp($event)"
        >
          <svg #svg [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet">
            @if (snap()) {
              <defs>
                <pattern id="net-grid" [attr.width]="grid" [attr.height]="grid" patternUnits="userSpaceOnUse">
                  <circle cx="0" cy="0" r="1" class="grid-dot" />
                </pattern>
              </defs>
              <rect
                [attr.x]="camView().x"
                [attr.y]="camView().y"
                [attr.width]="camView().w"
                [attr.height]="camView().h"
                fill="url(#net-grid)"
                pointer-events="none"
              />
            }
            <g>
              @for (e of layout().edges; track e.edge.id) {
                <path
                  [attr.d]="edgePath(e.from, e.to)"
                  fill="none"
                  [attr.stroke]="colorOf(e.edge.type)"
                  [attr.stroke-dasharray]="dash(dashOf(e.edge.type))"
                  [attr.stroke-opacity]="e.edge.auto ? 0.55 : 0.9"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <title>{{ e.from.node.name }} → {{ e.to.node.name }} · {{ labelOf(e.edge.type) }}{{ edgeCaption(e.edge) ? ' · ' + edgeCaption(e.edge) : '' }}{{ e.edge.auto ? ' (auto)' : '' }}</title>
                </path>
              }
            </g>
            <g class="edge-labels">
              @for (e of layout().edges; track e.edge.id) {
                @if (edgeCaption(e.edge); as cap) {
                  <text [attr.x]="labelPos(e.from, e.to).x" [attr.y]="labelPos(e.from, e.to).y" [attr.text-anchor]="mode() === 'radial' ? 'middle' : 'start'">
                    {{ cap }}
                  </text>
                }
              }
            </g>
            <g>
              @for (n of layout().nodes; track n.node.id) {
                <g
                  class="node"
                  [class.controller]="n.node.isController"
                  [class.hover]="hovered() === n.node.id"
                  [class.dragging]="dragId === n.node.id"
                  [attr.transform]="'translate(' + n.x + ',' + n.y + ')'"
                  (pointerdown)="onNodeDown($event, n)"
                  (click)="open(n)"
                  (pointerenter)="hovered.set(n.node.id)"
                  (pointerleave)="hovered.set(null)"
                >
                  @if (n.node.source === 'manual') {
                    <!-- non-smart / added by you: square -->
                    <rect
                      [attr.x]="-radius(n)"
                      [attr.y]="-radius(n)"
                      [attr.width]="radius(n) * 2"
                      [attr.height]="radius(n) * 2"
                      rx="2"
                      [attr.fill]="fillOf(n)"
                    />
                  } @else {
                    <circle [attr.r]="radius(n)" [attr.fill]="fillOf(n)" />
                  }
                  @if (n.node.isController) {
                    <circle [attr.r]="radius(n) + 4" fill="none" [attr.stroke]="fillOf(n)" stroke-opacity="0.35" stroke-width="3" />
                  }
                  <text
                    [attr.y]="radius(n) + 13"
                    text-anchor="middle"
                    [class.dim]="n.depth > 1 && hovered() !== n.node.id && n.childCount === 0"
                  >
                    {{ shortName(n.node.name) }}
                  </text>
                  <title>{{ n.node.name }}{{ n.node.areaName ? ' · ' + n.node.areaName : '' }}{{ n.node.model ? ' · ' + (n.node.brand ?? n.node.manufacturer ?? '') + ' ' + n.node.model : '' }}</title>
                </g>
              }
            </g>
          </svg>
        </div>
        <p class="muted small hint">
          Drag a device to move it with everything below it (saved) · drag the background to pan ·
          scroll or pinch to zoom · tap a device to open it. Faded lines were created by auto-link.
          @if (mapKind() === 'electrical') {
            Breaker, amps and area served come from each circuit's connection (edit it on the Connections page).
          }
        </p>
      } @else {
        <app-empty-state
          [icon]="icons.graph"
          message="No connections to draw yet — run Auto-link on the Connections page or add connections by hand"
        />
      }

      @if (showUnlinked() && layout().unlinked.length) {
        <div class="card unlinked">
          <h3>Not linked to anything</h3>
          <div class="chips">
            @for (n of layout().unlinked; track n.id) {
              <a class="chip" [routerLink]="['/devices', n.id]">{{ n.name }}</a>
            }
          </div>
        </div>
      }
    } @else if (loaded()) {
      <app-empty-state [icon]="icons.graph" message="Could not load the network graph" />
    }
  `,
  styles: `
    .wrap-pick { display: flex; align-items: center; gap: 6px; font-size: 0.9em; }
    .btn.on { background: color-mix(in srgb, var(--primary-color) 22%, transparent); }
    .undo-count { font-size: 0.75em; margin-left: 2px; }
    .grid-dot { fill: var(--secondary-text-color, #9e9e9e); opacity: 0.22; }
    .edge-labels text {
      font-size: 10px;
      fill: var(--secondary-text-color, #9e9e9e);
      paint-order: stroke;
      stroke: var(--card-background-color, #1c1c1c);
      stroke-width: 3px;
      pointer-events: none;
    }
    .wrap-pick select { width: auto; padding: 4px 6px; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .header h1 {
      margin: 0;
    }
    .head-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .segmented {
      display: inline-flex;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
      overflow: hidden;
    }
    .segmented button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: transparent;
      border: 0;
      border-right: 1px solid var(--divider-color);
      padding: 6px 10px;
      color: var(--secondary-text-color);
      cursor: pointer;
      font: inherit;
    }
    .segmented button:last-child {
      border-right: 0;
    }
    .segmented button.active {
      background: color-mix(in srgb, var(--primary-color) 18%, transparent);
      color: var(--primary-text-color);
      font-weight: 600;
    }
    .node.dragging {
      cursor: grabbing;
    }
    .node.dragging circle {
      stroke: var(--primary-text-color);
      stroke-width: 2;
    }
    .legend {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 12px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .node-legend {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 8px;
    }
    .node-legend svg {
      margin-left: 6px;
    }
    .legend-note {
      margin-left: auto;
    }
    .small {
      font-size: 0.85em;
    }
    .linkish {
      background: none;
      border: 0;
      padding: 0;
      color: var(--primary-color);
      cursor: pointer;
      font: inherit;
    }
    .canvas {
      height: calc(100vh - 230px);
      min-height: 360px;
      padding: 0;
      overflow: hidden;
      touch-action: none;
      cursor: grab;
      user-select: none;
    }
    .canvas:active {
      cursor: grabbing;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .node {
      cursor: pointer;
    }
    .node text {
      font-size: 11px;
      fill: var(--primary-text-color);
      paint-order: stroke;
      stroke: var(--card-background-color, #1c1c1c);
      stroke-width: 3px;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .node text.dim {
      opacity: 0.55;
    }
    .node.hover text {
      font-weight: 600;
      opacity: 1;
    }
    .node.controller text {
      font-weight: 600;
      font-size: 12px;
    }
    .hint {
      margin: 8px 0 0;
    }
    .unlinked {
      margin-top: 12px;
    }
    .unlinked h3 {
      margin-top: 0;
    }
  `,
})
export class NetworkPageComponent implements OnInit {
  private readonly api = inject(AutoLinkApi);
  private readonly areasApi = inject(AreasApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  private readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('svg');

  protected readonly icons = {
    fit: mdiFitToScreenOutline,
    refresh: mdiRefresh,
    graph: mdiGraphOutline,
    tree: mdiFileTreeOutline,
    reset: mdiBackupRestore,
    grid: mdiGrid,
    undo: mdiUndo,
  };
  protected readonly utilityKinds = UTILITY_KINDS;
  protected readonly labels = UTILITY_LABELS;
  protected readonly grid = GRID;

  /** null = every connection; otherwise one utility's map. */
  protected readonly mapKind = signal<UtilityKind | null>(null);
  protected readonly snap = signal(readSnapPref());
  /** Positions before each of the last few moves; cleared when you leave. */
  protected readonly undoStack = signal<NetworkPositions[]>([]);
  private areaNames = new Map<string, string>();

  protected readonly mode = signal<NetworkLayoutMode>(readModePref());
  protected readonly wrap = signal(readWrapPref());
  protected readonly wrapChoices = WRAP_CHOICES;
  /** Hand-placed positions for the current mode (deviceId → x,y). */
  protected readonly overrides = signal<NetworkPositions>({});
  protected readonly hasOverrides = computed(() => Object.keys(this.overrides()).length > 0);

  protected readonly graph = signal<NetworkGraphDto | null>(null);
  protected readonly loaded = signal(false);
  protected readonly visibleTypes = signal<Set<string>>(new Set());
  protected readonly hovered = signal<string | null>(null);
  protected readonly showUnlinked = signal(false);

  // viewBox camera
  private readonly cam = signal({ x: 0, y: 0, w: 1000, h: 600 });
  protected readonly camView = computed(() => this.cam());
  protected readonly viewBox = computed(() => {
    const c = this.cam();
    return `${c.x} ${c.y} ${c.w} ${c.h}`;
  });

  /** Computed layout for the current mode, before hand-placed overrides. */
  private readonly baseLayout = computed(() => {
    const g = this.graph();
    if (!g) return { nodes: [], edges: [], width: 1, height: 1, unlinked: [] };
    return this.mode() === 'hierarchy'
      ? layoutHierarchy(g, this.visibleTypes(), this.wrap())
      : layoutGraph(g, this.visibleTypes());
  });

  /** Final positions: overrides win. Edges re-point at the moved nodes. */
  protected readonly layout = computed(() => {
    const base = this.baseLayout();
    const ov = this.overrides();
    if (Object.keys(ov).length === 0) return base;
    const nodes = base.nodes.map((n) => (ov[n.node.id] ? { ...n, ...ov[n.node.id] } : n));
    const byId = new Map(nodes.map((n) => [n.node.id, n]));
    const edges = base.edges.map((e) => ({
      ...e,
      from: byId.get(e.from.node.id) ?? e.from,
      to: byId.get(e.to.node.id) ?? e.to,
    }));
    return { ...base, nodes, edges };
  });

  /** Only types that actually appear in the graph (and belong to the
   *  chosen utility map), in store order. */
  protected readonly usedTypes = computed(() => {
    const g = this.graph();
    if (!g) return [];
    const used = new Set(g.edges.map((e) => e.type));
    const map = this.mapKind();
    return g.types.filter((t) => used.has(t.key) && (!map || t.utility === map));
  });

  private typeMap = new Map<string, NetworkGraphDto['types'][number]>();

  ngOnInit(): void {
    const m = this.route.snapshot.queryParamMap.get('map');
    this.mapKind.set(isUtilityKind(m) ? m : null);
    this.areasApi.list().subscribe((areas: AreaDto[]) => {
      this.areaNames = new Map(areas.map((a) => [a.id, a.name]));
    });
    this.load();
    this.loadPositions();
  }

  /** Saved positions are kept per layout mode and per utility map. */
  private layoutKey(): string {
    const m = this.mapKind();
    return m ? `${this.mode()}:${m}` : this.mode();
  }

  private typesForMap(g: NetworkGraphDto): Set<string> {
    const m = this.mapKind();
    const used = new Set(g.edges.map((e) => e.type));
    return new Set(
      g.types.filter((t) => used.has(t.key) && (!m || t.utility === m)).map((t) => t.key)
    );
  }

  protected setMap(value: string): void {
    const m = isUtilityKind(value) ? value : null;
    if (m === this.mapKind()) return;
    this.mapKind.set(m);
    this.undoStack.set([]);
    this.router.navigate([], { relativeTo: this.route, queryParams: { map: m }, replaceUrl: true });
    const g = this.graph();
    if (g) this.visibleTypes.set(this.typesForMap(g));
    this.loadPositions();
  }

  protected toggleSnap(): void {
    const on = !this.snap();
    this.snap.set(on);
    try {
      localStorage.setItem(SNAP_PREF_KEY, on ? '1' : '0');
    } catch {
      /* per-browser convenience only */
    }
  }

  private pushUndo(snapshot: NetworkPositions): void {
    this.undoStack.update((s) => [...s, snapshot].slice(-UNDO_LIMIT));
  }

  protected undo(): void {
    const stack = this.undoStack();
    if (stack.length === 0) return;
    this.overrides.set(stack[stack.length - 1]);
    this.undoStack.set(stack.slice(0, -1));
    this.scheduleSave(true);
  }

  @HostListener('window:keydown', ['$event'])
  protected onKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z' && this.undoStack().length) {
      ev.preventDefault();
      this.undo();
    }
  }

  /** "#12 · 20A · Kitchen" for electrical circuits; else the connection label. */
  protected edgeCaption(edge: NetworkGraphDto['edges'][number]): string {
    const c = edge.circuit;
    if (!c) return this.mapKind() ? edge.label ?? '' : '';
    const served = [
      ...(c.servesAreaIds ?? []).map((id) => this.areaNames.get(id) ?? ''),
      c.serves ?? '',
    ].filter(Boolean);
    return [circuitSummary(c), ...served].filter(Boolean).join(' · ');
  }

  protected labelPos(a: LaidOutNode, b: LaidOutNode): { x: number; y: number } {
    if (this.mode() === 'radial' || b.y <= a.y + 10) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 4 };
    return { x: b.x + 5, y: b.y - 34 };
  }

  protected setWrap(n: number): void {
    if (!WRAP_CHOICES.includes(n)) return;
    this.wrap.set(n);
    try {
      localStorage.setItem(WRAP_PREF_KEY, String(n));
    } catch {
      /* per-browser convenience only */
    }
  }

  protected setMode(mode: NetworkLayoutMode): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.undoStack.set([]);
    try {
      localStorage.setItem(MODE_PREF_KEY, mode);
    } catch {
      /* per-browser convenience only */
    }
    this.loadPositions();
  }

  private loadPositions(): void {
    const key = this.layoutKey();
    this.api.getLayout(key).subscribe({
      next: (l) => {
        if (this.layoutKey() !== key) return;
        this.overrides.set(l.positions);
        queueMicrotask(() => this.fit());
      },
      error: () => this.overrides.set({}),
    });
  }

  protected resetPositions(): void {
    const key = this.layoutKey();
    this.pushUndo(this.overrides());
    this.api.resetLayout(key).subscribe(() => {
      this.overrides.set({});
      queueMicrotask(() => this.fit());
    });
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleSave(now = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const key = this.layoutKey();
    const run = () => {
      const positions = this.overrides();
      if (Object.keys(positions).length === 0) this.api.resetLayout(key).subscribe();
      else this.api.saveLayout(key, positions).subscribe();
    };
    if (now) run();
    else this.saveTimer = setTimeout(run, 600);
  }

  /** Straight in radial mode; right-angled "org chart" elbows in hierarchy. */
  protected edgePath(a: LaidOutNode, b: LaidOutNode): string {
    if (this.mode() === 'radial') return `M${a.x},${a.y} L${b.x},${b.y}`;
    if (b.y <= a.y + 10) return `M${a.x},${a.y} L${b.x},${b.y}`;
    // Bend just above the child's row so lines to wrapped rows run down the
    // gaps between rows rather than through the labels above them.
    const midY = b.y - 30;
    return `M${a.x},${a.y} V${midY} H${b.x} V${b.y}`;
  }

  protected load(): void {
    this.api.graph().subscribe({
      next: (g) => {
        this.typeMap = new Map(g.types.map((t) => [t.key, t]));
        this.graph.set(g);
        if (this.visibleTypes().size === 0) {
          this.visibleTypes.set(this.typesForMap(g));
        }
        this.loaded.set(true);
        queueMicrotask(() => this.fit());
      },
      error: () => this.loaded.set(true),
    });
  }

  protected fit(): void {
    const l = this.layout();
    if (l.nodes.length === 0) return;
    const xs = l.nodes.map((n) => n.x);
    const ys = l.nodes.map((n) => n.y);
    const pad = 80;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    // Match the canvas aspect so "fit" really fits.
    const el = this.canvas()?.nativeElement;
    const aspect = el ? el.clientWidth / Math.max(el.clientHeight, 1) : 16 / 9;
    let vw = w;
    let vh = h;
    if (vw / vh > aspect) vh = vw / aspect;
    else vw = vh * aspect;
    this.cam.set({ x: minX - (vw - w) / 2, y: minY - (vh - h) / 2, w: vw, h: vh });
  }

  protected toggleType(key: string): void {
    this.visibleTypes.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected countFor(type: string): number {
    return this.graph()?.edges.filter((e) => e.type === type).length ?? 0;
  }

  protected colorOf(type: string): string {
    return this.typeMap.get(type)?.color ?? '#757575';
  }
  protected dashOf(type: string): string {
    return this.typeMap.get(type)?.dash ?? 'solid';
  }
  protected labelOf(type: string): string {
    return this.typeMap.get(type)?.label ?? type;
  }
  protected dash(style: string): string | null {
    return DASH_STYLE_PATTERNS[style as DashStyle] ?? null;
  }

  protected radius(n: LaidOutNode): number {
    if (n.depth === 0) return 14;
    return n.node.isController ? 10 : 6;
  }
  protected fillOf(n: LaidOutNode): string {
    if (n.node.source === 'manual') return 'var(--accent-color, #ff9800)';
    return n.node.isController ? 'var(--primary-color, #03a9f4)' : 'var(--secondary-text-color, #9e9e9e)';
  }
  protected shortName(name: string): string {
    return name.length > 22 ? name.slice(0, 20) + '…' : name;
  }

  protected open(n: LaidOutNode): void {
    if (this.dragged) return;
    this.router.navigate(['/devices', n.node.id]);
  }

  // --- node drag -------------------------------------------------------------
  protected dragId: string | null = null;
  private dragOffset = { x: 0, y: 0 };
  /** Start positions of the dragged device and everything below it. */
  private dragGroup = new Map<string, { x: number; y: number }>();
  private dragBefore: NetworkPositions = {};

  private toSvg(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = this.svgRef()?.nativeElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  protected onNodeDown(ev: PointerEvent, n: LaidOutNode): void {
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    ev.stopPropagation();
    const p = this.toSvg(ev.clientX, ev.clientY);
    if (!p) return;
    this.dragId = n.node.id;
    this.dragged = false;
    this.dragOffset = { x: p.x - n.x, y: p.y - n.y };
    const l = this.layout();
    const below = downstreamOf(
      l.edges.map((e) => ({ fromId: e.from.node.id, toId: e.to.node.id })),
      n.node.id
    );
    const pos = new Map(l.nodes.map((x) => [x.node.id, { x: x.x, y: x.y }]));
    this.dragGroup = new Map(
      [n.node.id, ...below].filter((id) => pos.has(id)).map((id) => [id, pos.get(id) as { x: number; y: number }])
    );
    this.dragBefore = this.overrides();
    this.last = { x: ev.clientX, y: ev.clientY };
    (this.canvas()?.nativeElement as HTMLElement | undefined)?.setPointerCapture?.(ev.pointerId);
  }

  // --- pan & zoom -----------------------------------------------------------
  private dragging = false;
  private dragged = false;
  private last = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  protected onPointerDown(ev: PointerEvent): void {
    if (this.dragId) return;
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this.dragging = true;
    this.dragged = false;
    this.last = { x: ev.clientX, y: ev.clientY };
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
  }

  protected onPointerMove(ev: PointerEvent): void {
    if (this.dragId) {
      const p = this.toSvg(ev.clientX, ev.clientY);
      if (!p) return;
      if (Math.abs(ev.clientX - this.last.x) + Math.abs(ev.clientY - this.last.y) > 3) {
        this.dragged = true;
      }
      if (!this.dragged) return;
      const start = this.dragGroup.get(this.dragId);
      if (!start) return;
      const dx = p.x - this.dragOffset.x - start.x;
      const dy = p.y - this.dragOffset.y - start.y;
      const snap = this.snap();
      const place = (v: number) => (snap ? snapToGrid(v) : Math.round(v));
      const moved: NetworkPositions = {};
      for (const [id, s] of this.dragGroup) moved[id] = { x: place(s.x + dx), y: place(s.y + dy) };
      this.overrides.update((o) => ({ ...o, ...moved }));
      return;
    }
    if (!this.dragging) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    const scale = this.cam().w / el.clientWidth;
    if (this.pointers.size === 2) {
      const d = this.pinchDistance();
      if (this.pinchDist > 0 && d > 0) this.zoomBy(this.pinchDist / d, this.pinchCenter(el));
      this.pinchDist = d;
      this.dragged = true;
      return;
    }
    const dx = (ev.clientX - this.last.x) * scale;
    const dy = (ev.clientY - this.last.y) * scale;
    if (Math.abs(ev.clientX - this.last.x) + Math.abs(ev.clientY - this.last.y) > 2) this.dragged = true;
    this.last = { x: ev.clientX, y: ev.clientY };
    this.cam.update((c) => ({ ...c, x: c.x - dx, y: c.y - dy }));
  }

  protected onPointerUp(ev: PointerEvent): void {
    if (this.dragId) {
      const moved = this.dragged;
      this.dragId = null;
      this.dragGroup.clear();
      if (moved) {
        this.pushUndo(this.dragBefore);
        this.scheduleSave();
      }
      setTimeout(() => (this.dragged = false), 0);
      return;
    }
    this.pointers.delete(ev.pointerId);
    if (this.pointers.size === 0) {
      this.dragging = false;
      // Let the click handler see `dragged` before resetting it.
      setTimeout(() => (this.dragged = false), 0);
    }
  }

  protected onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const el = this.canvas()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (ev.clientX - rect.left) / rect.width;
    const py = (ev.clientY - rect.top) / rect.height;
    this.zoomBy(ev.deltaY > 0 ? 1.15 : 1 / 1.15, { px, py });
  }

  private zoomBy(factor: number, at: { px: number; py: number }): void {
    this.cam.update((c) => {
      const w = Math.min(Math.max(c.w * factor, 200), 20000);
      const h = c.h * (w / c.w);
      return { x: c.x + (c.w - w) * at.px, y: c.y + (c.h - h) * at.py, w, h };
    });
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  private pinchCenter(el: HTMLElement): { px: number; py: number } {
    const [a, b] = [...this.pointers.values()];
    const rect = el.getBoundingClientRect();
    return {
      px: ((a.x + b.x) / 2 - rect.left) / rect.width,
      py: ((a.y + b.y) / 2 - rect.top) / rect.height,
    };
  }
}
