import { defineConfig } from '@ai-plugin-marketplace/core';

export default defineConfig({
  version: "0.0.1",
  targets: ["claude", "cursor", "codex"],
  description: "Homelab ops for Unraid, UniFi Network, and Home Assistant: MCP servers for all three plus skills for Unraid control (including web-UI-hang diagnosis), macOS-on-KVM VM gotchas, and homelab networking (Tailscale split DNS/subnet routing, step-ca cert renewal).",
  keywords: ["homelab", "unraid", "unifi", "home-assistant", "mcp", "self-hosted", "vm", "tailscale"],
});
