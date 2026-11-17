import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  viewChild,
  ElementRef,
} from '@angular/core';
import { ConfirmService } from './confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg (cancel)="confirm.answer(false)">
      @if (confirm.current(); as req) {
        <h3>{{ req.title }}</h3>
        <p>{{ req.message }}</p>
        @if (req.skipKey) {
          <label class="skip">
            <input type="checkbox" #skip /> Don't ask me again
          </label>
        }
        <div class="actions">
          <button class="btn secondary" (click)="confirm.answer(false)">{{ req.cancelLabel }}</button>
          <button
            class="btn"
            [class.danger]="req.danger"
            (click)="confirm.answer(true, !!skipBox()?.nativeElement?.checked)"
          >
            {{ req.confirmLabel }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .skip {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.9em;
      color: var(--secondary-text-color);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
  `,
})
export class ConfirmDialogComponent {
  protected readonly confirm = inject(ConfirmService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly skipBox = viewChild<ElementRef<HTMLInputElement>>('skip');

  constructor() {
    effect(() => {
      const open = this.confirm.current() !== null;
      const el = this.dlg().nativeElement;
      if (open && !el.open) el.showModal();
      if (!open && el.open) el.close();
    });
  }
}
