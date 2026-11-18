# Actual mesh routes

## Intention

Auto-link draws each smart device to the controller it belongs to (a
logical view). Meshes don't work that way: a Zigbee bulb may reach the
coordinator through two routers, and a Thread lock hangs off whichever
plug it chose as parent. The Actual view shows those real paths and the
quality of each link, which helps when you're deciding where a repeater
would help.

## Sources (all read-only)

| Mesh | Read from | Gives |
| --- | --- | --- |
| Zigbee | HA `zha/devices` | routing table (next hop to 0x0000), neighbour LQI, Child/Parent relationships |
| Z-Wave | HA `zwave_js/subscribe_node_statistics` (first event only) | last working route repeaters, RSSI |
| Thread | HA `matter/node_diagnostics` (radio address per device) + Matter server `get_nodes` (ThreadNetworkDiagnostics neighbour table, cluster 53) + OTBR `/node` (border router address) | end device → parent router, LQI 0–3, RSSI |
| Wi-Fi | Netgear integration `*_link_type` / `*_signal_strength` sensors | band and signal % |

- The add-on's Home Assistant client is still allow-list only. These three
  read commands were added, and a new `batch()` runs them over one
  connection.
- The Matter server and OTBR are reached on the internal add-on network
  (`core-matter-server:5580`, `core-openthread-border-router:8081`). Set
  `MATTER_SERVER_URL` / `OTBR_URL` to point elsewhere.
- Thread extended addresses are 64-bit, so the Matter server reply is parsed
  with large integers kept as strings (`parseLosslessJson`).

## Design

- Backend (`mesh-routes.ts`):
  - Pure parsers turn each source into child → parent hops (HA device ids, parent null = direct).
  - `MeshRoutesService` fetches, maps the hops to inventory devices, and caches the result for 5 minutes.
  - Served at `GET /api/auto-link/mesh?refresh=1`.
- Frontend (`withActualRoutes`):
  - Re-points Zigbee, Z-Wave and Thread links through the reported parent, and attaches quality and readout to them and to Wi-Fi links.
  - It's view-only: no connections are changed.
- Positions are saved under `<mode>[:<utility>]:actual`.
