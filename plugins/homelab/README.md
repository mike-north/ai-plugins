# homelab

Operational tooling for a self-hosted homelab: MCP servers for the network, home automation, and
the NAS, plus reusable skills distilled from real troubleshooting.

## MCP servers

All three are stdio servers whose endpoints and credentials come from **environment variables** —
nothing host-specific or secret is committed. Supply the variables however you inject env (e.g. a
1Password environment).

| Server | Backed by | Required env |
|---|---|---|
| `unifi-network` | `unifi-network-mcp` (via `uvx`) | `UNIFI_NETWORK_HOST`, `UNIFI_NETWORK_USERNAME`, `UNIFI_NETWORK_PASSWORD` |
| `home-assistant` | `mcp-proxy` → Home Assistant MCP | `HOMEASSISTANT_URL`, `HOMEASSISTANT_API_TOKEN` |
| `unraid` | `mikenorth/unraid-mcp` (via `docker`) | `UNRAID_API_URL`, `UNRAID_API_KEY` |

Optional: `MCP_READ_ONLY` (default `true` — the `unraid` server refuses writes unless set `false`),
`UNRAID_TLS_SKIP_VERIFY` (default `false`).

`uvx`, `mcp-proxy`, and `docker` must be available on PATH.

## Skills

- **unraid-control** — MCP-vs-CLI surface detection, a read-only/safe-write/destructive safety model,
  the approval + confirm-token flow, an intent→tool/command map across system, array/parity, disks,
  shares, UPS, Docker, VMs, and notifications, plus a web-UI-hang / D-state I/O-saturation diagnosis
  and recovery playbook.
- **homelab-macos-vms** — running macOS guests on KVM without GPU passthrough: virtio-net root-bus
  placement, `vmvga`-not-`qxl`, even-core topologies, auto-login/recovery, WindowServer-starvation
  causes, and the screen-sharing / RFB gotchas.
- **homelab-networking** — Tailscale split-DNS and subnet-router patterns, macOS resolver-cache
  flushing, step-ca mutual-TLS auto-renewal, custom-cert wiring, and Apple root-trust caveats.

## Installation

Enable `homelab@ai-plugins` in your Claude Code settings' `enabledPlugins`, then provide the
environment variables above in the sessions where you want the homelab servers active.

## License

ISC
