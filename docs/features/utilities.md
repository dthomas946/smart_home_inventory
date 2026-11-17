# Utilities

## Intention

The diagram editor and connections already model wires and pipes. What was
missing was a way to look at one utility at a time ("what does breaker 12
feed?", "where's the gas shut-off?"), and to keep the provider's number
handy for the day it's needed.

## Design

- `UtilityProvider` table: utility, name, account number, phone, emergency
  phone, email, website, outage URL, notes. Several per utility (e.g.
  fiber ISP + cellular backup).
- `ConnectionType.utility` puts a type on one utility's map.
  - The migration backfills the built-in types once (see `DEFAULT_TYPE_UTILITY`).
  - New built-ins: `phone_line`, `fiber` and `solar_dc`.
  - North American power types get `electrical` when they're seeded.
- `Diagram.utility` lets a utility own plans, alongside device- and area-owned
  ones. `/diagrams?utility=…` opens them, and Back returns to the Utilities page.
- Electrical circuit details live in `Connection.metadata.circuit`
  (`CircuitSchema`: breaker, amps, poles, servesAreaIds, serves).
  - The connection dialog shows them for any type whose utility is Electrical.
  - The circuit is merged into existing metadata, so auto-link markers survive.
- `GET /api/utilities` returns every utility's providers, map types, connection
  count and plans. Provider CRUD is under `/api/utilities/providers`.

## Network map

- `?map=<utility>` filters to that utility's types. Saved positions use the
  key `<mode>:<utility>`, so each map keeps its own arrangement.
- Drag moves the device plus `downstreamOf()` it (BFS over drawn edges,
  cycle-safe). Snap rounds each moved node to a 20-unit grid.
- Undo keeps the positions from before each of the last 5 moves (and the last
  Reset) in memory. It is cleared on mode/map switch and when leaving the page.
