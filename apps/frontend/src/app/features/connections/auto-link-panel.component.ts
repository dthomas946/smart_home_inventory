import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AutoLinkPlanDto,
  AutoLinkStatusDto,
  DeviceDto,
  PlannedLinkDto,
  SkippedDeviceDto,
} from '@smart-home-inventory/shared';
import { mdiAutoFix, mdiRefresh } from '@mdi/js';
import { AutoLinkApi, DevicesApi } from '../../core/api/api.services';
import { ConfirmService } from '../../core/confirm/confirm.service';
import { ConnectionTypesStore } from '../../core/connection-types/connection-types.store';
import { ToastService } from '../../core/toast/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * Auto-link control panel for the Connections page.
 *
 * Flow: Preview (dry run against HA) → read what would change and why
 * devices were skipped → set default controllers for any protocol HA can't
 * place by itself → Apply. Overrides happen elsewhere (editing/deleting a
 * link in the table); this panel only shows how many exist and lets you
 * reset them.
 */
@Component({
  selector: 'app-auto-link-panel',
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card panel">
      <div class="panel-head">
        <div class="title">
          <app-icon [path]="icons.auto" [size]="20" />
          <h3>Auto-link smart devices to their controllers</h3>
        </div>
        <div class="head-actions">
          <button class="btn secondary" [disabled]="busy()" (click)="preview()">
            <app-icon [path]="icons.refresh" [size]="16" />
            {{ plan() ? 'Re-check' : 'Preview' }}
          </button>
          <button
            class="btn"
            [disabled]="busy() || !plan() || !hasChanges()"
            (click)="apply()"
            [title]="hasChanges() ? 'Create/update/remove the links shown below' : 'Nothing to change'"
          >
            Apply{{ hasChanges() ? ' (' + changeCount() + ')' : '' }}
          </button>
        </div>
      </div>

      <p class="muted summary">
        Uses Home Assistant's own registry: each device is linked to the hub it pairs
        through (Zigbee coordinator, Z-Wave stick, Hue bridge…). Devices HA talks to directly
        need a default controller per protocol below. Edit or delete any auto link to override it —
        re-runs leave overrides alone.
        @if (status(); as s) {
          <br />
          <span>
            {{ s.managedCount }} auto links
            @if (s.managedCount > 0) {
              <button class="linkish" (click)="removeAll()">(remove all)</button>
            }
            ·
            @if (s.suppressedCount > 0) {
              {{ s.suppressedCount }} overrides
              <button class="linkish" (click)="resetOverrides()">(reset)</button> ·
            }
            @if (s.lastRunAt) {
              last run {{ fmt(s.lastRunAt) }}
            } @else {
              never run
            }
          </span>
        }
      </p>

      @if (busy()) {
        <p class="muted">Reading the Home Assistant registry…</p>
      }

      @if (plan(); as p) {
        <!-- Default controllers -->
        <div class="rules">
          <h4>Default controllers</h4>
          <p class="muted small">
            For devices without a hub in HA. Suggestions come from what HA already names as a hub,
            plus devices in the <em>network</em> category.
          </p>
          <div class="rule-grid">
            @for (type of ruleTypes(); track type) {
              <label class="rule">
                <span>
                  <span class="type-dot" [style.background]="types.color(type)"></span>
                  {{ types.label(type) }}
                  @if (needCount(type) > 0) {
                    <span class="need" title="Devices waiting on this rule">{{ needCount(type) }} waiting</span>
                  }
                </span>
                <select class="text" [value]="ruleFor(type) ?? ''" (change)="setRule(type, $any($event.target).value)">
                  <option value="">— none —</option>
                  @if (p.controllerSuggestions[type]?.length) {
                    <optgroup label="Suggested">
                      @for (c of p.controllerSuggestions[type]; track c.deviceId) {
                        <option [value]="c.deviceId">
                          {{ c.deviceName }}{{ c.childCount ? ' (' + c.childCount + ' via HA)' : '' }}
                        </option>
                      }
                    </optgroup>
                  }
                  <optgroup label="All devices">
                    @for (d of devices(); track d.id) {
                      <option [value]="d.id">{{ d.name }}</option>
                    }
                  </optgroup>
                </select>
              </label>
            }
          </div>
        </div>

        <!-- Plan -->
        <div class="plan">
          <h4>
            Preview
            <span class="muted small">
              +{{ p.create.length }} new · ~{{ p.update.length }} changed · −{{ p.remove.length }} removed ·
              {{ p.unchanged }} unchanged · {{ p.skipped.length }} skipped
            </span>
          </h4>

          @if (p.create.length + p.update.length + p.remove.length === 0) {
            <p class="muted">Everything is already up to date.</p>
          }

          @for (section of sections(); track section.key) {
            @if (section.items.length > 0) {
              <details [open]="section.key !== 'remove'">
                <summary>
                  <span class="badge" [class]="'badge ' + section.key">{{ section.label }}</span>
                  {{ section.items.length }}
                </summary>
                <ul class="links">
                  @for (l of section.items; track l.autoKey) {
                    <li>
                      <a [routerLink]="['/devices', l.toDeviceId]">{{ l.toDeviceName }}</a>
                      <span class="muted">→</span>
                      <a [routerLink]="['/devices', l.fromDeviceId]">{{ l.fromDeviceName }}</a>
                      <span class="type-pill">
                        <span class="type-dot" [style.background]="types.color(l.type)"></span>
                        {{ types.label(l.type) }}
                      </span>
                      <span class="muted small">
                        {{ l.reason === 'via_device' ? 'HA hub' : 'default' }}
                        @if (l.platforms.length) { · {{ l.platforms.join(', ') }} }
                        @if (l.previous) {
                          · was {{ l.previous.fromDeviceName }} / {{ types.label(l.previous.type) }}
                        }
                      </span>
                    </li>
                  }
                </ul>
              </details>
            }
          }

          @if (p.skipped.length > 0) {
            <details>
              <summary>
                <span class="badge skipped">Skipped</span> {{ p.skipped.length }}
              </summary>
              <ul class="links">
                @for (s of skippedSorted(); track s.deviceId) {
                  <li>
                    <a [routerLink]="['/devices', s.deviceId]">{{ s.deviceName }}</a>
                    <span class="reason" [class]="'reason ' + s.reason">{{ reasonLabel(s) }}</span>
                    @if (s.platforms.length) {
                      <span class="muted small">{{ s.platforms.join(', ') }}</span>
                    }
                  </li>
                }
              </ul>
            </details>
          }

          @if (p.unmappedPlatforms.length > 0) {
            <p class="muted small">
              Integrations the planner doesn't know yet: <code>{{ p.unmappedPlatforms.join(', ') }}</code>.
              Set a default controller for the right protocol, or tell the maintainer.
            </p>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .panel {
      margin-bottom: 16px;
    }
    .panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .title h3 {
      margin: 0;
    }
    .head-actions {
      display: flex;
      gap: 8px;
    }
    .summary {
      margin: 8px 0 0;
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
    h4 {
      margin: 16px 0 4px;
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .rule-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 8px 16px;
    }
    .rule {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .rule > span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.9em;
    }
    .need {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--warning-color, #f9a825) 22%, transparent);
    }
    .type-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .type-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.85em;
      padding: 0 6px;
      border-radius: 4px;
      background: var(--chip-background-color);
    }
    details {
      margin: 6px 0;
    }
    summary {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--chip-background-color);
    }
    .badge.create {
      background: color-mix(in srgb, var(--success-color, #2e7d32) 22%, transparent);
    }
    .badge.update {
      background: color-mix(in srgb, var(--primary-color) 22%, transparent);
    }
    .badge.remove {
      background: color-mix(in srgb, var(--error-color, #c62828) 22%, transparent);
    }
    .links {
      list-style: none;
      margin: 6px 0 0;
      padding: 0 0 0 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 40vh;
      overflow-y: auto;
    }
    .links li {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .reason {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--chip-background-color);
    }
    .reason.no_controller {
      background: color-mix(in srgb, var(--warning-color, #f9a825) 22%, transparent);
    }
    .reason.manual_override,
    .reason.suppressed {
      background: color-mix(in srgb, var(--primary-color) 18%, transparent);
    }
    code {
      font-size: 0.9em;
    }
  `,
})
export class AutoLinkPanelComponent implements OnInit {
  private readonly api = inject(AutoLinkApi);
  private readonly devicesApi = inject(DevicesApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly types = inject(ConnectionTypesStore);

  /** Emitted after Apply so the parent can reload the connections table. */
  readonly applied = output<void>();

  protected readonly icons = { auto: mdiAutoFix, refresh: mdiRefresh };

  protected readonly status = signal<AutoLinkStatusDto | null>(null);
  protected readonly plan = signal<AutoLinkPlanDto | null>(null);
  protected readonly devices = signal<DeviceDto[]>([]);
  protected readonly busy = signal(false);

  protected readonly changeCount = computed(() => {
    const p = this.plan();
    return p ? p.create.length + p.update.length + p.remove.length : 0;
  });
  protected readonly hasChanges = computed(() => this.changeCount() > 0);

  /** Protocol types worth a default-controller rule: the network ones. */
  protected readonly ruleTypes = computed(() =>
    this.types
      .types()
      .filter((t) => t.group === 'wireless' || t.key === 'ethernet')
      .map((t) => t.key)
  );

  protected readonly sections = computed(() => {
    const p = this.plan();
    if (!p) return [] as Array<{ key: string; label: string; items: PlannedLinkDto[] }>;
    return [
      { key: 'create', label: 'New', items: p.create },
      { key: 'update', label: 'Changed', items: p.update },
      { key: 'remove', label: 'Removed', items: p.remove },
    ];
  });

  protected readonly skippedSorted = computed(() => {
    const p = this.plan();
    if (!p) return [];
    const order: Record<string, number> = {
      no_controller: 0,
      unknown_protocol: 1,
      manual_override: 2,
      suppressed: 3,
      self: 4,
    };
    return [...p.skipped].sort(
      (a, b) => order[a.reason] - order[b.reason] || a.deviceName.localeCompare(b.deviceName)
    );
  });

  ngOnInit(): void {
    this.api.status().subscribe((s) => this.status.set(s));
    this.devicesApi.list().subscribe((d) => this.devices.set(d));
  }

  protected preview(): void {
    this.busy.set(true);
    this.api.plan().subscribe({
      next: (p) => {
        this.plan.set(p);
        this.busy.set(false);
      },
      error: () => this.busy.set(false),
    });
  }

  protected apply(): void {
    this.busy.set(true);
    this.api.apply().subscribe({
      next: (r) => {
        this.toast.success(`Auto-link: +${r.created} new, ${r.updated} changed, ${r.removed} removed`);
        this.applied.emit();
        this.api.status().subscribe((s) => this.status.set(s));
        this.preview();
      },
      error: () => this.busy.set(false),
    });
  }

  protected ruleFor(type: string): string | null {
    return this.plan()?.rules.find((r) => r.type === type)?.controllerDeviceId ?? null;
  }

  protected needCount(type: string): number {
    return (
      this.plan()?.skipped.filter((s) => s.reason === 'no_controller' && s.type === type).length ??
      0
    );
  }

  protected setRule(type: string, deviceId: string): void {
    this.api
      .setRules({
        rules: [{ type: type as never, controllerDeviceId: deviceId || null }],
      })
      .subscribe(() => this.preview());
  }

  protected async resetOverrides(): Promise<void> {
    const n = this.status()?.suppressedCount ?? 0;
    const ok = await this.confirm.ask(
      `Forget ${n} override${n === 1 ? '' : 's'}? Links you deleted or edited may be recreated on the next Apply. Your manual connections are not touched.`,
      { confirmLabel: 'Reset' }
    );
    if (!ok) return;
    this.api.resetSuppressions().subscribe(() => {
      this.api.status().subscribe((s) => this.status.set(s));
      if (this.plan()) this.preview();
    });
  }

  protected async removeAll(): Promise<void> {
    const n = this.status()?.managedCount ?? 0;
    const ok = await this.confirm.ask(
      `Remove all ${n} auto-created links? Your manual connections stay. A later Apply can recreate them.`,
      { confirmLabel: 'Remove all' }
    );
    if (!ok) return;
    this.api.removeAllManaged().subscribe((r) => {
      this.toast.success(`Removed ${r.removed} auto links`);
      this.applied.emit();
      this.api.status().subscribe((s) => this.status.set(s));
      if (this.plan()) this.preview();
    });
  }

  protected fmt(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected reasonLabel(s: SkippedDeviceDto): string {
    switch (s.reason) {
      case 'no_controller':
        return `needs a default ${this.types.label(s.type ?? 'other')} controller`;
      case 'unknown_protocol':
        return 'protocol unknown';
      case 'manual_override':
        return 'manual link exists';
      case 'suppressed':
        return 'overridden';
      case 'self':
        return 'is the controller';
    }
  }
}
