---
pack: go-plugin
loads_into: [go]
verified: "2026-07"
sources:
  - https://github.com/hashicorp/go-plugin
  - https://github.com/hashicorp/go-hclog
verify: "Confirm the project's actual hashicorp/go-plugin version in go.mod — protocol version negotiation details can shift between major versions."
---

# HashiCorp go-plugin

go-plugin runs a plugin as a separate OS process, communicating with the host over gRPC tunneled
through stdin/stdout, gated by a handshake.

## Facts to check against

- **Handshake config must be shared, not duplicated.** `plugin.HandshakeConfig` (protocol
  version, magic-cookie key/value) must be byte-identical between host and plugin — define it once
  in a shared package both sides import, not copy-pasted into each binary.
- **Plugin-side logging must go to stderr, never stdout.** stdout carries the gRPC handshake and
  connection data; any `fmt.Println`/`fmt.Printf`/default `log.Println` output to stdout corrupts
  that channel. Use `hclog` configured with `Output: os.Stderr`.
- **Graceful shutdown.** The plugin process should handle `SIGTERM`/`SIGINT`, run cleanup
  (flushing, closing connections), and only then exit; a plugin with no signal handling can be
  killed mid-operation with corrupted state. The host should call `client.Kill()` on shutdown
  rather than relying on the plugin process being killed externally.
- **Plugin-map name consistency.** The string key used to register a plugin (in
  `plugin.PluginSet`) must match exactly between host and plugin — a mismatch fails to dispense
  the plugin at runtime rather than at compile time.
- **Version negotiation.** `VersionedPlugins` lets a host support multiple plugin protocol
  versions simultaneously; if the project ships this, verify both old and new plugin versions are
  actually exercised (in tests or manually), since a broken old-version path won't surface until an
  old plugin binary is loaded.
- **gRPC error handling still applies.** Since go-plugin communicates over gRPC internally, the
  `grpc-go` status-code and context-propagation guidance applies to the plugin's server/client
  implementation as well.
