import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DASH_STYLE_PATTERNS, DashStyle, NetworkGraphDto } from '@smart-home-inventory/shared';
import { mdiFitToScreenOutline, mdiGraphOutline, mdiRefresh } from '@mdi/js';
import { AutoLinkApi } from '../../core/api/api.services';
import { EmptyStateComponent } from '../../shared/ui/empty-state.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { LaidOutNode, layoutGraph } from './network-layout';

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
      <h1>Network map</h1>
      <div class="head-actions">
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
          <svg [attr.viewBox]="viewBox()" preserveAspectRatio="xMidYMid meet">
            <g>
              @for (e of layout().edges; track e.edge.id) {
                <line
                  [attr.x1]="e.from.x"
                  [attr.y1]="e.from.y"
                  [attr.x2]="e.to.x"
                  [attr.y2]="e.to.y"
                  [attr.stroke]="colorOf(e.edge.type)"
                  [attr.stroke-dasharray]="dash(dashOf(e.edge.type))"
                  [attr.stroke-opacity]="e.edge.auto ? 0.55 : 0.9"
                  stroke-width="2"
                  stroke-linecap="round"
                >
                  <title>{{ e.from.node.name }} → {{ e.to.node.name }} · {{ labelOf(e.edge.type) }}{{ e.edge.auto ? ' (auto)' : '' }}</title>
                </line>
              }
            </g>
            <g>
              @for (n of layout().nodes; track n.node.id) {
                <g
                  class="node"
                  [class.controller]="n.node.isController"
                  [class.hover]="hovered() === n.node.id"
                  [attr.transform]="'translate(' + n.x + ',' + n.y + ')'"
                  (click)="open(n)"
                  (pointerenter)="hovered.set(n.node.id)"
                  (pointerleave)="hovered.set(null)"
                >
                  <circle [attr.r]="radius(n)" [attr.fill]="fillOf(n)" />
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
        <p class="muted small hint">Drag to pan · scroll or pinch to zoom · tap a device to open it. Faded lines were created by auto-link.</p>
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
  private readonly router = inject(Router);
  private readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');

  protected readonly icons = { fit: mdiFitToScreenOutline, refresh: mdiRefresh, graph: mdiGraphOutline };

  protected readonly graph = signal<NetworkGraphDto | null>(null);
  protected readonly loaded = signal(false);
  protected readonly visibleTypes = signal<Set<string>>(new Set());
  protected readonly hovered = signal<string | null>(null);
  protected readonly showUnlinked = signal(false);

  // viewBox camera
  private readonly cam = signal({ x: 0, y: 0, w: 1000, h: 600 });
  protected readonly viewBox = computed(() => {
    const c = this.cam();
    return `${c.x} ${c.y} ${c.w} ${c.h}`;
  });

  protected readonly layout = computed(() => {
    const g = this.graph();
    return g
      ? layoutGraph(g, this.visibleTypes())
      : { nodes: [], edges: [], width: 1, height: 1, unlinked: [] };
  });

  /** Only types that actually appear in the graph, in store order. */
  protected readonly usedTypes = computed(() => {
    const g = this.graph();
    if (!g) return [];
    const used = new Set(g.edges.map((e) => e.type));
    return g.types.filter((t) => used.has(t.key));
  });

  private typeMap = new Map<string, NetworkGraphDto['types'][number]>();

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.api.graph().subscribe({
      next: (g) => {
        this.typeMap = new Map(g.types.map((t) => [t.key, t]));
        this.graph.set(g);
        if (this.visibleTypes().size === 0) {
          this.visibleTypes.set(new Set(g.edges.map((e) => e.type)));
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

  // --- pan & zoom -----------------------------------------------------------
  private dragging = false;
  private dragged = false;
  private last = { x: 0, y: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;

  protected onPointerDown(ev: PointerEvent): void {
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    this.dragging = true;
    this.dragged = false;
    this.last = { x: ev.clientX, y: ev.clientY };
    if (this.pointers.size === 2) this.pinchDist = this.pinchDistance();
  }

  protected onPointerMove(ev: PointerEvent): void {
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
