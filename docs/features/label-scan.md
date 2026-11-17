# Label scan (vision AI)

> Since 0.7.0 the AI is chosen in Settings (Ollama, any OpenAI-compatible
> API, or Home Assistant AI Task) — see [ai-settings.md](ai-settings.md).
> The Ollama notes below still describe the default local setup.

## Intention

The rating plate already has everything the device form asks for —
manufacturer, model, serial, electrical ratings, refrigerant — in the worst
possible place to read it (behind the fridge, on the condenser in the sun).
Photograph it once, let a *local* vision model transcribe it, review, save.
No cloud: the image goes to the user's own Ollama server and nowhere else.

## Design

- `GET /api/label-scan/status` tells the frontend whether it is configured;
  the button simply doesn't render otherwise. Config comes from the add-on
  options `ollama_url` / `ollama_model` (env `OLLAMA_URL` / `OLLAMA_MODEL`
  override, for dev) via `AppConfig`.
- `POST /api/label-scan` (multipart `image`, in-memory, ≤ 12 MB) calls
  Ollama `/api/chat` with the image, `temperature: 0`, and a JSON schema in
  `format` so the model returns structured output rather than prose. The
  prompt is nameplate-specific — it tells the model what "Model No.", "S/N",
  RLA/FLA etc. mean and to use `null` rather than guess.
- `normalizeFields` is defensive about the model's output (strings trimmed,
  "null"/"N/A" dropped, `extra` accepted as array *or* object) so a chatty
  or sloppy model degrades to fewer fields, not a 500. `guessCategory` is a
  regex table from product-type wording to `DeviceCategory`.
- The frontend fills **empty** fields only. A field the user already typed is
  kept and listed as a conflict in the banner; the label's reading is still
  visible as a chip so they can copy it. Electrical + extras become a
  "From rating label:" block appended to Notes.
- The photo is not stored by the scan endpoint. The form keeps the `File`
  and attaches it as an `image` titled "Rating label" after the device is
  created/updated — so a scan on a device that is then cancelled leaves
  nothing behind.
- Timeout is 300 s: a 4B vision model on a 4 GB GPU can take 60–120 s per
  image. The banner says so.

## Code

- Shared: [label-scan.dto.ts](../../libs/shared/src/lib/dto/label-scan.dto.ts)
- Backend: [label-scan/](../../apps/backend/src/app/label-scan/),
  options plumbing in [app-config.ts](../../apps/backend/src/app/config/app-config.ts)
- Frontend: Scan-label flow in
  [device-form-page.component.ts](../../apps/frontend/src/app/features/devices/device-form-page.component.ts)
