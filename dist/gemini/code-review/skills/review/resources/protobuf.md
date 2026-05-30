# Protobuf Review Guidance

## What is Protobuf?

Protocol Buffers (protobuf) is Google's language-neutral, platform-neutral mechanism for serializing structured data. Key features:
- **Language agnostic**: Generate code for Go, Java, Python, C++, Ruby, etc.
- **Backward/forward compatible**: Evolve schemas without breaking existing clients
- **Efficient**: Compact binary format, faster than JSON/XML
- **Strongly typed**: Schema defines exact data structure
- **Code generation**: Compiler generates type-safe code

## Common Mistakes

### 1. Reusing Field Numbers

**Problem**: Field numbers are part of the wire format. Reusing a deleted field's number breaks compatibility.

**What to look for**:
```protobuf
// ❌ DANGEROUS: reusing field number 2
message User {
  string name = 1;
  string email = 2;  // Was 'age', deleted and reused for 'email'!
}

// Old clients reading new data will interpret 'email' string as 'age' int!
// New clients reading old data will interpret 'age' int as 'email' string!

// ✅ GOOD: reserve deleted field numbers
message User {
  reserved 2;        // Can never be reused
  reserved "age";    // Reserve name too (prevents accidents)

  string name = 1;
  string email = 3;  // Use a new field number
}

// ✅ GOOD: reserve ranges
message User {
  reserved 2 to 10;  // Reserve a range of field numbers
  reserved "age", "old_field", "deprecated_field";

  string name = 1;
  string email = 11;
}
```

**Why field numbers matter**:
- Field numbers 1-15 use 1 byte (reserve for common fields)
- Field numbers 16-2047 use 2 bytes
- Field numbers can't be changed after deployment
- Deleted field numbers must be reserved forever

**Check**:
- Are deleted fields reserved with `reserved` keyword?
- Are field numbers sequential (no gaps without explanation)?
- Are frequently-used fields using low numbers (1-15)?
- Are both field numbers AND names reserved?

### 2. Changing Field Types

**Problem**: Type changes break wire format compatibility.

**What to look for**:
```protobuf
// ❌ BREAKING: changing field type
// Before:
message User {
  int32 age = 1;
}

// After:
message User {
  string age = 1;  // BREAKS wire format!
}

// ✅ GOOD: add new field with new number
message User {
  reserved 1;
  reserved "age";

  int32 age_int = 1;      // Keep old (deprecated)
  string age_string = 2;  // Add new
}

// ✅ BETTER: deprecate old, add new
message User {
  int32 age = 1 [deprecated = true];
  string age_string = 2;
}
```

**Safe type changes** (wire-compatible):
- `int32`, `uint32`, `int64`, `uint64`, `bool` are compatible with each other
- `sint32` and `sint64` are compatible with each other
- `string` and `bytes` are compatible (if UTF-8 valid)
- `fixed32` is compatible with `sfixed32`
- `fixed64` is compatible with `sfixed64`

**Unsafe type changes**:
- Numeric ↔ string
- Numeric ↔ message/bytes
- Message ↔ anything else

**Check**:
- Are field types unchanged from previous versions?
- If types must change, is a new field added instead?
- Are unsafe type changes avoided?

### 3. Not Reserving Deleted Fields

**Problem**: Future developers might reuse deleted field names/numbers, breaking old clients.

**What to look for**:
```protobuf
// ❌ BAD: deleted field without reservation
message User {
  string name = 1;
  // Field 'email' with number 2 was deleted - not reserved!
  string address = 3;
}

// Months later, someone adds:
message User {
  string name = 1;
  string phone = 2;  // Reuses number 2! Old clients will break!
  string address = 3;
}

// ✅ GOOD: reserve deleted fields
message User {
  reserved 2;
  reserved "email";

  string name = 1;
  string address = 3;
}

// Now adding 'phone' will fail at compile time if number 2 is used
```

**Reservation best practices**:
```protobuf
message User {
  // Reserve field numbers
  reserved 2, 4, 6 to 10;

  // Reserve field names (separate statement)
  reserved "old_field", "deprecated_field", "removed_field";

  string name = 1;
  string address = 3;
  int32 age = 5;
}
```

**Check**:
- Are all deleted field numbers reserved?
- Are all deleted field names reserved?
- Is there a comment explaining why fields were deleted?

### 4. Using required Fields (proto2) or Not Understanding proto3 Defaults

**Problem**: `required` fields in proto2 are deprecated and cause compatibility issues. Proto3 has different defaults.

**What to look for**:
```protobuf
// ❌ BAD (proto2): required fields
syntax = "proto2";

message User {
  required string name = 1;  // Can't evolve - always required!
  required int32 age = 2;    // Adding later breaks old clients
  optional string email = 3;
}

// ✅ GOOD (proto2): use optional
syntax = "proto2";

message User {
  optional string name = 1;
  optional int32 age = 2;
  optional string email = 3;
}

// ✅ GOOD (proto3): all fields optional by default
syntax = "proto3";

message User {
  string name = 1;    // Optional by default
  int32 age = 2;      // Default: 0
  string email = 3;   // Default: ""
}
```

**Proto3 default values**:
- `string`: `""` (empty string)
- `bytes`: `[]` (empty bytes)
- `bool`: `false`
- Numeric: `0`
- Enums: First value (must be `0`)
- Messages: Not set (language-specific null/nil)
- Repeated: Empty list

**Check**:
- Are `required` fields avoided (proto2)?
- Is proto3 used for new schemas (unless proto2 is required)?
- Are default values understood and documented?

### 5. Enums Without UNSPECIFIED as First Value

**Problem**: Proto3 requires first enum value to be `0`. Missing `UNSPECIFIED` causes confusion.

**What to look for**:
```protobuf
// ❌ BAD: enum doesn't start with 0
syntax = "proto3";

enum Status {
  PENDING = 1;   // Must be 0!
  APPROVED = 2;
  REJECTED = 3;
}

// ❌ BAD: enum starts at 0 but not named UNSPECIFIED
enum Status {
  UNKNOWN = 0;   // OK, but UNSPECIFIED is clearer
  PENDING = 1;
  APPROVED = 2;
}

// ✅ GOOD: UNSPECIFIED at 0
enum Status {
  STATUS_UNSPECIFIED = 0;  // Prefixed with enum name
  STATUS_PENDING = 1;
  STATUS_APPROVED = 2;
  STATUS_REJECTED = 3;
}
```

**Enum best practices**:
- First value must be `0` (proto3)
- Name first value `<ENUM_NAME>_UNSPECIFIED`
- Prefix all values with enum name (prevents conflicts)
- Reserve deleted enum values

```protobuf
enum Color {
  reserved 3;
  reserved "RED";  // Deleted value

  COLOR_UNSPECIFIED = 0;
  COLOR_BLUE = 1;
  COLOR_GREEN = 2;
  // COLOR_RED = 3 was deleted
  COLOR_YELLOW = 4;
}
```

**Check**:
- Do enums have value `0` as first entry?
- Is the first value named `<ENUM>_UNSPECIFIED`?
- Are enum values prefixed with enum name?
- Are deleted enum values reserved?

### 6. Missing Package Declarations

**Problem**: No package means types are in global namespace, causing conflicts.

**What to look for**:
```protobuf
// ❌ BAD: no package
syntax = "proto3";

message User {
  string name = 1;
}

// ✅ GOOD: package declared
syntax = "proto3";

package mycompany.users.v1;

message User {
  string name = 1;
}
// Generated types: mycompany.users.v1.User
```

**Package naming conventions**:
- Lowercase, dot-separated
- Include company/project namespace
- Include version (`v1`, `v2`)
- Match directory structure

```protobuf
// File: mycompany/users/v1/user.proto
syntax = "proto3";

package mycompany.users.v1;

option go_package = "github.com/mycompany/api/users/v1;usersv1";
```

**Check**:
- Is `package` declared in every `.proto` file?
- Does package follow naming conventions?
- Does package include version?
- Does directory structure match package?

### 7. Not Using Well-Known Types

**Problem**: Reinventing common types instead of using standard well-known types.

**What to look for**:
```protobuf
// ❌ BAD: custom timestamp (seconds since epoch)
message Event {
  int64 created_at = 1;  // Seconds? Millis? Timezone?
}

// ❌ BAD: custom duration
message Task {
  int64 timeout_seconds = 1;  // Loses precision, unclear units
}

// ✅ GOOD: use google.protobuf.Timestamp
import "google/protobuf/timestamp.proto";

message Event {
  google.protobuf.Timestamp created_at = 1;  // Standard, well-defined
}

// ✅ GOOD: use google.protobuf.Duration
import "google/protobuf/duration.proto";

message Task {
  google.protobuf.Duration timeout = 1;  // Standard, well-defined
}
```

**Common well-known types**:
- `google.protobuf.Timestamp`: Point in time
- `google.protobuf.Duration`: Time span
- `google.protobuf.Empty`: Empty request/response
- `google.protobuf.Struct`: Dynamic JSON-like structure
- `google.protobuf.Value`: Dynamic typed value
- `google.protobuf.Any`: Any message type

**More well-known types**:
```protobuf
import "google/protobuf/empty.proto";
import "google/protobuf/wrappers.proto";

service UserService {
  // Empty request
  rpc ListUsers(google.protobuf.Empty) returns (ListUsersResponse);
}

message Config {
  // Nullable int (distinguishes 0 from unset)
  google.protobuf.Int32Value max_retries = 1;

  // Nullable string
  google.protobuf.StringValue api_key = 2;
}
```

**Check**:
- Are timestamps using `google.protobuf.Timestamp`?
- Are durations using `google.protobuf.Duration`?
- Are empty requests/responses using `google.protobuf.Empty`?
- Are nullable primitives using wrapper types?

### 8. Breaking Service Changes

**Problem**: Renaming RPCs or changing request/response types breaks clients.

**What to look for**:
```protobuf
// ❌ BREAKING: renaming RPC
// Before:
service UserService {
  rpc GetUser(GetUserRequest) returns (User);
}

// After:
service UserService {
  rpc FetchUser(GetUserRequest) returns (User);  // BREAKS clients!
}

// ✅ GOOD: deprecate old, add new
service UserService {
  rpc GetUser(GetUserRequest) returns (User) {
    option deprecated = true;
  }
  rpc FetchUser(GetUserRequest) returns (User);
}

// ❌ BREAKING: changing response type
// Before:
rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);

// After:
rpc ListUsers(ListUsersRequest) returns (stream User);  // BREAKS clients!

// ✅ GOOD: add new RPC
rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);
rpc StreamUsers(ListUsersRequest) returns (stream User);
```

**Backward-compatible service changes**:
- Adding new RPCs (safe)
- Adding fields to request/response (safe if optional)
- Deprecating RPCs (safe, but mark `option deprecated = true`)

**Breaking service changes**:
- Renaming RPCs
- Deleting RPCs
- Changing request/response types
- Changing streaming behavior

**Check**:
- Are existing RPCs unchanged (not renamed/deleted)?
- Are RPC request/response types unchanged?
- Are new RPCs added instead of modifying existing?
- Are deprecated RPCs marked with `option deprecated = true`?

### 9. Using Repeated Fields Manually (field1, field2, ...)

**Problem**: Manually numbering repeated concepts instead of using `repeated` field.

**What to look for**:
```protobuf
// ❌ BAD: manually numbered fields
message User {
  string phone1 = 1;
  string phone2 = 2;
  string phone3 = 3;
  // What if user has 4 phones?
}

// ✅ GOOD: repeated field
message User {
  repeated string phones = 1;  // Unlimited, type-safe
}

// ❌ BAD: fixed array size with separate fields
message Coordinates {
  double x = 1;
  double y = 2;
  double z = 3;
}
// This is OK if semantics are different (x, y, z have meaning)

// ❌ BAD: generic list as separate fields
message Config {
  string item1 = 1;
  string item2 = 2;
  string item3 = 3;
}

// ✅ GOOD: repeated field
message Config {
  repeated string items = 1;
}
```

**Check**:
- Are `repeated` fields used instead of `field1`, `field2`, ...?
- Do manually numbered fields have distinct semantics?

### 10. Missing Comments on Messages/Fields/Services

**Problem**: No documentation for schema makes it hard to use correctly.

**What to look for**:
```protobuf
// ❌ BAD: no comments
message User {
  string name = 1;
  string email = 2;
  int32 age = 3;
}

// ✅ GOOD: documented
// User represents a registered user in the system.
message User {
  // Full name of the user (first and last).
  string name = 1;

  // Primary email address. Must be unique across all users.
  string email = 2;

  // Age in years. Must be >= 13 (COPPA compliance).
  int32 age = 3;
}

// ✅ GOOD: service documentation
// UserService provides operations for managing user accounts.
service UserService {
  // GetUser retrieves a user by ID.
  // Returns NOT_FOUND if user doesn't exist.
  rpc GetUser(GetUserRequest) returns (User);

  // CreateUser creates a new user account.
  // Returns ALREADY_EXISTS if email is taken.
  rpc CreateUser(CreateUserRequest) returns (User);
}
```

**Documentation best practices**:
- Document all messages, fields, enums, services, RPCs
- Explain constraints (required ranges, uniqueness, formats)
- Document error cases for RPCs
- Use present tense ("Represents...", not "Will represent...")

**Check**:
- Do all messages have comments?
- Do all fields have comments explaining purpose?
- Do all RPCs document parameters, return values, errors?
- Are constraints documented (ranges, formats, requirements)?

## What Good Looks Like

### Well-Structured Message

```protobuf
syntax = "proto3";

package mycompany.users.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/mycompany/api/users/v1;usersv1";

// User represents a registered user in the system.
message User {
  // Unique identifier for the user.
  // Assigned by the system, read-only.
  string id = 1;

  // Full name of the user.
  // Required, max 100 characters.
  string name = 2;

  // Primary email address.
  // Required, must be unique, validated as RFC 5322.
  string email = 3;

  // User's birth date.
  google.protobuf.Timestamp birth_date = 4;

  // Account status.
  Status status = 5;

  // Additional phone numbers (optional).
  repeated string phone_numbers = 6;

  // Reserved fields from deleted features.
  reserved 7, 8 to 10;
  reserved "old_password", "legacy_field";
}

// Status represents the current state of a user account.
enum Status {
  // Default value, should not be used.
  STATUS_UNSPECIFIED = 0;

  // Account is active and can be used.
  STATUS_ACTIVE = 1;

  // Account is suspended, user cannot log in.
  STATUS_SUSPENDED = 2;

  // Account is permanently deleted.
  STATUS_DELETED = 3;
}
```

### Well-Structured Service

```protobuf
syntax = "proto3";

package mycompany.users.v1;

import "mycompany/users/v1/user.proto";
import "google/protobuf/empty.proto";
import "google/protobuf/field_mask.proto";

option go_package = "github.com/mycompany/api/users/v1;usersv1";

// UserService provides operations for managing user accounts.
service UserService {
  // GetUser retrieves a user by ID.
  // Returns NOT_FOUND if user doesn't exist.
  rpc GetUser(GetUserRequest) returns (User);

  // ListUsers returns a paginated list of users.
  rpc ListUsers(ListUsersRequest) returns (ListUsersResponse);

  // CreateUser creates a new user account.
  // Returns ALREADY_EXISTS if email is already in use.
  // Returns INVALID_ARGUMENT if request validation fails.
  rpc CreateUser(CreateUserRequest) returns (User);

  // UpdateUser updates an existing user.
  // Only fields specified in update_mask are modified.
  // Returns NOT_FOUND if user doesn't exist.
  rpc UpdateUser(UpdateUserRequest) returns (User);

  // DeleteUser permanently deletes a user account.
  // This operation cannot be undone.
  // Returns NOT_FOUND if user doesn't exist.
  rpc DeleteUser(DeleteUserRequest) returns (google.protobuf.Empty);
}

// Request message for GetUser RPC.
message GetUserRequest {
  // ID of the user to retrieve.
  string id = 1;
}

// Request message for ListUsers RPC.
message ListUsersRequest {
  // Maximum number of users to return.
  // Defaults to 50, max 1000.
  int32 page_size = 1;

  // Pagination token from previous response.
  string page_token = 2;
}

// Response message for ListUsers RPC.
message ListUsersResponse {
  // List of users.
  repeated User users = 1;

  // Token to retrieve next page.
  // Empty if no more pages.
  string next_page_token = 2;
}

// Request message for CreateUser RPC.
message CreateUserRequest {
  // User to create.
  // ID field is ignored (assigned by system).
  User user = 1;
}

// Request message for UpdateUser RPC.
message UpdateUserRequest {
  // User with updated fields.
  User user = 1;

  // Fields to update.
  // If empty, all fields are updated.
  google.protobuf.FieldMask update_mask = 2;
}

// Request message for DeleteUser RPC.
message DeleteUserRequest {
  // ID of the user to delete.
  string id = 1;
}
```

## Review Checklist

### Field Management
- [ ] Are field numbers never reused?
- [ ] Are deleted fields reserved (both number and name)?
- [ ] Are field types unchanged from previous versions?
- [ ] Are field numbers sequential (or gaps explained)?
- [ ] Are common fields using low numbers (1-15)?

### Type System
- [ ] Are enums starting with `<NAME>_UNSPECIFIED = 0`?
- [ ] Are well-known types used (Timestamp, Duration, Empty)?
- [ ] Are `required` fields avoided (proto2)?
- [ ] Are `repeated` fields used instead of `field1`, `field2`?

### Package & Imports
- [ ] Is `package` declared in every file?
- [ ] Does package include version (v1, v2)?
- [ ] Is `option go_package` set (for Go projects)?

### Service Design
- [ ] Are existing RPCs unchanged (not renamed/deleted)?
- [ ] Are RPC request/response types unchanged?
- [ ] Are deprecated RPCs marked `option deprecated = true`?

### Documentation
- [ ] Do all messages have comments?
- [ ] Do all fields have comments?
- [ ] Do all RPCs document errors and constraints?

## Common Anti-Patterns to Flag

1. **Reused field numbers**: Breaks wire format compatibility
2. **Changed field types**: Breaks deserialization
3. **Unreserved deleted fields**: Future collisions
4. **Enum without `0` value**: Proto3 requires it
5. **Missing package**: Global namespace pollution
6. **Not using well-known types**: Reinventing Timestamp/Duration
7. **Breaking service changes**: Renaming/deleting RPCs
8. **Manual repeated fields**: Using `field1`, `field2` instead of `repeated`
9. **Undocumented schema**: No comments on messages/fields

## References

- [Protocol Buffers Language Guide](https://protobuf.dev/programming-guides/proto3/)
- [Style Guide](https://protobuf.dev/programming-guides/style/)
- [API Best Practices](https://cloud.google.com/apis/design)
- [Well-Known Types](https://protobuf.dev/reference/protobuf/google.protobuf/)
