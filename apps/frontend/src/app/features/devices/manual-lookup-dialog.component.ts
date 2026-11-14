import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ManualSearchResultDto } from '@smart-home-inventory/shared';
import { mdiFilePdfBox, mdiMagnify, mdiOpenInNew, mdiWeb } from '@mdi/js';
import { ManualLookupApi } from '../../core/api/api.services';
import { ToastService } from '../../core/toast/toast.service';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * "Find manual" for a device: run a web search for its documentation, pick a
 * hit, and have the backend fetch + attach it. Search is best-effort (the
 * provider is scraped, see search-provider.ts), so the paste-a-URL path is
 * always available and is the same server endpoint underneath.
 */
@Component({
  selector: 'app-manual-lookup-dialog',
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (cancel)="close()">
      <h3>Find manual</h3>

      <form class="search-row" (submit)="runSearch($event)">
        <input
          class="text"
          type="search"
          name="q"
          [(ngModel)]="query"
          placeholder="e.g. Carrier 24ACC636 installation manual"
          [disabled]="searching()"
        />
        <button type="submit" class="btn secondary" [disabled]="searching()">
          <app-icon [path]="icons.search" [size]="18" /> Search
        </button>
      </form>

      @if (searching()) {
        <p class="muted">Searching the web…</p>
      } @else if (result(); as r) {
        @if (r.candidates.length > 0) {
          <ul class="candidates">
            @for (c of r.candidates; track c.url) {
              <li>
                <div class="cand-main">
                  <app-icon
                    class="cand-icon"
                    [class.pdf]="c.isPdf"
                    [path]="c.isPdf ? icons.pdf : icons.web"
                    [size]="20"
                  />
                  <div class="cand-text">
                    <a [href]="c.url" target="_blank" rel="noopener" class="cand-title">
                      {{ c.title }} <app-icon [path]="icons.openInNew" [size]="12" />
                    </a>
                    <span class="muted host">{{ c.host }}</span>
                    @if (c.snippet) {
                      <span class="muted snippet">{{ c.snippet }}</span>
                    }
                  </div>
                </div>
                <button
                  type="button"
                  class="btn secondary attach"
                  [disabled]="attaching() !== null"
                  (click)="attach(c.url, c.title)"
                  [title]="c.isPdf ? 'Download and attach this PDF' : 'Try to fetch this as a PDF'"
                >
                  {{ attaching() === c.url ? 'Fetching…' : 'Attach' }}
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">
            No results from {{ r.provider }}. Try a different query (add "installation" or
            "service"), or paste a direct PDF link below.
          </p>
        }
      }

      <div class="paste">
        <span class="muted label">Have a link already?</span>
        <form class="search-row" (submit)="attachPasted($event)">
          <input
            class="text"
            type="url"
            name="url"
            [(ngModel)]="pastedUrl"
            placeholder="https://…/manual.pdf"
            [disabled]="attaching() !== null"
          />
          <button
            type="submit"
            class="btn secondary"
            [disabled]="attaching() !== null || !pastedUrl.trim()"
          >
            {{ attaching() === pastedUrl ? 'Fetching…' : 'Attach URL' }}
          </button>
        </form>
      </div>

      <div class="actions">
        <button type="button" class="btn secondary" (click)="close()">Close</button>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(560px, 92vw);
    }
    .search-row {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }
    .search-row input {
      flex: 1;
      min-width: 0;
    }
    .candidates {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 50vh;
      overflow-y: auto;
    }
    .candidates li {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      justify-content: space-between;
      padding: 8px;
      border: 1px solid var(--divider-color);
      border-radius: 8px;
    }
    .cand-main {
      display: flex;
      gap: 8px;
      min-width: 0;
    }
    .cand-icon {
      flex-shrink: 0;
      margin-top: 2px;
      color: var(--secondary-text-color);
    }
    .cand-icon.pdf {
      color: var(--error-color, #c62828);
    }
    .cand-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .cand-title {
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .host {
      font-size: 0.85em;
    }
    .snippet {
      font-size: 0.85em;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .attach {
      flex-shrink: 0;
    }
    .paste {
      border-top: 1px solid var(--divider-color);
      padding-top: 10px;
    }
    .paste .label {
      display: block;
      margin-bottom: 6px;
      font-size: 0.9em;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
    }
  `,
})
export class ManualLookupDialogComponent {
  private readonly api = inject(ManualLookupApi);
  private readonly toast = inject(ToastService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly deviceId = input.required<string>();
  /** Pre-filled query, normally "<manufacturer> <model> manual". */
  readonly initialQuery = input<string>('');
  readonly attached = output<void>();

  protected readonly icons = {
    search: mdiMagnify,
    pdf: mdiFilePdfBox,
    web: mdiWeb,
    openInNew: mdiOpenInNew,
  };

  protected query = '';
  protected pastedUrl = '';
  protected readonly isOpen = signal(false);
  protected readonly searching = signal(false);
  protected readonly result = signal<ManualSearchResultDto | null>(null);
  /** URL currently being fetched by the server, or null. */
  protected readonly attaching = signal<string | null>(null);

  constructor() {
    effect(() => {
      const el = this.dlg().nativeElement;
      if (this.isOpen()) {
        if (!el.open) el.showModal();
      } else if (el.open) {
        el.close();
      }
    });
  }

  open(): void {
    this.query = this.initialQuery();
    this.result.set(null);
    this.isOpen.set(true);
    if (this.query.trim()) this.search(this.query);
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected runSearch(event: Event): void {
    event.preventDefault();
    this.search(this.query);
  }

  private search(q: string): void {
    this.searching.set(true);
    this.api.search(this.deviceId(), q.trim() || undefined).subscribe({
      next: (r) => {
        this.query = r.query;
        this.result.set(r);
        this.searching.set(false);
      },
      error: () => this.searching.set(false),
    });
  }

  protected attachPasted(event: Event): void {
    event.preventDefault();
    const url = this.pastedUrl.trim();
    if (url) this.attach(url, null);
  }

  protected attach(url: string, title: string | null): void {
    this.attaching.set(url);
    this.api.attachFromUrl(this.deviceId(), { url, kind: 'manual', title }).subscribe({
      next: (att) => {
        this.attaching.set(null);
        this.toast.success(`Attached ${att.title ?? att.originalName}`);
        this.attached.emit();
        this.close();
      },
      error: () => this.attaching.set(null),
    });
  }
}

