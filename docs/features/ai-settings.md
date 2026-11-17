# AI settings (Scan label)

## Intention

Scan label was hard-wired to one Ollama server. Other installs have
different AI: a different local server, a cloud key, or an AI integration
already set up in Home Assistant. The choice now lives in the app's
Settings, stored in the add-on database, so it can be changed without
editing add-on options and survives updates.

## Providers

| Provider | Needs | How the photo travels |
| --- | --- | --- |
| Off | — | Scan label button hidden |
| Ollama (local) | URL, vision model | `/api/chat` with `images`, JSON schema in `format`, `num_ctx` |
| OpenAI-compatible | base URL, model, optional API key | `/chat/completions` with an `image_url` data URI, `response_format: json_object` (retried without it on 400) |
| Home Assistant AI Task | an `ai_task.*` entity | written to `/media/smart_home_inventory/`, passed to `ai_task.generate_data` as `media-source://media_source/local/...`, deleted afterwards |

The OpenAI-compatible provider covers OpenAI, OpenRouter, Google Gemini's
OpenAI endpoint, LM Studio, LocalAI and vLLM.

## Design

- `AppSetting` (key → JSON) table; `SettingsService` get/set.
- `AiSettingsService`
  - Fills missing fields from `AI_DEFAULTS` so older stored values keep working.
  - If nothing is stored yet, seeds Ollama from the legacy `ollama_url` / `ollama_model` options.
  - The API key is write-only. GET returns `apiKey: null` plus `hasApiKey`. On PUT, `null` keeps the stored key, `""` clears it, and a string replaces it.
- `POST /api/settings/ai/test` checks the settings as submitted (before
  saving), using the stored key when none is typed:
  - Ollama: lists `/api/tags` and checks the model is pulled.
  - OpenAI-compatible: lists `/models`.
  - AI Task: reads the entity's state and checks the media folder is writable.
- `GET /api/settings/ai/ha-entities` lists `ai_task.*` states for the picker.
- `scan.maxImageEdge` replaces the hard-coded 1280 px browser downscale.
- The add-on maps `media:rw` for the AI Task route.

## Region

- `RegionSettingsService` resolves `auto` against HA's country:
  - Wire colours: NEC in US/CA/MX/PR, otherwise IEC.
  - Parts/recall links: US retailers + CPSC in US/CA/PR, otherwise generic web searches.
- Wire colours are applied through `setWiringStandard()` in the shared lib. The frontend calls it at start-up and it only affects new wires.
- On sync with a North American country, `mains_120v`, `mains_240v` and
  `ac_24v` connection types are created if missing (never overwritten).

## Code

- Shared: [settings.dto.ts](../../libs/shared/src/lib/dto/settings.dto.ts)
- Backend: [settings/](../../apps/backend/src/app/settings/),
  [vision-providers.ts](../../apps/backend/src/app/label-scan/vision-providers.ts)
- Frontend: [ai-settings.component.ts](../../apps/frontend/src/app/features/settings/ai-settings.component.ts),
  [region-settings.component.ts](../../apps/frontend/src/app/features/settings/region-settings.component.ts),
  [region.store.ts](../../apps/frontend/src/app/core/region/region.store.ts)
