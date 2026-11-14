# Auto-link & Network map

## Intention

A smart home's topology — which bulb is on which coordinator, which lock
hangs off the Z-Wave stick, what's on Wi-Fi — is something Home Assistant
already knows and nobody wants to re-enter by hand. Auto-link turns that
knowledge into Connections, keeps the user in charge of exceptions, and the
Network map makes the result visible.

## Design

**Source of truth.** HA's device registry carries `via_device_id` (the hub
a device is reached through) and each device's entities carry `platform`
(zha, zwave_js, mqtt, esphome…). `WsHaRegistryClient` now reads both plus
`config_entries/get` to map config-entry ids to integration domains.

**Planner** (`auto-link.planner.ts`, pure, unit-tested):

- Classify the protocol: strong platforms (zha/deconz/hue → Zigbee,
  zwave_js → Z-Wave, matter) win; MQTT-bridged devices take the protocol
  from their hub's name/identifiers (Zigbee2MQTT, zwave-js-ui); a table of
  local-network integrations maps to Wi-Fi/Ethernet; HA-internal and
  cloud-only platforms are ignored; anything else is reported as
  `unknown_protocol` with the platform name, never guessed.
- Resolve the controller: HA `via_device` if it maps to a local device,
  else the user's **default-controller rule** for that type, else skip
  (`no_controller`, with the type so the UI can say which rule would fix it).
- One managed link per HA device, keyed `ha:<haDeviceId>` and stored in
  `Connection.metadata = { auto: true, autoKey, reason, platforms }`.
  Changing hub or type is an *update* of that link.
- Diff against existing managed links → create / update / remove /
  unchanged. Managed links whose key is no longer desired are removed.

**Overrides** — three mechanisms, all respected by re-runs:

1. *Manual network link on the device* (any non-managed connection of a
   network type touching it): planner backs off, `manual_override`.
   Power/plumbing links never count.
2. *Suppression*: deleting a managed link (`ConnectionsService.remove`) or
   editing one (`update` — which also flips it to `auto: false`, keeping
   the autoKey for traceability) writes `AutoLinkSuppression(autoKey)`.
   The planner skips it (`suppressed`) and removes any stale managed copy.
   "Reset overrides" clears the table; manual links are untouched.
3. *Rules*: `AutoLinkRule(type → controllerDeviceId)`; cascade-deleted with
   the device.

**Network map** (`network-layout.ts`, pure): a forest of radial trees, one
per root (a controller nothing links up to), angular space allocated by
subtree leaf count, trees shelf-packed. Edges use the connection type's
colour/dash; auto links draw lighter. Unlinked devices are listed, not
drawn. Pan/zoom is viewBox arithmetic, no library.

## Code

- Backend: [auto-link/](../../apps/backend/src/app/auto-link/)
  (planner + spec, service, controller), override hooks in
  [connections.service.ts](../../apps/backend/src/app/connections/connections.service.ts),
  registry fields in [ha-registry.types.ts](../../apps/backend/src/app/ha/ha-registry.types.ts)
- Shared: [auto-link.dto.ts](../../libs/shared/src/lib/dto/auto-link.dto.ts)
- Frontend: [auto-link-panel.component.ts](../../apps/frontend/src/app/features/connections/auto-link-panel.component.ts),
  [network/](../../apps/frontend/src/app/features/network/)
- Schema: `AutoLinkRule`, `AutoLinkSuppression` (migration `20261114150000_auto_link`)
