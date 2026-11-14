# Manual lookup & resource links

## Intention

Non-smart gear — the fridge, the HVAC condenser, the water heater — is exactly
the stuff you need documentation and spare parts for, and exactly the stuff
with no integration to pull it from. Given a manufacturer and model, get to
the manual and the parts search in one tap, and keep the manual *in* the
inventory rather than in a browser bookmark.

## Design

Two tiers, deliberately separate:

1. **Resource links** (`libs/shared/src/lib/resource-links.ts`) — pure URL
   templating, no network, no persistence. Groups: docs (web search for
   PDF, ManualsLib), parts (RepairClinic, PartSelect, AppliancePartsPros,
   Encompass; only for categories where that makes sense), support
   (manufacturer, CPSC recalls). Lives in `shared` so it is unit-tested
   without Angular and could be reused server-side. Adding a source is one
   line here.
2. **Find manual** — `GET /api/devices/:id/manual-candidates` runs a web
   search (DuckDuckGo's HTML endpoint: no key, no account) and returns
   ranked candidates; `POST /api/devices/:id/attachments/from-url` has the
   server fetch a URL and file it through the normal attachments service
   with `sourceUrl` set.

Decisions worth knowing:

- The search is screen-scraping. The parser (`search-provider.ts`) is regex
  over result anchors, never a DOM, and every failure degrades to "no
  candidates" — never a 500. The dialog therefore always offers
  paste-a-URL, which hits the same download endpoint.
- Ranking is a small additive heuristic (PDF extension, manual-ish words,
  model tokens in title/URL, penalties for shopping/review/video hits,
  slight penalty for aggregators vs. OEM hosts). `score` is returned so it
  can be tuned against real queries.
- Download validation checks the bytes, not the extension: `%PDF-` magic
  wins over `Content-Type` because many OEM servers send PDFs as
  `application/octet-stream`. For `kind=manual` a non-PDF is rejected and the
  partial file removed. Size is capped at `UPLOAD_MAX_BYTES` by a streaming
  transform, so a 2 GB "manual" never lands on disk.
- The fetcher refuses loopback, RFC1918, link-local, `.local`, `supervisor`
  and bare hostnames. The user is an admin on their own LAN, but a pasted
  URL should not be able to pull the Supervisor API into the uploads folder.
- Nothing is stored until the user picks a candidate. Search results are
  never cached or persisted.

## Code

- Shared: [resource-links.ts](../../libs/shared/src/lib/resource-links.ts),
  [manual-lookup.dto.ts](../../libs/shared/src/lib/dto/manual-lookup.dto.ts)
- Backend: [manual-lookup/](../../apps/backend/src/app/manual-lookup/)
- Frontend: [manual-lookup-dialog.component.ts](../../apps/frontend/src/app/features/devices/manual-lookup-dialog.component.ts),
  Resources card in [device-detail-page.component.ts](../../apps/frontend/src/app/features/devices/device-detail-page.component.ts)
- Schema: `Attachment.sourceUrl` (migration `20261114040000_attachment_source_url`)
