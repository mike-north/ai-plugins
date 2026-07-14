# Sorbet Review Guidance

## What is Sorbet?

Sorbet is a fast, powerful type checker for Ruby. Key features:
- **Gradual typing**: Add types incrementally to existing codebases
- **Fast**: Written in C++, checks large codebases in seconds
- **Runtime checks**: `T.let`, `T.cast`, `T.must` enforce types at runtime
- **Editor integration**: Autocomplete, go-to-definition, hover types
- **Strictness levels**: `# typed: false|true|strict|strong`

## Common Mistakes

### 1. Missing sig on New/Changed Methods

**Problem**: Methods without `sig` declarations don't get type-checked, reducing safety.

**What to look for**:
```ruby
# ❌ Bad: no sig on new method
def calculate_total(items)
  items.sum(&:price)
end

# ✅ Good: sig declaration
sig { params(items: T::Array[Item]).returns(BigDecimal) }
def calculate_total(items)
  items.sum(&:price)
end

# ❌ Bad: sig on some methods but not others
class UserService
  sig { params(id: Integer).returns(T.nilable(User)) }
  def find_user(id)
    User.find_by(id: id)
  end

  def create_user(attrs)  # Missing sig!
    User.create!(attrs)
  end
end

# ✅ Good: sigs on all public methods
class UserService
  sig { params(id: Integer).returns(T.nilable(User)) }
  def find_user(id)
    User.find_by(id: id)
  end

  sig { params(attrs: T::Hash[Symbol, T.untyped]).returns(User) }
  def create_user(attrs)
    User.create!(attrs)
  end
end
```

**Check**:
- Do all new public methods have `sig` declarations?
- Do changed methods have updated `sig` if signature changed?
- Are private methods typed (when in `# typed: strict` or higher)?

### 2. Overuse of T.untyped

**Problem**: `T.untyped` opts out of type checking, defeating the purpose of types.

**What to look for**:
```ruby
# ❌ Bad: T.untyped when structure is known
sig { params(data: T.untyped).returns(T.untyped) }
def process_user_data(data)
  {
    name: data[:name],
    email: data[:email],
    age: data[:age]
  }
end

# ✅ Good: use T::Hash or T::Struct
sig { params(data: T::Hash[Symbol, T.untyped]).returns(T::Hash[Symbol, T.untyped]) }
def process_user_data(data)
  {
    name: data[:name],
    email: data[:email],
    age: data[:age]
  }
end

# ✅ Better: define structure with T::Struct
class UserData < T::Struct
  prop :name, String
  prop :email, String
  prop :age, Integer
end

sig { params(data: UserData).returns(T::Hash[Symbol, T.any(String, Integer)]) }
def process_user_data(data)
  {
    name: data.name,
    email: data.email,
    age: data.age
  }
end
```

**When T.untyped is acceptable**:
- Legacy code during gradual migration (with TODO comment)
- Third-party gem responses with dynamic structure
- Truly dynamic metaprogramming (document why)

**Check**:
- Is `T.untyped` used only where necessary?
- Are there comments explaining why `T.untyped` is needed?
- Could a more specific type (Hash, Struct, union) be used instead?

### 3. Using T.unsafe When Narrowing Would Work

**Problem**: `T.unsafe` bypasses type checking when flow-sensitive typing already handles the case.

**What to look for**:
```ruby
# ❌ Bad: unnecessary T.unsafe
sig { params(user: T.nilable(User)).returns(String) }
def get_user_name(user)
  return "Guest" if user.nil?
  T.unsafe(user).name  # T.unsafe not needed!
end

# ✅ Good: Sorbet understands nilability after nil check
sig { params(user: T.nilable(User)).returns(String) }
def get_user_name(user)
  return "Guest" if user.nil?
  user.name  # Sorbet knows user is not nil here
end

# ❌ Bad: T.unsafe for type narrowing
sig { params(value: T.any(String, Integer)).returns(String) }
def stringify(value)
  if value.is_a?(String)
    T.unsafe(value).upcase  # T.unsafe not needed!
  else
    value.to_s
  end
end

# ✅ Good: Sorbet narrows type after is_a? check
sig { params(value: T.any(String, Integer)).returns(String) }
def stringify(value)
  if value.is_a?(String)
    value.upcase  # Sorbet knows value is String here
  else
    value.to_s
  end
end
```

**When T.unsafe is acceptable**:
- Sorbet doesn't understand complex flow (document with comment)
- Working around Sorbet limitation (file a Sorbet issue reference in comment)
- Performance-critical path where runtime check overhead matters (profile first!)

**Check**:
- Is `T.unsafe` used when a nil check or `is_a?` would work?
- Are there comments explaining why `T.unsafe` is necessary?
- Could the code be restructured to avoid `T.unsafe`?

### 4. Incorrect T.nilable Usage

**Problem**: Wrapping already-nilable types in `T.nilable` is redundant and confusing.

**What to look for**:
```ruby
# ❌ Bad: redundant T.nilable
sig { params(user: T.nilable(T.nilable(User))).void }
def process_user(user)
  # ...
end

# ✅ Good: single T.nilable
sig { params(user: T.nilable(User)).void }
def process_user(user)
  # ...
end

# ❌ Bad: T.nilable on return when method never returns nil
sig { returns(T.nilable(String)) }
def get_constant_string
  "constant"  # Never nil, so T.nilable is wrong
end

# ✅ Good: non-nilable return
sig { returns(String) }
def get_constant_string
  "constant"
end

# ❌ Bad: not using T.nilable when nil is possible
sig { params(id: Integer).returns(User) }
def find_user(id)
  User.find_by(id: id)  # Returns nil if not found!
end

# ✅ Good: T.nilable when nil is possible
sig { params(id: Integer).returns(T.nilable(User)) }
def find_user(id)
  User.find_by(id: id)
end
```

**Check**:
- Is `T.nilable` used only once per type?
- Do methods that can return `nil` have `T.nilable` return types?
- Do methods that never return `nil` avoid `T.nilable`?

### 5. Not Using T::Struct for Value Objects

**Problem**: Using hashes or classes without structure when data shape is well-defined.

**What to look for**:
```ruby
# ❌ Bad: untyped hash
sig { returns(T::Hash[Symbol, T.untyped]) }
def user_summary
  {
    name: @name,
    email: @email,
    created_at: @created_at
  }
end

# ✅ Good: T::Struct with structure
class UserSummary < T::Struct
  const :name, String
  const :email, String
  const :created_at, Time
end

sig { returns(UserSummary) }
def user_summary
  UserSummary.new(
    name: @name,
    email: @email,
    created_at: @created_at
  )
end

# ❌ Bad: class with attr_accessor (no type safety)
class Address
  attr_accessor :street, :city, :zip
end

# ✅ Good: T::Struct with typed properties
class Address < T::Struct
  prop :street, String
  prop :city, String
  prop :zip, String
end
```

**T::Struct patterns**:
- `const`: Immutable property (preferred for value objects)
- `prop`: Mutable property
- `T.nilable(Type)`: Optional property

**Check**:
- Are value objects using `T::Struct` instead of hashes?
- Are struct properties using `const` (immutable) when appropriate?
- Are all struct properties typed?

### 6. Missing abstract! or sealed! on Base Classes

**Problem**: Abstract base classes without `abstract!` or sealed classes without `sealed!` don't enforce contracts.

**What to look for**:
```ruby
# ❌ Bad: abstract class without abstract! declaration
class PaymentMethod
  sig { returns(String) }
  def process_payment
    raise NotImplementedError  # Should use abstract!
  end
end

# ✅ Good: abstract class with abstract! and sig(:abstract)
class PaymentMethod
  extend T::Sig
  extend T::Helpers
  abstract!

  sig { abstract.returns(String) }
  def process_payment; end
end

class CreditCard < PaymentMethod
  sig { override.returns(String) }
  def process_payment
    "Processing credit card"
  end
end

# ❌ Bad: sealed hierarchy without sealed! declaration
class Shape
  sig { returns(Float) }
  def area
    raise NotImplementedError
  end
end

# ✅ Good: sealed class with exhaustive pattern matching
class Shape
  extend T::Sig
  extend T::Helpers
  sealed!
end

class Circle < Shape
  sig { params(radius: Float).void }
  def initialize(radius)
    @radius = radius
  end

  sig { returns(Float) }
  def area
    Math::PI * @radius ** 2
  end
end

class Rectangle < Shape
  sig { params(width: Float, height: Float).void }
  def initialize(width, height)
    @width = width
    @height = height
  end

  sig { returns(Float) }
  def area
    @width * @height
  end
end

sig { params(shape: Shape).returns(Float) }
def calculate_area(shape)
  case shape
  when Circle
    shape.area
  when Rectangle
    shape.area
  else
    T.absurd(shape)  # Sorbet ensures exhaustiveness
  end
end
```

**Check**:
- Are abstract base classes marked with `abstract!`?
- Are abstract methods using `sig { abstract.returns(...) }`?
- Are overridden methods using `sig { override.returns(...) }`?
- Are sealed hierarchies marked with `sealed!`?

### 7. T.let in Hot Paths

**Problem**: `T.let` adds runtime overhead in `# typed: strict` or higher. Use only when necessary.

**What to look for**:
```ruby
# ❌ Bad: T.let in loop (runtime overhead)
def process_items(items)
  items.each do |item|
    processed = T.let(transform(item), ProcessedItem)  # Called repeatedly!
    store(processed)
  end
end

# ✅ Good: assign to typed variable instead
sig { params(items: T::Array[Item]).void }
def process_items(items)
  items.each do |item|
    processed = transform(item)  # Sorbet infers type from sig
    store(processed)
  end
end

sig { params(item: Item).returns(ProcessedItem) }
def transform(item)
  # ...
end

# T.let is OK for one-time initialization
sig { void }
def initialize
  @config = T.let(load_config, Config)
end
```

**When T.let is appropriate**:
- Initializing instance variables (one-time cost)
- Complex type that Sorbet can't infer
- Making intent explicit in unclear code (document why)

**Check**:
- Is `T.let` used in hot paths (loops, frequently called methods)?
- Could a method `sig` make `T.let` unnecessary?
- Is `T.let` used only for clarity or is it required?

### 8. Type Annotations That Don't Match Behavior

**Problem**: Sigs that lie about what the method actually does break type safety.

**What to look for**:
```ruby
# ❌ Bad: sig says non-nil, but can return nil
sig { params(id: Integer).returns(User) }
def find_user(id)
  User.find_by(id: id)  # Returns nil if not found!
end

# ✅ Good: sig matches actual behavior
sig { params(id: Integer).returns(T.nilable(User)) }
def find_user(id)
  User.find_by(id: id)
end

# ❌ Bad: sig says Integer, but can return Float
sig { params(values: T::Array[Integer]).returns(Integer) }
def average(values)
  values.sum / values.size.to_f  # Returns Float!
end

# ✅ Good: sig matches actual return type
sig { params(values: T::Array[Integer]).returns(Float) }
def average(values)
  values.sum / values.size.to_f
end

# ❌ Bad: sig says params are required, but uses default args
sig { params(name: String, age: Integer).void }
def create_user(name, age = 18)  # age is optional!
end

# ✅ Good: sig matches default args
sig { params(name: String, age: Integer).void }
def create_user(name, age: 18)
end
```

**Check**:
- Do return types match what the method actually returns?
- Do param types match what the method actually accepts?
- Are nilable types used when nil is possible?
- Are default arguments reflected in the sig?

## Strictness Levels

### # typed: false (default)
- No type checking
- Used for legacy code or generated files

### # typed: true
- Type-checks method bodies
- Doesn't require sigs on all methods
- Good for gradual migration

### # typed: strict
- Requires sigs on all methods (public, protected, private)
- Stricter checks on constants and instance variables
- Recommended for new code

### # typed: strong
- Strictest level
- Disallows `T.untyped`, `T.unsafe`, `T.cast`
- Forces explicit typing everywhere
- Use sparingly (very restrictive)

**Check**:
- Are new files at least `# typed: true`?
- Are core library files moving toward `# typed: strict`?
- Is `# typed: false` only on legacy/generated code?

## What Good Looks Like

### Well-Typed Class

```ruby
# typed: strict

class UserService
  extend T::Sig

  sig { params(repository: UserRepository).void }
  def initialize(repository)
    @repository = T.let(repository, UserRepository)
  end

  sig { params(id: Integer).returns(T.nilable(User)) }
  def find_user(id)
    @repository.find_by_id(id)
  end

  sig { params(attrs: UserAttributes).returns(User) }
  def create_user(attrs)
    user = User.new(
      name: attrs.name,
      email: attrs.email,
      age: attrs.age
    )
    @repository.save(user)
    user
  end

  sig { params(user: User, updates: T::Hash[Symbol, T.untyped]).returns(User) }
  def update_user(user, updates)
    updates.each do |key, value|
      user.send("#{key}=", value)
    end
    @repository.save(user)
    user
  end
end
```

### T::Struct for Value Objects

```ruby
# typed: strict

class UserAttributes < T::Struct
  const :name, String
  const :email, String
  const :age, Integer, default: 18
  const :bio, T.nilable(String), default: nil
end

class Address < T::Struct
  const :street, String
  const :city, String
  const :state, String
  const :zip, String

  sig { returns(String) }
  def full_address
    "#{street}, #{city}, #{state} #{zip}"
  end
end
```

### Abstract Base Class

```ruby
# typed: strict

class Serializer
  extend T::Sig
  extend T::Helpers
  abstract!

  sig { abstract.params(object: T.untyped).returns(String) }
  def serialize(object); end

  sig { abstract.params(data: String).returns(T.untyped) }
  def deserialize(data); end
end

class JsonSerializer < Serializer
  sig { override.params(object: T.untyped).returns(String) }
  def serialize(object)
    JSON.generate(object)
  end

  sig { override.params(data: String).returns(T.untyped) }
  def deserialize(data)
    JSON.parse(data)
  end
end
```

### Sealed Class Hierarchy

```ruby
# typed: strict

class Result
  extend T::Sig
  extend T::Helpers
  sealed!
end

class Success < Result
  extend T::Sig

  sig { returns(T.untyped) }
  attr_reader :value

  sig { params(value: T.untyped).void }
  def initialize(value)
    @value = value
  end
end

class Failure < Result
  extend T::Sig

  sig { returns(String) }
  attr_reader :error

  sig { params(error: String).void }
  def initialize(error)
    @error = error
  end
end

sig { params(result: Result).returns(String) }
def handle_result(result)
  case result
  when Success
    "Success: #{result.value}"
  when Failure
    "Error: #{result.error}"
  else
    T.absurd(result)  # Ensures exhaustiveness
  end
end
```

## Review Checklist

### Method Signatures
- [ ] Do all new/changed methods have `sig` declarations?
- [ ] Do sigs match actual method behavior (return types, params)?
- [ ] Are nilable types used correctly?
- [ ] Are abstract methods using `sig { abstract.returns(...) }`?
- [ ] Are overrides using `sig { override.returns(...) }`?

### Type Safety
- [ ] Is `T.untyped` used sparingly with comments?
- [ ] Is `T.unsafe` avoided when type narrowing works?
- [ ] Are `T::Struct` classes used for value objects?
- [ ] Are appropriate strictness levels used (`# typed: true` minimum)?

### Class Design
- [ ] Are abstract base classes marked `abstract!`?
- [ ] Are sealed hierarchies marked `sealed!`?
- [ ] Are instance variables typed with `T.let` in initialize?

### Performance
- [ ] Is `T.let` avoided in hot paths?
- [ ] Are runtime checks (`T.must`, `T.cast`) used judiciously?

## Common Anti-Patterns to Flag

1. **T.untyped everywhere**: Using `T.untyped` as default instead of specific types
2. **Missing sigs**: New methods without type signatures
3. **Lying sigs**: Signatures that don't match actual behavior
4. **Unnecessary T.unsafe**: Using `T.unsafe` when flow-sensitive typing works
5. **Redundant T.nilable**: Wrapping already-nilable types
6. **Unstructured hashes**: Using hashes instead of `T::Struct` for known shapes
7. **Missing abstract!**: Abstract base classes without `abstract!` declaration
8. **T.let in loops**: Runtime overhead in performance-critical code

## References

- [Sorbet Documentation](https://sorbet.org/)
- [Sorbet Stdlib](https://github.com/sorbet/sorbet/tree/master/rbi/stdlib)
- [T::Struct](https://sorbet.org/docs/tstruct)
- [Abstract Classes](https://sorbet.org/docs/abstract)
- [Sealed Classes](https://sorbet.org/docs/sealed)
