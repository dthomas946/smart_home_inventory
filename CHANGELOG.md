# Changelog

## 0.8.1

- **Network map: one branch per connection type.** A device that feeds others over more than one type (a router with Ethernet, Wi-Fi and USB clients; a panel with 120V and 240V circuits) gets a labelled branch for each type, with its devices underneath, instead of one shared channel. Drag a branch to move it with its devices; dragging the parent moves everything.

## 0.8.0

- **Utilities page**: Electrical, Gas, Water, Phone, Internet and Solar.
  - **Service providers** for each, with account number, customer-service and outage/emergency phone (tap to call), email, website, outage map and notes.
  - **Plans**: hand-drawn diagrams in the existing editor, owned by the utility.
  - **Map** opens the Network map filtered to that utility.
- **Electrical circuits**: breaker #, amps, poles and area served on electrical connections. Shown on the Connections list and as labels on the Network map.
- **Network map**:
  - "Show" picker: all connections or one utility. Positions are saved separately for each.
  - Dragging a device **moves everything downstream of it**; a device with nothing below it moves alone.
  - **Snap to grid** toggle with a subtle dot grid.
  - **Undo** the last 5 moves (button or Ctrl+Z), kept until you leave the page.
- Connection types get a **utility map** setting (Settings → Connection types). New built-in types: Phone line, Fiber, Solar DC.
- **Exclude** confirmation has "Don't ask me again" (per browser). Bring it back from Settings → Physical devices only.
- Credits: README, LICENSE, repository and add-on description and the Settings page credit Jan Kopcsek ([@jkopcsek](https://github.com/jkopcsek)) as the original author. The fork's install link now points to the fork.

## 0.7.0

- **Choose your AI for Scan label** (Settings → AI for Scan label):
  - Providers: Off, Ollama (local), any OpenAI-compatible API (OpenAI, OpenRouter, Gemini, LM Studio, LocalAI, vLLM), or **Home Assistant AI Task**, which uses whichever AI integration you've set up in HA.
  - **Test connection** checks the server and model first. API keys are write-only.
  - Model, context window, timeout and photo size are all adjustable.
  - Existing `ollama_url` / `ollama_model` options seed the card once.
- **Region settings**:
  - North American (NEC) or IEC wire colours, and US or generic parts/recall links.
  - Both default from Home Assistant's country.
  - North American installs get 120V / 240V / 24V AC connection types automatically.
- **Network map "Wrap at"** picker (2–6 side by side), remembered per browser.
- New add-on options `sync_interval_minutes` and `upload_max_mb` (previously env-only).
- Add-on maps `/media` (used only to hand photos to HA AI Task).
- Removed the maintainer's personal Ollama address from the default options.

## 0.6.0

- **Devices tab "Connected via" filter** replaces the capability chips (which
  looked like connection types but weren't tied to connections): chips for
  each connection type in use, with device counts, filtering devices that
  have that kind of connection — same as the Connections tab
- **Sortable columns** on Devices and Connections (click a header; again to
  reverse). Blanks always sort last
- **Controls (non-smart)** connection type (orange, dashed) plus a
  **Controlled device** button on each device page: link a smart plug,
  relay or control board to the lamp / pump / AccuClean it drives (create
  the non-smart device right from the picker). Non-smart devices are drawn
  as squares on the Network map, with a node legend
- **End-of-row actions**: Devices — Exclude (synced devices) or Delete (yours);
  Connections — Exclude the downstream device
- **Filters are kept**: Connections type filter, new search box and sort live
  in the URL. Open a device from a filtered Devices or Connections list and
  Save / Cancel / Delete / Exclude return you to that exact list; the device
  page shows "← Back to …"
- Auto-link only treats hand-drawn links *into* a device as an override, so
  "controls" links out of a smart plug don't stop its own network link

## 0.5.0

- **Home Assistant defaults**: currency (and country, units, time zone,
  language — `GET /api/ha/locale`) come from HA's general settings. New
  devices default to HA's currency; existing devices still on the old EUR
  default with no price entered are switched on the next sync. Prices show
  with the right symbol and formatting
- **Integration** column on the Devices list (zha, netgear, esphome…) with an
  integration filter; the device page shows "via …" too
- **Duplicate hints**: devices that share a MAC address (near-certain) or
  have the same name in a different integration (likely) are badged, with a
  **Possible duplicates** filter, a banner on the device page linking the
  other copy, and a one-tap **Exclude** for the copy you don't want

## 0.4.2

- Network map Hierarchy layout wraps at **3 wide** (was 5) at every level

## 0.4.1

- **Physical devices only.** HA sync now skips virtual "devices": add-ons,
  weather/system/calendar/helper integrations and cloud accounts (built-in),
  plus your own rules by **manufacturer** or **integration** (Settings →
  Physical devices only) or per device (**Exclude from inventory** on a
  synced device's page). Excluded devices are removed from the inventory
  unless they hold your data (attachments, notes, serial, hand-drawn
  connections); removing a rule syncs them back
- Network map **Hierarchy** layout wraps at **5 wide at every level** —
  mixed branches and top-level trees too, not just all-leaf hubs. Links to
  wrapped rows bend in the gap above each row

## 0.4.0

- **Network map: Hierarchy layout** (now the default) — a top-down tree with
  controllers above what they serve; hubs with many clients wrap them into
  rows. Toggle **Hierarchy / Radial**; the choice is remembered per browser
- **Drag devices** on the map to arrange it yourself. Positions are saved on
  the server per layout (same on phone and desktop); a reset button appears
  once anything has been moved
- **Edit connection types** in Settings: name, group, colour and line style
  are editable inline for every type, built-ins included
- **Create a device from the picker**: when adding or editing a connection,
  type a name that doesn't exist (e.g. "Panel A – Breaker 12", "Furnace 24V
  transformer") and choose **+ Create** — handy for power sources and other
  non-smart endpoints. Category is guessed from the name

## 0.3.7

- Add attachment: new default type **Auto (from file)** — the picker accepts
  photos and PDFs and files PDFs as `manual`, images as `image`. Previously
  the dialog defaulted to `image`, which greyed PDFs out of the picker
- File filters list `.pdf` alongside the MIME type (iOS / webviews ignore
  MIME-only filters)
- Server identifies uploads by content (PDF, JPEG, PNG, WebP magic bytes), so
  PDFs a device labels `application/octet-stream` are accepted as manuals

## 0.3.6

- Auto-link: custom power types ("120V", "240V", "24V AC"…) never count
  as a manual network placement — drawing a power line to a smart plug no
  longer stops auto-link from linking its radio

## 0.3.5

- Auto-link skips HA *service* entries and account pseudo-devices named
  after an email address ("Aarlo for you@…") — they aren't hardware

## 0.3.3

- Auto-link: a hand-drawn **Other**, wireless, or **custom** connection type
  onto a device now counts as "you placed this device" and auto-link backs
  off (previously only the built-in network types did). Power, HDMI, USB,
  coax and pipes still don't count

## 0.3.2

- **Edit connections**: pencil button on the Connections page and on each
  device's connection list. Change type, label, notes, either endpoint, or
  swap direction. Editing an auto link turns it into a manual one so
  auto-link re-runs leave it alone
- API: `PATCH /api/connections/:id` accepts `fromDeviceId` / `toDeviceId`

## 0.3.1

- Auto-link: router-integration clients (Netgear/UniFi/ASUS/Fritz) default
  to Wi-Fi instead of Ethernet; SmartHQ / SmartThings / LG ThinQ appliances
  map to Wi-Fi; more HA-internal and cloud-only platforms ignored. New
  **remove all** for auto links on the panel

## 0.3.0

- **Auto-link** (Connections page): derive "device → controller" links from
  Home Assistant's registry. Devices that pair through a hub (Zigbee
  coordinator / Zigbee2MQTT bridge, Z-Wave stick, Hue bridge, Matter) link
  to it via HA's `via_device`; devices HA talks to directly use a
  per-protocol **default controller** you pick (Wi-Fi → router). Preview
  before Apply, with every skipped device and the reason. Auto links show an
  **auto** badge; **Make manual** or **Delete** overrides one and re-runs
  leave it alone (resettable). Manual network links on a device always win
- **Network map** page: radial hub-and-spoke graph of all connections,
  coloured/dashed by type, type toggles, pan/zoom, tap to open a device
- HA client now reads `via_device_id`, config entries and identifiers

## 0.2.21

- New **Brand** field on devices, for when the consumer brand differs from
  the manufacturer on the plate (Frigidaire / Electrolux, Bryant / Carrier).
  Resources links, Find-manual queries, list and header display all prefer
  brand when set; search matches it too. Label scan now extracts brand and
  manufacturer separately

## 0.2.20

- Devices list: **Equipment / Smart home / All** toggle (remembered per
  browser, defaults to Equipment) so hand-entered gear isn't buried under
  HA-synced devices; new **Category** filter; new **Serial** and **Docs**
  columns — Docs shows the count of attached manuals, or a "scan label"
  nudge when a device has neither model nor serial yet
- API: `GET /api/devices?source=manual|ha`; list rows carry `manualCount`

## 0.2.19

- Resources: ManualsLib link 404'd (guessed product URL). Now links the
  brand page plus a site-scoped search for the model

## 0.2.18

- Scan label: request an 8k context from Ollama per call and downscale the
  photo to 1280 px before sending — fixes `request exceeds the available
  context size (4096 tokens)` on phone photos and speeds up the read. The
  full-size original is still what gets attached

## 0.2.17

- Scan label: separate **Take photo** and **Upload photo** buttons, so an
  existing photo from the gallery or a file works too (previously the
  camera was forced on phones)

## 0.2.16

- **Scan label**: on the new/edit device form, photograph the rating plate
  and a local Ollama vision model reads manufacturer, model, serial,
  product type, electrical ratings and extras (refrigerant, BTU, …) into the
  form. Empty fields are filled, your existing values are never overwritten,
  category is suggested from the product type, specs land in Notes, and the
  photo is attached as "Rating label" on save
- New add-on options `ollama_url` and `ollama_model` (leave blank to hide the
  feature). Env `OLLAMA_URL` / `OLLAMA_MODEL` override them in dev

## 0.2.15

- **Resources** card on the device page: one-tap links to manual searches,
  ManualsLib, appliance/HVAC parts houses (RepairClinic, PartSelect,
  AppliancePartsPros, Encompass), manufacturer support and CPSC recalls,
  built from the device's manufacturer + model
- **Find manual**: search the web for a device's documentation, pick a hit,
  and the add-on downloads the PDF and files it as a `manual` attachment —
  or paste a direct URL. Content is validated as a real PDF, capped at the
  upload size limit, and the source URL is recorded on the attachment
- Local build: `image:` removed from `config.yaml` so the Supervisor builds
  from source (upstream's prebuilt ghcr.io image is private)

## 0.2.14

- Add-on repository packaging: DOCS.md with screenshots, icon/logo,
  CHANGELOG, `repository.yaml`; broaden description beyond electrical;
  switch sidebar icon to `mdi:floor-plan`

## 0.2.13

- Device thumbnails, HA/local badges, create-device-from-diagram

## 0.2.12

- Bump to Jest 30, more icons and connection types, improved pickers

## 0.2.11

- Lots of diagram improvements

## 0.2.10

- Improve diagram, connection creation, etc.

## 0.2.9

- More diagram improvements

## 0.2.8

- Unify connection type across diagram and entities

## 0.2.7

- Improve diagram tooling

## 0.2.6

- Add floor handling, improve mobile layout

## 0.2.5

- Fix install and deploy

## 0.2.4

- Make build more robust

## 0.2.1 – 0.2.3

- Early install/deploy fixes
