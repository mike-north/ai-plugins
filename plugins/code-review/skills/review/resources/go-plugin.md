# HashiCorp go-plugin Review Guidance

## Overview

HashiCorp's go-plugin is a Go library for building plugin systems using gRPC over stdio. It's used by Terraform, Vault, Packer, and other HashiCorp tools to enable extensibility through separate processes.

**Core architecture:**
- Plugin runs as a separate process
- Host and plugin communicate via gRPC over stdin/stdout
- Handshake protocol prevents version mismatches
- Automatic process lifecycle management

## Common Mistakes

### 1. Handshake Config Mismatch Between Host and Plugin

**Problem:** The magic cookie or protocol version doesn't match, causing connection failures.

**Anti-pattern:**
```go
// Host
var handshake = plugin.HandshakeConfig{
  ProtocolVersion:  1,
  MagicCookieKey:   "PLUGIN_MAGIC",
  MagicCookieValue: "hello",
}

// Plugin (different value!)
var handshake = plugin.HandshakeConfig{
  ProtocolVersion:  1,
  MagicCookieKey:   "PLUGIN_MAGIC",
  MagicCookieValue: "world",  // ❌ Mismatch!
}
```

**Correct pattern:**
```go
// shared/handshake.go - shared between host and plugin
package shared

import "github.com/hashicorp/go-plugin"

var Handshake = plugin.HandshakeConfig{
  ProtocolVersion:  1,
  MagicCookieKey:   "MY_PLUGIN",
  MagicCookieValue: "abc123",
}
```

**What to check:**
- [ ] Handshake config is shared between host and plugin
- [ ] Protocol versions match
- [ ] Magic cookie values are identical (case-sensitive)

### 2. Not Implementing Proper Shutdown/Cleanup

**Problem:** Plugin doesn't handle SIGTERM/SIGINT, leading to leaked resources or corrupt state.

**Anti-pattern:**
```go
// ❌ Bad: no cleanup on shutdown
func main() {
  plugin.Serve(&plugin.ServeConfig{
    HandshakeConfig: handshake,
    Plugins:         pluginMap,
  })
  // Process exits immediately on SIGTERM
}
```

**Correct pattern:**
```go
// ✅ Good: graceful shutdown
func main() {
  ctx, cancel := context.WithCancel(context.Background())
  defer cancel()

  // Set up signal handling
  sigCh := make(chan os.Signal, 1)
  signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

  go func() {
    <-sigCh
    log.Println("Received shutdown signal, cleaning up...")
    cleanup()
    cancel()
  }()

  plugin.Serve(&plugin.ServeConfig{
    HandshakeConfig: handshake,
    Plugins:         pluginMap,
  })
}

func cleanup() {
  // Close database connections
  // Flush buffers
  // Release locks
}
```

### 3. Incorrect Plugin Protocol Version Negotiation

**Problem:** Plugin doesn't properly handle version negotiation, breaking backwards compatibility.

**Anti-pattern:**
```go
// ❌ Bad: only supports one version
var handshake = plugin.HandshakeConfig{
  ProtocolVersion: 2,  // Breaks old hosts using version 1
}
```

**Correct pattern:**
```go
// ✅ Good: support multiple versions
type MyPlugin struct {
  plugin.Plugin
  Impl MyInterface
}

func (p *MyPlugin) GRPCServer(broker *plugin.GRPCBroker, s *grpc.Server) error {
  proto.RegisterMyServiceServer(s, &grpcServer{Impl: p.Impl})
  return nil
}

func (p *MyPlugin) GRPCClient(ctx context.Context, broker *plugin.GRPCBroker, c *grpc.ClientConn) (interface{}, error) {
  return &grpcClient{client: proto.NewMyServiceClient(c)}, nil
}

// Host supports multiple versions
client := plugin.NewClient(&plugin.ClientConfig{
  HandshakeConfig:  handshake,
  Plugins:          pluginMap,
  Cmd:              exec.Command("./my-plugin"),
  VersionedPlugins: map[int]plugin.PluginSet{
    1: plugin.PluginSet{"myPlugin": &MyPluginV1{}},
    2: plugin.PluginSet{"myPlugin": &MyPluginV2{}},
  },
  ProtocolVersion: plugin.CoreProtocolVersion,
})
```

### 4. Missing Health Check Implementation

**Problem:** Plugin doesn't implement health checks, causing the host to hang on unresponsive plugins.

**Correct pattern:**
```go
// ✅ Good: implement health check
type MyPlugin struct {
  plugin.Plugin
  Impl MyInterface
}

func (p *MyPlugin) GRPCServer(broker *plugin.GRPCBroker, s *grpc.Server) error {
  proto.RegisterMyServiceServer(s, &grpcServer{Impl: p.Impl})
  
  // Register health check
  grpc_health_v1.RegisterHealthServer(s, &healthServer{})
  
  return nil
}

type healthServer struct{}

func (s *healthServer) Check(ctx context.Context, req *grpc_health_v1.HealthCheckRequest) (*grpc_health_v1.HealthCheckResponse, error) {
  return &grpc_health_v1.HealthCheckResponse{
    Status: grpc_health_v1.HealthCheckResponse_SERVING,
  }, nil
}
```

### 5. Logging to stdout (Conflicts with gRPC Communication)

**Problem:** Plugin logs to stdout, corrupting the gRPC communication channel.

**Anti-pattern:**
```go
// ❌ Bad: logs to stdout, breaks gRPC
func processRequest(req *Request) {
  fmt.Println("Processing request:", req.ID)  // Corrupts stdout!
  log.Println("Request received")             // Default goes to stderr (OK)
}
```

**Correct pattern:**
```go
// ✅ Good: use hclog to stderr
import (
  hclog "github.com/hashicorp/go-hclog"
)

var logger = hclog.New(&hclog.LoggerOptions{
  Name:   "my-plugin",
  Output: os.Stderr,  // Must be stderr, not stdout
  Level:  hclog.Debug,
})

func processRequest(req *Request) {
  logger.Info("processing request", "id", req.ID)
}
```

**What to check:**
- [ ] All logging uses `hclog` or writes to stderr
- [ ] No `fmt.Println`, `fmt.Printf`, or `log.Println` that defaults to stdout
- [ ] Structured logging with key-value pairs

### 6. Not Using `hclog` for Structured Logging

**Problem:** Using standard `log` package instead of `hclog` loses structured logging benefits.

**Correct pattern:**
```go
// ✅ Good: structured logging with hclog
logger.Info("request processed",
  "id", req.ID,
  "duration", time.Since(start),
  "status", "success",
)

logger.Error("failed to process",
  "id", req.ID,
  "error", err,
)

logger.Debug("cache hit", "key", key)
```

### 7. Incorrect Plugin Map Registration

**Problem:** Plugin map doesn't correctly register all plugin types or uses wrong implementations.

**Anti-pattern:**
```go
// ❌ Bad: plugin name mismatch between host and plugin
// Host
pluginMap := map[string]plugin.Plugin{
  "myPlugin": &MyPlugin{},
}

// Plugin
pluginMap := map[string]plugin.Plugin{
  "my-plugin": &MyPlugin{},  // Name doesn't match!
}
```

**Correct pattern:**
```go
// shared/plugins.go
package shared

const PluginName = "myPlugin"

// Host
pluginMap := map[string]plugin.Plugin{
  shared.PluginName: &MyPlugin{},
}

// Plugin
pluginMap := map[string]plugin.Plugin{
  shared.PluginName: &MyPlugin{Impl: &MyPluginImpl{}},
}
```

## What to Check During Review

### 1. Handshake Configuration

**Checklist:**
- [ ] Handshake config is shared between host and plugin
- [ ] Protocol version matches
- [ ] Magic cookie key and value are identical
- [ ] Cookie value is unique to this plugin system

**Pattern to look for:**
```go
// shared/handshake.go
var Handshake = plugin.HandshakeConfig{
  ProtocolVersion:  1,
  MagicCookieKey:   "MY_PLUGIN",
  MagicCookieValue: "unique-value-here",
}

// Both host and plugin import shared.Handshake
```

### 2. Plugin Lifecycle Management

**Check for:**
- [ ] Signal handling for graceful shutdown
- [ ] Cleanup of resources on exit
- [ ] Context cancellation propagation
- [ ] Host calls `client.Kill()` on shutdown

**Host-side pattern:**
```go
client := plugin.NewClient(&plugin.ClientConfig{
  HandshakeConfig: handshake,
  Plugins:         pluginMap,
  Cmd:             exec.Command("./plugin"),
})

defer client.Kill()  // Ensure cleanup

rpcClient, err := client.Client()
if err != nil {
  return err
}

raw, err := rpcClient.Dispense("myPlugin")
if err != nil {
  return err
}

myPlugin := raw.(MyInterface)
```

**Plugin-side pattern:**
```go
func main() {
  ctx, cancel := context.WithCancel(context.Background())
  defer cancel()

  sigCh := make(chan os.Signal, 1)
  signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

  go func() {
    <-sigCh
    cleanup()
    cancel()
  }()

  plugin.Serve(&plugin.ServeConfig{
    HandshakeConfig: handshake,
    Plugins:         pluginMap,
  })
}
```

### 3. gRPC Server/Client Implementation

**Check that:**
- [ ] Server implements all proto service methods
- [ ] Client wraps the gRPC client correctly
- [ ] Error handling returns gRPC status codes
- [ ] Context is propagated through calls

**Server pattern:**
```go
type grpcServer struct {
  proto.UnimplementedMyServiceServer
  Impl MyInterface
}

func (s *grpcServer) DoSomething(ctx context.Context, req *proto.Request) (*proto.Response, error) {
  // Propagate context
  result, err := s.Impl.DoSomething(ctx, fromProto(req))
  if err != nil {
    return nil, status.Errorf(codes.Internal, "failed: %v", err)
  }
  return toProto(result), nil
}
```

**Client pattern:**
```go
type grpcClient struct {
  client proto.MyServiceClient
}

func (c *grpcClient) DoSomething(ctx context.Context, input Input) (Output, error) {
  resp, err := c.client.DoSomething(ctx, toProto(input))
  if err != nil {
    return Output{}, err
  }
  return fromProto(resp), nil
}
```

### 4. Logging Configuration

**Check for:**
- [ ] Uses `hclog` instead of standard `log`
- [ ] All logs go to stderr
- [ ] No `fmt.Println` or `fmt.Printf` to stdout
- [ ] Structured logging with key-value pairs

**Pattern:**
```go
import hclog "github.com/hashicorp/go-hclog"

var logger = hclog.New(&hclog.LoggerOptions{
  Name:   "my-plugin",
  Output: os.Stderr,
  Level:  hclog.Debug,
})

func init() {
  plugin.Serve(&plugin.ServeConfig{
    HandshakeConfig: handshake,
    Plugins:         pluginMap,
    Logger:          logger,  // Pass logger to plugin framework
  })
}
```

### 5. Plugin Map Consistency

**Check that:**
- [ ] Plugin names match between host and plugin
- [ ] All plugin types are registered
- [ ] Plugin implementations are correct

**Shared constants pattern:**
```go
// shared/constants.go
package shared

const (
  PluginTypeStorage  = "storage"
  PluginTypeCompute  = "compute"
)

// Host
pluginMap := map[string]plugin.Plugin{
  shared.PluginTypeStorage: &StoragePlugin{},
  shared.PluginTypeCompute: &ComputePlugin{},
}

// Plugin
pluginMap := map[string]plugin.Plugin{
  shared.PluginTypeStorage: &StoragePlugin{Impl: &StorageImpl{}},
  shared.PluginTypeCompute: &ComputePlugin{Impl: &ComputeImpl{}},
}
```

### 6. Version Negotiation

**Check for:**
- [ ] Host supports multiple protocol versions (if applicable)
- [ ] Plugin handles version-specific behavior
- [ ] Backwards compatibility is maintained

**Multi-version pattern:**
```go
client := plugin.NewClient(&plugin.ClientConfig{
  VersionedPlugins: map[int]plugin.PluginSet{
    1: {
      "myPlugin": &MyPluginV1{},
    },
    2: {
      "myPlugin": &MyPluginV2{},
    },
  },
  Cmd:             exec.Command("./plugin"),
  HandshakeConfig: handshake,
  ProtocolVersion: plugin.CoreProtocolVersion,
})

negotiated := client.NegotiatedVersion()
logger.Info("using protocol version", "version", negotiated)
```

### 7. Error Handling

**Check that:**
- [ ] gRPC status codes are used appropriately
- [ ] Errors include context (not just "failed")
- [ ] Client-side errors are wrapped with useful info

**Server error handling:**
```go
import (
  "google.golang.org/grpc/codes"
  "google.golang.org/grpc/status"
)

func (s *grpcServer) Process(ctx context.Context, req *proto.Request) (*proto.Response, error) {
  if req.ID == "" {
    return nil, status.Error(codes.InvalidArgument, "ID is required")
  }

  result, err := s.Impl.Process(ctx, fromProto(req))
  if err != nil {
    if errors.Is(err, ErrNotFound) {
      return nil, status.Errorf(codes.NotFound, "item not found: %v", err)
    }
    return nil, status.Errorf(codes.Internal, "processing failed: %v", err)
  }

  return toProto(result), nil
}
```

## gRPC Plugin Protocol

### How Bidirectional Communication Works

1. **Host starts plugin process:**
   ```go
   cmd := exec.Command("./plugin")
   client := plugin.NewClient(&plugin.ClientConfig{
     Cmd:             cmd,
     HandshakeConfig: handshake,
     Plugins:         pluginMap,
   })
   ```

2. **Handshake over stdin/stdout:**
   - Plugin writes its gRPC server address to stdout
   - Host reads the address and validates the magic cookie
   - Both sides verify protocol version compatibility

3. **gRPC communication:**
   - Host connects to plugin's gRPC server
   - All method calls use gRPC over that connection
   - stdout/stderr are now available for logging (stdout should not be used)

4. **Shutdown:**
   - Host calls `client.Kill()`
   - Plugin receives SIGTERM
   - Plugin cleans up and exits

### Protocol Version Negotiation

**How version negotiation works:**

```go
// Plugin advertises supported versions
plugin.Serve(&plugin.ServeConfig{
  HandshakeConfig: plugin.HandshakeConfig{
    ProtocolVersion: 2,  // Latest version plugin supports
  },
  VersionedPlugins: map[int]plugin.PluginSet{
    1: {...},  // Old version compatibility
    2: {...},  // Current version
  },
})

// Host requests a version range
client := plugin.NewClient(&plugin.ClientConfig{
  HandshakeConfig: plugin.HandshakeConfig{
    ProtocolVersion: 2,  // Latest version host supports
  },
  VersionedPlugins: map[int]plugin.PluginSet{
    1: {...},
    2: {...},
  },
})

// Negotiated version is the highest version both support
```

## Testing go-plugin Systems

### Host-Side Testing

**Pattern:**
```go
func TestPlugin(t *testing.T) {
  client := plugin.NewClient(&plugin.ClientConfig{
    HandshakeConfig: handshake,
    Plugins:         pluginMap,
    Cmd:             exec.Command("./test-plugin"),
  })
  defer client.Kill()

  rpcClient, err := client.Client()
  if err != nil {
    t.Fatal(err)
  }

  raw, err := rpcClient.Dispense("myPlugin")
  if err != nil {
    t.Fatal(err)
  }

  myPlugin := raw.(MyInterface)
  result, err := myPlugin.DoSomething(context.Background(), "test")
  if err != nil {
    t.Fatal(err)
  }

  if result != "expected" {
    t.Errorf("got %q, want %q", result, "expected")
  }
}
```

### Plugin-Side Testing

**Pattern:**
```go
func TestPluginImplementation(t *testing.T) {
  impl := &MyPluginImpl{}

  result, err := impl.DoSomething(context.Background(), "test")
  if err != nil {
    t.Fatal(err)
  }

  if result != "expected" {
    t.Errorf("got %q, want %q", result, "expected")
  }
}
```

## Review Checklist

**For every go-plugin PR:**

1. **Handshake:**
   - [ ] Config is shared between host and plugin
   - [ ] Protocol version matches
   - [ ] Magic cookie is identical

2. **Lifecycle:**
   - [ ] Plugin handles SIGTERM/SIGINT
   - [ ] Resources are cleaned up on exit
   - [ ] Host calls `client.Kill()`

3. **gRPC implementation:**
   - [ ] Server implements all proto methods
   - [ ] Client wraps gRPC client correctly
   - [ ] Context is propagated
   - [ ] Error handling uses gRPC status codes

4. **Logging:**
   - [ ] Uses `hclog` to stderr
   - [ ] No stdout logging
   - [ ] Structured logging with key-value pairs

5. **Plugin map:**
   - [ ] Names match between host and plugin
   - [ ] All types are registered

6. **Version negotiation:**
   - [ ] Multiple versions supported (if applicable)
   - [ ] Backwards compatibility maintained

## Resources

- [go-plugin documentation](https://github.com/hashicorp/go-plugin)
- [gRPC Go documentation](https://grpc.io/docs/languages/go/)
- [hclog documentation](https://github.com/hashicorp/go-hclog)
