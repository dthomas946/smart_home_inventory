import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { SortDir } from '../../core/navigation/return.store';

/** Clickable column header: first click sorts ascending, second descending. */
@Component({
  selector: 'app-sort-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="sort"
      [class.active]="active()"
      (click)="sortChange.emit(key())"
      [attr.aria-sort]="active() ? (dir() === 'asc' ? 'ascending' : 'descending') : 'none'"
      [title]="'Sort by ' + label()"
    >
      {{ label() }}
      <span class="arrow" aria-hidden="true">{{ active() ? (dir() === 'asc' ? '▲' : '▼') : '↕' }}</span>
    </button>
  `,
  styles: `
    .sort {
      background: none;
      border: 0;
      padding: 0;
      font: inherit;
      font-weight: inherit;
      color: inherit;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .arrow {
      font-size: 0.7em;
      opacity: 0.35;
    }
    .sort.active .arrow {
      opacity: 1;
    }
    .sort:hover .arrow {
      opacity: 0.8;
    }
  `,
})
export class SortHeaderComponent {
  readonly key = input.required<string>();
  readonly label = input.required<string>();
  readonly sort = input<string | null>(null);
  readonly dir = input<SortDir>('asc');
  readonly sortChange = output<string>();
  protected readonly active = computed(() => this.sort() === this.key());
}
