import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AI_PROVIDER_LABELS,
  AI_PROVIDERS,
  AiProvider,
  AiSettingsDto,
  AiSettingsViewDto,
  AiTestResultDto,
  HaAiTaskEntityDto,
} from '@smart-home-inventory/shared';
import { SettingsApi } from '../../core/api/api.services';
import { ToastService } from '../../core/toast/toast.service';

/** Settings card: which AI reads rating-plate photos for "Scan label". */
@Component({
  selector: 'app-ai-settings',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card section">
      <h3>AI for Scan label</h3>
      <p class="muted">
        Reads a photo of a rating plate and fills in brand, model, serial and
        specs on a new device. Pick any vision-capable AI you have. Photos are
        sent only to the provider chosen here and are not stored by the app
        unless you attach them.
      </p>
      @if (form(); as f) {
        <div class="grid">
          <label>
            Provider
            <select class="text" [ngModel]="f.provider" (ngModelChange)="setProvider($event)">
              @for (p of providers; track p) {
                <option [value]="p">{{ labels[p] }}</option>
              }
            </select>
          </label>

          @switch (f.provider) {
            @case ('ollama') {
              <label>
                Server URL
                <input class="text" [(ngModel)]="f.ollama.url" placeholder="http://192.168.1.50:11434" />
              </label>
              <label>
                Vision model
                <input class="text" [(ngModel)]="f.ollama.model" list="ai-models" placeholder="qwen3-vl:4b-instruct" />
              </label>
              <label>
                Context window (tokens)
                <input class="text" type="number" min="2048" step="1024" [(ngModel)]="f.ollama.numCtx" />
              </label>
              <label>
                Timeout (seconds)
                <input class="text" type="number" min="10" max="900" [(ngModel)]="f.ollama.timeoutSec" />
              </label>
              <p class="hint">
                Any Ollama vision model works (qwen3-vl, llava, minicpm-v, gemma3…).
                A photo needs about 4,500 tokens, so keep the context window at 8192 or more.
              </p>
            }
            @case ('openai') {
              <label>
                Base URL
                <input class="text" [(ngModel)]="f.openai.baseUrl" placeholder="https://api.openai.com/v1" />
              </label>
              <label>
                Model
                <input class="text" [(ngModel)]="f.openai.model" list="ai-models" placeholder="gpt-4o-mini" />
              </label>
              <label>
                API key
                <input
                  class="text"
                  type="password"
                  autocomplete="off"
                  [(ngModel)]="newKey"
                  [placeholder]="hasKey() ? 'Saved — type to replace' : 'Not set (fine for local servers)'"
                />
              </label>
              <label>
                Timeout (seconds)
                <input class="text" type="number" min="10" max="900" [(ngModel)]="f.openai.timeoutSec" />
              </label>
              <p class="hint">
                Any server that speaks the OpenAI chat API with images: OpenAI,
                OpenRouter, Google Gemini (<code>…/v1beta/openai</code>), LM Studio,
                LocalAI, vLLM… The key is stored in the add-on and never shown again.
                @if (hasKey()) {
                  <button type="button" class="link" (click)="clearKey()">Remove saved key</button>
                }
              </p>
            }
            @case ('ha_ai_task') {
              <label>
                AI Task entity
                <select class="text" [(ngModel)]="f.haAiTask.entityId">
                  <option value="">— choose —</option>
                  @for (e of aiTaskEntities(); track e.entityId) {
                    <option [value]="e.entityId">{{ e.name }} ({{ e.entityId }})</option>
                  }
                </select>
              </label>
              <label>
                Timeout (seconds)
                <input class="text" type="number" min="10" max="900" [(ngModel)]="f.haAiTask.timeoutSec" />
              </label>
              <p class="hint">
                Uses whatever AI integration you've set up in Home Assistant
                (OpenAI, Google Gemini, Anthropic, Ollama…) — no keys here.
                @if (aiTaskEntities().length === 0) {
                  <b>No AI Task entities found.</b> Add an AI integration in Home
                  Assistant, then turn on its "AI Task" sub-entry.
                }
                The photo is passed through Home Assistant's media folder and
                deleted straight after.
              </p>
            }
          }

          @if (f.provider !== 'none') {
            <label>
              Shrink photos to (px, longest edge)
              <input class="text" type="number" min="512" max="4096" step="128" [(ngModel)]="f.scan.maxImageEdge" />
            </label>
          }
        </div>
        <datalist id="ai-models">
          @for (m of test()?.models ?? []; track m) {
            <option [value]="m"></option>
          }
        </datalist>

        <div class="actions">
          <button class="btn" type="button" [disabled]="busy()" (click)="save()">Save</button>
          @if (f.provider !== 'none') {
            <button class="btn secondary" type="button" [disabled]="busy()" (click)="runTest()">
              {{ busy() === 'test' ? 'Testing…' : 'Test connection' }}
            </button>
          }
        </div>
        @if (test(); as t) {
          <p [class.ok]="t.ok" [class.warn]="!t.ok">{{ t.ok ? '✓' : '✗' }} {{ t.message }}</p>
        }
      }
    </div>
  `,
  styles: `
    .section { margin-bottom: 16px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
      align-items: end;
    }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9em; }
    .hint { grid-column: 1 / -1; margin: 0; color: var(--secondary-text-color); font-size: 0.85em; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    .ok { color: var(--success-color, #2e7d32); }
    .warn { color: var(--warning-color); }
    .link {
      background: none; border: none; padding: 0; margin-left: 4px;
      color: var(--primary-color); cursor: pointer; text-decoration: underline; font: inherit;
    }
    code { background: var(--chip-background-color); border-radius: 4px; padding: 1px 4px; }
  `,
})
export class AiSettingsComponent implements OnInit {
  private readonly api = inject(SettingsApi);
  private readonly toast = inject(ToastService);

  protected readonly providers = AI_PROVIDERS;
  protected readonly labels = AI_PROVIDER_LABELS;
  protected readonly form = signal<AiSettingsDto | null>(null);
  protected readonly hasKey = signal(false);
  protected readonly aiTaskEntities = signal<HaAiTaskEntityDto[]>([]);
  protected readonly test = signal<AiTestResultDto | null>(null);
  protected readonly busy = signal<'' | 'save' | 'test'>('');
  /** Typed key; empty = keep the saved one. */
  protected newKey = '';
  private clearKeyOnSave = false;

  ngOnInit(): void {
    this.api.ai().subscribe((v) => this.load(v));
    this.api.aiTaskEntities().subscribe({ next: (e) => this.aiTaskEntities.set(e), error: () => undefined });
  }

  protected setProvider(p: AiProvider): void {
    const f = this.form();
    if (!f) return;
    this.form.set({ ...f, provider: p });
    this.test.set(null);
  }

  protected clearKey(): void {
    this.clearKeyOnSave = true;
    this.hasKey.set(false);
    this.newKey = '';
  }

  protected save(): void {
    const dto = this.payload();
    if (!dto) return;
    this.busy.set('save');
    this.api.saveAi(dto).subscribe({
      next: (v) => {
        this.load(v);
        this.busy.set('');
        this.toast.success('AI settings saved');
      },
      error: () => this.busy.set(''),
    });
  }

  protected runTest(): void {
    const dto = this.payload();
    if (!dto) return;
    this.busy.set('test');
    this.test.set(null);
    this.api.testAi(dto).subscribe({
      next: (r) => {
        this.test.set(r);
        this.busy.set('');
      },
      error: () => this.busy.set(''),
    });
  }

  private payload(): AiSettingsDto | null {
    const f = this.form();
    if (!f) return null;
    const typed = this.newKey.trim();
    const apiKey = typed ? typed : this.clearKeyOnSave ? '' : null;
    return {
      ...f,
      ollama: { ...f.ollama, numCtx: Number(f.ollama.numCtx), timeoutSec: Number(f.ollama.timeoutSec) },
      openai: { ...f.openai, apiKey, timeoutSec: Number(f.openai.timeoutSec) },
      haAiTask: { ...f.haAiTask, timeoutSec: Number(f.haAiTask.timeoutSec) },
      scan: { maxImageEdge: Number(f.scan.maxImageEdge) },
    };
  }

  private load(v: AiSettingsViewDto): void {
    const { hasApiKey, ...openai } = v.openai;
    this.hasKey.set(hasApiKey);
    this.newKey = '';
    this.clearKeyOnSave = false;
    // Copies, so ngModel edits don't touch the server value until Save.
    this.form.set({
      provider: v.provider,
      ollama: { ...v.ollama },
      openai: { ...openai, apiKey: null },
      haAiTask: { ...v.haAiTask },
      scan: { ...v.scan },
    });
  }
}
