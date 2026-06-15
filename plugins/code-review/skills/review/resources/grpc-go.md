# gRPC Go Review Guidance

## Overview

gRPC is Google's high-performance RPC framework built on HTTP/2. The Go implementation provides strongly-typed, efficient, and language-agnostic service communication.

**Core concepts:**
- Protocol Buffers define service interfaces and message types
- Services expose methods that clients can call remotely
- Unary RPCs (single request/response) and streaming RPCs (bidirectional streams)
- Interceptors for cross-cutting concerns (auth, logging, metrics)

## Common Mistakes

### 1. Not Propagating Context

**Problem:** Context isn't passed through the call chain, breaking cancellation, deadlines, and metadata propagation.

**Anti-pattern:**
```go
// ❌ Bad: creates new context, losing parent context
func (s *server) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
  ctx = context.Background()  // Loses parent context!
  user, err := s.db.FindUser(ctx, req.UserId)
  if err != nil {
    return nil, err
  }
  return user, nil
}
```

**Correct pattern:**
```go
// ✅ Good: propagates context through call chain
func (s *server) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
  // Context propagates cancellation, deadlines, metadata
  user, err := s.db.FindUser(ctx, req.UserId)
  if err != nil {
    return nil, status.Errorf(codes.Internal, "failed to find user: %v", err)
  }
  return user, nil
}
```

**What to check:**
- [ ] Context is passed through all layers
- [ ] No `context.Background()` or `context.TODO()` in request handlers
- [ ] Downstream calls receive the request context

### 2. Wrong gRPC Status Codes

**Problem:** Using `Internal` for user errors or wrong codes for specific failures.

**Anti-patterns:**
```go
// ❌ Bad: Internal for user error
if req.Email == "" {
  return nil, status.Error(codes.Internal, "email is required")
}

// ❌ Bad: generic error without status code
if !exists {
  return nil, errors.New("not found")  // Becomes Unknown code
}

// ❌ Bad: wrong code for the error type
if !authorized {
  return nil, status.Error(codes.Internal, "unauthorized")  // Should be Unauthenticated or PermissionDenied
}
```

**Correct patterns:**
```go
// ✅ Good: InvalidArgument for user input errors
if req.Email == "" {
  return nil, status.Error(codes.InvalidArgument, "email is required")
}

// ✅ Good: NotFound for missing resources
if !exists {
  return nil, status.Errorf(codes.NotFound, "user %s not found", req.UserId)
}

// ✅ Good: Unauthenticated or PermissionDenied for auth errors
if !authenticated {
  return nil, status.Error(codes.Unauthenticated, "authentication required")
}
if !authorized {
  return nil, status.Error(codes.PermissionDenied, "insufficient permissions")
}
```

**Status code decision guide:**

| Scenario | Code | Example |
|----------|------|---------|
| Missing/invalid input | `InvalidArgument` | Empty required field |
| Resource not found | `NotFound` | User ID doesn't exist |
| No auth credentials | `Unauthenticated` | Missing token |
| Insufficient permissions | `PermissionDenied` | User can't access resource |
| Resource already exists | `AlreadyExists` | Duplicate email |
| Resource exhausted | `ResourceExhausted` | Rate limit exceeded |
| Precondition failed | `FailedPrecondition` | State transition not allowed |
| Operation aborted | `Aborted` | Conflict, retry possible |
| Unimplemented method | `Unimplemented` | Feature not implemented |
| Service unavailable | `Unavailable` | Temporary failure, retry |
| Internal server error | `Internal` | Database connection failed |
| Deadline exceeded | `DeadlineExceeded` | Request timeout |
| Request cancelled | `Canceled` | Client cancelled request |

### 3. Missing Deadline/Timeout on Client Calls

**Problem:** Client calls don't set deadlines, causing indefinite hangs on slow servers.

**Anti-pattern:**
```go
// ❌ Bad: no timeout, can hang forever
client := pb.NewUserServiceClient(conn)
resp, err := client.GetUser(context.Background(), &pb.GetUserRequest{
  UserId: "123",
})
```

**Correct pattern:**
```go
// ✅ Good: set deadline
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

client := pb.NewUserServiceClient(conn)
resp, err := client.GetUser(ctx, &pb.GetUserRequest{
  UserId: "123",
})
if err != nil {
  if status.Code(err) == codes.DeadlineExceeded {
    log.Println("request timed out")
  }
  return err
}
```

**What to check:**
- [ ] All client calls use context with timeout/deadline
- [ ] Timeout values are reasonable for the operation
- [ ] `DeadlineExceeded` errors are handled appropriately

### 4. Not Draining Streams Properly Before Closing

**Problem:** Closing a stream without draining it can leak resources or cause errors.

**Anti-pattern:**
```go
// ❌ Bad: closes stream without draining
stream, err := client.ListUsers(ctx, &pb.ListUsersRequest{})
if err != nil {
  return err
}
// Returns immediately without reading responses
```

**Correct pattern:**
```go
// ✅ Good: drain stream before returning
stream, err := client.ListUsers(ctx, &pb.ListUsersRequest{})
if err != nil {
  return err
}

for {
  user, err := stream.Recv()
  if err == io.EOF {
    break  // Stream ended normally
  }
  if err != nil {
    return err
  }
  processUser(user)
}
```

**Server-side streaming:**
```go
// ✅ Good: handle SendAndClose correctly
func (s *server) ListUsers(req *pb.ListUsersRequest, stream pb.UserService_ListUsersServer) error {
  users, err := s.db.GetUsers(stream.Context())
  if err != nil {
    return status.Errorf(codes.Internal, "failed to get users: %v", err)
  }

  for _, user := range users {
    if err := stream.Send(user); err != nil {
      return err
    }
  }

  return nil  // Automatically closes stream
}
```

**Client-side streaming:**
```go
// ✅ Good: close send side properly
stream, err := client.UploadUsers(ctx)
if err != nil {
  return err
}

for _, user := range users {
  if err := stream.Send(user); err != nil {
    return err
  }
}

resp, err := stream.CloseAndRecv()
if err != nil {
  return err
}
```

### 5. Incorrect Interceptor Chain Ordering

**Problem:** Interceptors are ordered incorrectly, causing auth to run after logging, or metrics to miss errors.

**Anti-pattern:**
```go
// ❌ Bad: logging runs before auth (logs unauthorized requests)
// ❌ Bad: metrics runs after error handling (misses some errors)
grpc.NewServer(
  grpc.ChainUnaryInterceptor(
    loggingInterceptor,   // Runs first
    authInterceptor,      // Should run first!
    errorInterceptor,
    metricsInterceptor,   // Runs last, might miss errors
  ),
)
```

**Correct pattern:**
```go
// ✅ Good: correct ordering
grpc.NewServer(
  grpc.ChainUnaryInterceptor(
    authInterceptor,       // 1. Auth first (fail fast)
    loggingInterceptor,    // 2. Log authenticated requests
    metricsInterceptor,    // 3. Metrics (wraps everything)
    errorInterceptor,      // 4. Error handling last (translates errors)
  ),
)
```

**Interceptor ordering principles:**
1. **Auth first** - Reject unauthorized requests early
2. **Logging** - Log after auth (don't log unauthorized requests)
3. **Metrics** - Wrap the actual business logic
4. **Error handling** - Last layer, translates domain errors to gRPC status

### 6. Large Messages Without Streaming

**Problem:** Sending large messages (>4MB default limit) as unary calls instead of streaming.

**Anti-pattern:**
```go
// ❌ Bad: sends entire large file as one message
func (s *server) UploadFile(ctx context.Context, req *pb.UploadFileRequest) (*pb.UploadFileResponse, error) {
  // req.Content is 100MB!
  return nil, status.Error(codes.ResourceExhausted, "message too large")
}
```

**Correct pattern:**
```go
// ✅ Good: use streaming for large data
func (s *server) UploadFile(stream pb.FileService_UploadFileServer) error {
  var buf bytes.Buffer
  
  for {
    chunk, err := stream.Recv()
    if err == io.EOF {
      // Process complete file
      return stream.SendAndClose(&pb.UploadFileResponse{
        Success: true,
      })
    }
    if err != nil {
      return err
    }
    
    buf.Write(chunk.Content)
  }
}
```

**What to check:**
- [ ] Large data transfers use streaming RPCs
- [ ] Message sizes are reasonable (<1MB for unary)
- [ ] `MaxRecvMsgSize` and `MaxSendMsgSize` are set if needed

### 7. Not Handling `io.EOF` in Stream Receives

**Problem:** Treating `io.EOF` as an error instead of normal stream end.

**Anti-pattern:**
```go
// ❌ Bad: treats EOF as error
for {
  msg, err := stream.Recv()
  if err != nil {
    return err  // EOF becomes an error!
  }
  process(msg)
}
```

**Correct pattern:**
```go
// ✅ Good: EOF is normal stream end
for {
  msg, err := stream.Recv()
  if err == io.EOF {
    break  // Stream ended normally
  }
  if err != nil {
    return err  // Real error
  }
  process(msg)
}
```

## What to Check During Review

### 1. Context Propagation

**Checklist:**
- [ ] Request context is passed through all layers
- [ ] No `context.Background()` in handlers
- [ ] Context cancellation is respected
- [ ] Metadata is propagated when needed

**Pattern:**
```go
func (s *server) GetUser(ctx context.Context, req *pb.GetUserRequest) (*pb.User, error) {
  // Check context before expensive operations
  select {
  case <-ctx.Done():
    return nil, ctx.Err()
  default:
  }

  // Pass context to downstream calls
  user, err := s.db.FindUser(ctx, req.UserId)
  if err != nil {
    return nil, status.Errorf(codes.Internal, "database error: %v", err)
  }

  return user, nil
}
```

### 2. Status Code Usage

**Check that:**
- [ ] User errors use `InvalidArgument`, not `Internal`
- [ ] Missing resources use `NotFound`
- [ ] Auth errors use `Unauthenticated` or `PermissionDenied`
- [ ] `Internal` is only for actual server errors
- [ ] Errors include useful context in the message

**Pattern:**
```go
if req.Email == "" {
  return nil, status.Error(codes.InvalidArgument, "email is required")
}

user, err := s.db.FindUserByEmail(ctx, req.Email)
if err != nil {
  if errors.Is(err, sql.ErrNoRows) {
    return nil, status.Errorf(codes.NotFound, "user with email %s not found", req.Email)
  }
  return nil, status.Errorf(codes.Internal, "database error: %v", err)
}
```

### 3. Client Timeouts

**Check for:**
- [ ] All client calls have context with timeout
- [ ] Timeout durations are reasonable
- [ ] `DeadlineExceeded` errors are handled

**Pattern:**
```go
ctx, cancel := context.WithTimeout(parentCtx, 10*time.Second)
defer cancel()

resp, err := client.GetUser(ctx, &pb.GetUserRequest{UserId: id})
if err != nil {
  st, ok := status.FromError(err)
  if ok && st.Code() == codes.DeadlineExceeded {
    return nil, fmt.Errorf("request timed out after 10s")
  }
  return nil, err
}
```

### 4. Streaming RPC Handling

**Check that:**
- [ ] Client drains streams before returning
- [ ] Server streams are properly closed
- [ ] `io.EOF` is handled correctly (not treated as error)
- [ ] `Send()` errors are checked

**Server-side streaming:**
```go
func (s *server) ListUsers(req *pb.ListUsersRequest, stream pb.UserService_ListUsersServer) error {
  users, err := s.db.GetUsers(stream.Context())
  if err != nil {
    return status.Errorf(codes.Internal, "failed to get users: %v", err)
  }

  for _, user := range users {
    // Check context before each send
    if stream.Context().Err() != nil {
      return stream.Context().Err()
    }

    if err := stream.Send(user); err != nil {
      return err
    }
  }

  return nil
}
```

**Client-side receiving:**
```go
stream, err := client.ListUsers(ctx, &pb.ListUsersRequest{})
if err != nil {
  return err
}

var users []*pb.User
for {
  user, err := stream.Recv()
  if err == io.EOF {
    break
  }
  if err != nil {
    return err
  }
  users = append(users, user)
}
```

### 5. Interceptor Configuration

**Check that:**
- [ ] Auth interceptor runs first
- [ ] Logging runs after auth
- [ ] Metrics wrap the business logic
- [ ] Error translation runs last

**Pattern:**
```go
server := grpc.NewServer(
  grpc.ChainUnaryInterceptor(
    authInterceptor,
    loggingInterceptor,
    metricsInterceptor,
    recoveryInterceptor,  // Panic recovery
  ),
  grpc.ChainStreamInterceptor(
    authStreamInterceptor,
    loggingStreamInterceptor,
    metricsStreamInterceptor,
  ),
)
```

### 6. Error Handling

**Check for:**
- [ ] Errors are wrapped with gRPC status codes
- [ ] Error messages don't leak internal details
- [ ] Errors include useful context for debugging
- [ ] Status codes match error semantics

**Pattern:**
```go
func (s *server) UpdateUser(ctx context.Context, req *pb.UpdateUserRequest) (*pb.User, error) {
  if req.UserId == "" {
    return nil, status.Error(codes.InvalidArgument, "user_id is required")
  }

  user, err := s.db.UpdateUser(ctx, req.UserId, req.Updates)
  if err != nil {
    if errors.Is(err, ErrUserNotFound) {
      return nil, status.Errorf(codes.NotFound, "user %s not found", req.UserId)
    }
    if errors.Is(err, ErrVersionConflict) {
      return nil, status.Error(codes.Aborted, "version conflict, retry")
    }
    // Don't leak internal error details
    log.Printf("failed to update user %s: %v", req.UserId, err)
    return nil, status.Error(codes.Internal, "failed to update user")
  }

  return user, nil
}
```

### 7. Connection Management

**Check that:**
- [ ] Connections are reused, not created per request
- [ ] Connections are closed on shutdown
- [ ] Keepalive settings are configured
- [ ] Connection errors are handled with retry/backoff

**Client pattern:**
```go
func NewClient(address string) (*Client, error) {
  ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
  defer cancel()

  conn, err := grpc.DialContext(ctx, address,
    grpc.WithTransportCredentials(insecure.NewCredentials()),
    grpc.WithKeepaliveParams(keepalive.ClientParameters{
      Time:                10 * time.Second,
      Timeout:             3 * time.Second,
      PermitWithoutStream: true,
    }),
    grpc.WithBlock(),  // Wait for connection
  )
  if err != nil {
    return nil, fmt.Errorf("failed to connect: %w", err)
  }

  return &Client{
    conn:   conn,
    client: pb.NewUserServiceClient(conn),
  }, nil
}

func (c *Client) Close() error {
  return c.conn.Close()
}
```

## Interceptor Patterns

### Unary Interceptor

**Pattern:**
```go
func UnaryLoggingInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
  start := time.Now()

  log.Printf("received %s", info.FullMethod)

  // Call the handler
  resp, err := handler(ctx, req)

  duration := time.Since(start)
  code := codes.OK
  if err != nil {
    code = status.Code(err)
  }

  log.Printf("completed %s: %s (duration=%v)", info.FullMethod, code, duration)

  return resp, err
}
```

### Stream Interceptor

**Pattern:**
```go
func StreamLoggingInterceptor(srv interface{}, stream grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
  start := time.Now()

  log.Printf("started stream %s", info.FullMethod)

  err := handler(srv, stream)

  duration := time.Since(start)
  code := codes.OK
  if err != nil {
    code = status.Code(err)
  }

  log.Printf("finished stream %s: %s (duration=%v)", info.FullMethod, code, duration)

  return err
}
```

## Deadline Propagation

### Server-Side Deadline Checking

**Pattern:**
```go
func (s *server) SlowOperation(ctx context.Context, req *pb.Request) (*pb.Response, error) {
  // Check deadline before expensive operation
  deadline, ok := ctx.Deadline()
  if ok {
    remaining := time.Until(deadline)
    if remaining < 100*time.Millisecond {
      return nil, status.Error(codes.DeadlineExceeded, "insufficient time remaining")
    }
  }

  // Long-running operation
  result, err := s.processData(ctx, req.Data)
  if err != nil {
    return nil, err
  }

  return &pb.Response{Result: result}, nil
}
```

### Client-Side Deadline Setting

**Pattern:**
```go
func (c *Client) GetUserWithDeadline(ctx context.Context, id string, timeout time.Duration) (*pb.User, error) {
  ctx, cancel := context.WithTimeout(ctx, timeout)
  defer cancel()

  user, err := c.client.GetUser(ctx, &pb.GetUserRequest{UserId: id})
  if err != nil {
    if status.Code(err) == codes.DeadlineExceeded {
      return nil, fmt.Errorf("request timed out after %v", timeout)
    }
    return nil, err
  }

  return user, nil
}
```

## Review Checklist

**For every gRPC Go PR:**

1. **Context:**
   - [ ] Context propagated through all layers
   - [ ] No `context.Background()` in handlers
   - [ ] Cancellation is respected

2. **Status codes:**
   - [ ] `InvalidArgument` for user errors
   - [ ] `NotFound` for missing resources
   - [ ] `Unauthenticated` / `PermissionDenied` for auth
   - [ ] `Internal` only for server errors

3. **Timeouts:**
   - [ ] Client calls have deadlines
   - [ ] Timeout values are reasonable
   - [ ] `DeadlineExceeded` is handled

4. **Streaming:**
   - [ ] Streams are drained properly
   - [ ] `io.EOF` is handled correctly
   - [ ] `Send()` errors are checked

5. **Interceptors:**
   - [ ] Auth runs first
   - [ ] Logging after auth
   - [ ] Metrics wrap business logic
   - [ ] Correct ordering for both unary and stream

6. **Error handling:**
   - [ ] Errors have gRPC status codes
   - [ ] Messages don't leak internal details
   - [ ] Useful context for debugging

7. **Connection management:**
   - [ ] Connections are reused
   - [ ] Connections closed on shutdown
   - [ ] Keepalive configured

## Resources

- [gRPC Go documentation](https://grpc.io/docs/languages/go/)
- [gRPC status codes](https://grpc.github.io/grpc/core/md_doc_statuscodes.html)
- [Context in Go](https://go.dev/blog/context)
