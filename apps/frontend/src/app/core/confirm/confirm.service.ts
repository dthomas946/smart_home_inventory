import { Injectable, signal } from '@angular/core';

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  /** When set, the dialog offers "Don't ask me again" for this kind of action. */
  skipKey: string | null;
  resolve: (confirmed: boolean) => void;
}

const SKIP_PREFIX = 'shi.confirm.skip.';

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);

  ask(
    message: string,
    opts: {
      title?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      /** Offer "Don't ask me again"; once ticked, later asks with the same
       *  key return true straight away (per browser). Only for reversible
       *  actions. */
      skipKey?: string;
    } = {}
  ): Promise<boolean> {
    if (opts.skipKey && this.isSkipped(opts.skipKey)) return Promise.resolve(true);
    return new Promise((resolve) => {
      this.current.set({
        title: opts.title ?? 'Are you sure?',
        message,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        danger: opts.danger ?? true,
        skipKey: opts.skipKey ?? null,
        resolve,
      });
    });
  }

  answer(confirmed: boolean, dontAskAgain = false): void {
    const req = this.current();
    if (req && confirmed && dontAskAgain && req.skipKey) {
      try {
        localStorage.setItem(SKIP_PREFIX + req.skipKey, '1');
      } catch {
        /* per-browser convenience only */
      }
    }
    req?.resolve(confirmed);
    this.current.set(null);
  }

  isSkipped(key: string): boolean {
    try {
      return localStorage.getItem(SKIP_PREFIX + key) === '1';
    } catch {
      return false;
    }
  }

  /** Number of prompts currently silenced in this browser. */
  skippedCount(): number {
    try {
      return Object.keys(localStorage).filter((k) => k.startsWith(SKIP_PREFIX)).length;
    } catch {
      return 0;
    }
  }

  /** Bring back every "Don't ask me again" prompt. */
  resetSkipped(): void {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(SKIP_PREFIX)) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
