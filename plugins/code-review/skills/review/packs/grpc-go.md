---
pack: grpc-go
loads_into: [go]
verified: "2026-07"
sources:
  - https://grpc.io/docs/languages/go/
  - https://grpc.github.io/grpc/core/md_doc_statuscodes.html
  - https://go.dev/blog/context
verify: "Confirm the project's actual google.golang.org/grpc version in go.mod before citing an API that may have changed across major versions."
---

# gRPC (Go)

gRPC-Go services communicate over HTTP/2 with Protocol Buffers as the wire format; unary and
streaming RPCs share the same context-propagation and status-code conventions.

## Facts to check against

- **Context propagation.** A handler that replaces its incoming `ctx` with
  `context.Background()`/`context.TODO()` loses cancellation, deadlines, and metadata for every
  downstream call — the incoming request context should flow through the whole call chain.
- **Status-code selection.** `codes.InvalidArgument` for bad user input, `codes.NotFound` for a
  missing resource, `codes.Unauthenticated`/`codes.PermissionDenied` for auth failures,
  `codes.AlreadyExists` for a duplicate, `codes.Internal` reserved for genuine server-side
  failures. A generic `errors.New(...)` returned from a handler becomes `codes.Unknown` to the
  client, losing the ability to branch on the failure kind.
- **Client deadlines.** A client call made with a bare `context.Background()` (no
  `context.WithTimeout`/`WithDeadline`) can hang indefinitely if the server is unresponsive —
  every client call should carry a deadline appropriate to the operation.
- **Streaming drains and `io.EOF`.** A client that returns before calling `stream.Recv()` until
  `io.EOF` leaves the stream undrained. `io.EOF` from `Recv()` is the normal end-of-stream signal,
  not an error — treating it as an error path is a common bug.
- **Interceptor ordering.** Auth should run before logging (so unauthorized requests aren't
  logged as if legitimate); metrics/logging should wrap the actual handler; error-translation
  interceptors run last so they see the final status code.
- **Large messages.** Payloads approaching or exceeding the default 4MB message-size limit
  should use a streaming RPC instead of unary; check for `MaxRecvMsgSize`/`MaxSendMsgSize`
  overrides if a project intentionally sends larger unary payloads.
- **Connection reuse.** A gRPC client connection (`grpc.Dial`/`grpc.NewClient`) is meant to be
  created once and reused, not dialed per request; ensure it's closed on shutdown and configured
  with sensible keepalive parameters.
