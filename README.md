# Smart Home Inventory

[![Version](https://img.shields.io/badge/dynamic/yaml?url=https%3A%2F%2Fraw.githubusercontent.com%2Fdthomas946%2Fsmart_home_inventory%2Fmain%2Fconfig.yaml&query=%24.version&label=version&prefix=v&color=blue)](CHANGELOG.md)
[![Architectures](https://img.shields.io/badge/arch-aarch64%20%7C%20amd64-blue)](config.yaml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **Credit:** Smart Home Inventory was created by **Jan Kopcsek
> ([@jkopcsek](https://github.com/jkopcsek))** —
> [jkopcsek/smart_home_inventory](https://github.com/jkopcsek/smart_home_inventory).
> The data model, Home Assistant sync, areas/devices/attachments, the
> diagram editor and the add-on itself are his work. This repository is a
> community fork that builds the add-on from source (so it installs without
> the prebuilt image) and adds the features listed under
> [What this fork adds](#what-this-fork-adds). Please send ideas for the
> core app to the original project.

A Home Assistant add-on that documents your home's smart-home setup and
infrastructure: areas, devices, capabilities, actual connections, annotated
plans/photos, and attached manuals or invoices — all stored locally, next
to each other, so you stop losing this information to memory, random
photos, or a spreadsheet that falls out of date.

## Features

- **Areas & devices** — synced straight from Home Assistant's own registry
  (one click, uses the Supervisor token automatically), then enriched with
  the details HA doesn't track: purchase date, install notes, capabilities,
  physical location. Devices HA doesn't know about — junction boxes,
  passive switches, fuses — get added directly as local devices, and each
  area page shows at a glance what's synced from HA and what's local-only.
- **Connections & plans** — draw the actual wiring between devices as a
  diagram, not just electrical: model water, gas, and network runs the same
  way, alongside 230V mains, 24V DC, or a Zigbee binding. It's the thing you
  wish you had the one time a breaker trips, a pipe needs shutting off, or
  you're tracing which switch feeds which outlet.
- **Attachments** — manuals, invoices, warranty cards, floor plans, photos —
  attach them to the device or area they belong to, annotate plans/photos
  directly, and pull mermaid diagrams out of what you've documented.
- **Look it up** — every device with a manufacturer/model gets a Resources
  card: manual searches, parts houses, manufacturer support, recalls. "Find
  manual" searches the web and attaches the PDF for you (or paste a link).
  "Scan label" photographs the rating plate and a local Ollama vision model
  fills in manufacturer, model, serial and specs — fully local, no cloud.
- **Auto-link & Network map** — smart devices are linked to their
  coordinator/bridge/router straight from HA's registry (override any link,
  re-run any time), and the whole thing is drawn as a network map.

All of it is stored under the add-on's data directory, so it rides along
with your normal HA backups — no separate export/import step.

## What this fork adds

On top of the original (see [CHANGELOG.md](CHANGELOG.md) for detail):

- Builds from source on your Home Assistant box — no registry image needed
- Resources card, **Find manual**, and **Scan label** (rating-plate photo → any
  vision AI: Ollama, OpenAI-compatible, or Home Assistant AI Task)
- Brand vs. manufacturer, Equipment / Smart home filters, sortable columns
- **Auto-link** smart devices to their coordinators from HA's registry, and a
  **Network map** (hierarchy or radial, drag a device with everything below
  it, snap-to-grid, undo)
- **Utilities**: Electrical, Gas, Water, Phone, Internet and Solar — each
  with its own map, hand-drawn plans and service-provider contacts; breaker,
  amps and area served on electrical circuits
- Physical-devices-only exclusions, duplicate hints, HA defaults (currency,
  country → wire colours and power types), region settings

## Screenshots

Areas synced from Home Assistant, with local-only devices mixed in:

![Area with synced and local devices](https://raw.githubusercontent.com/jkopcsek/smart_home_inventory/main/docs/images/area-devices.png)

A plan showing the actual wiring between fuse, switches, and devices,
color-coded by connection type — the same view works for water, gas, or
network runs, not just electrical:

![Wiring plan diagram](https://raw.githubusercontent.com/jkopcsek/smart_home_inventory/main/docs/images/electrical-plan.png)

## Installation

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fdthomas946%2Fsmart_home_inventory)

Or manually:

1. Settings → Add-ons → Add-on Store → ⋮ (top right) → Repositories, and add
   `https://github.com/dthomas946/smart_home_inventory` (this fork; the
   original is `https://github.com/jkopcsek/smart_home_inventory`).
2. Find "Smart Home Inventory" in the store and install it.
3. Start the add-on, then open it from the sidebar panel (or "Open Web UI").

Once added, new versions show up through the Add-on Store's normal
"Check for updates" / Update flow — nothing else to do.

## How to use

On first start the add-on has no data. Go to Settings inside the app and use
"Sync from Home Assistant" to import your areas and devices from HA's
registry — this uses the Supervisor token automatically, no setup needed.
From there, add capabilities, wire up actual connections, and attach photos,
floor plans, manuals, or invoices.

## Configuration

```yaml
read_only: true
sync_interval_minutes: 0
upload_max_mb: 50
```

| Option                  | Default | Description |
| ----------------------- | ------- | ----------- |
| `read_only`             | `true`  | Blocks any non-read Home Assistant command from the sync client. Turn off only if you intend to let the add-on write back to HA (not currently used by any feature). |
| `sync_interval_minutes` | `0`     | Re-sync areas and devices from Home Assistant every N minutes. `0` = only when you press **Sync** in Settings. |
| `upload_max_mb`         | `50`    | Largest attachment (photo, PDF manual…) you can upload. |
| `ollama_url` / `ollama_model` | — | *Legacy.* Seed the AI settings below the first time; after that, use the app's Settings. |

### In-app settings (Settings page)

Everything that differs between homes and that you may want to change later
lives in the app, not the add-on options:

- **AI for Scan label** — which AI reads rating-plate photos:
  - *Off* (the Scan label button is hidden),
  - *Ollama (local)* — server URL, vision model, context window, timeout,
  - *OpenAI-compatible API* — OpenAI, OpenRouter, Google Gemini, LM Studio,
    LocalAI, vLLM…; base URL, model, API key (stored in the add-on, never
    shown again),
  - *Home Assistant AI Task* — use any AI integration you've already set up
    in Home Assistant (OpenAI, Gemini, Anthropic, Ollama…) by picking its
    `ai_task.*` entity. No keys in this add-on.

  **Test connection** checks the server and model before you save. Photos
  are shrunk to a configurable size before sending.
- **Region** — wire colours on diagrams (North American NEC or IEC/European)
  and which parts/recall links devices show (US retailers + CPSC, or generic
  web searches). Both default from Home Assistant's country.
- **Sync exclusions**, **capability types** and **connection types** — as before.

Defaults taken from Home Assistant's general settings: currency, country
(region above), and in North America the 120V / 240V / 24V AC power
connection types are added on first sync.

## Known issues and limitations

- Sync only pulls from Home Assistant; it does not push changes back.
- The Ingress URL is dynamic per session — don't bookmark it directly, use
  the sidebar panel.

## Support

Problems with something this fork added? Open an issue on
[this fork](https://github.com/dthomas946/smart_home_inventory/issues).
For the core app, use the
[original project](https://github.com/jkopcsek/smart_home_inventory/issues). Release
notes live in [CHANGELOG.md](CHANGELOG.md).

## Development

Looking to build from source, run it locally, or contribute? See
[CONTRIBUTING.md](CONTRIBUTING.md).
