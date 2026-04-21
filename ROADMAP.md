# Roadmap

## Ilha

- [x] Fluent builder API with typed external props
- [x] Reactive signals with optional initializer
- [x] Sync/async derived values with loading, value, and error states
- [x] Delegated event listeners with modifiers
- [x] Reactive effects with cleanup support
- [x] Post-mount lifecycle hook with cleanup support
- [x] Two-way binding for form elements
- [x] Named child island slots with independent SSR and activation
- [x] Async enter/leave transition callbacks
- [x] Builder finalizer returning a renderable Island
- [x] Synchronous HTML string rendering
- [x] Async rendering that awaits all derived values
- [x] DOM mounting with automatic prop/state reading and unmount support
- [x] Async SSR helper with hydration container and state snapshot
- [x] Auto-discovery and mounting of hydration elements on a page
- [x] Single-island mount helper returning an unmount function
- [x] Global named reactive signals shared across all islands, SSR-safe
- [x] XSS-safe HTML template tag with signal, array, and nesting support
- [x] Raw trusted HTML marker to bypass escaping
- [x] Lightweight built-in schema validator for typed props
- [x] Scoped CSS with client and SSR support

## Ilha Router

- [x] Router builder factory with isolated route registry per request
- [x] Route registration with static, param, and wildcard pattern support
- [x] Synchronous HTML string rendering for a given URL
- [x] Async SSR rendering with hydration markers
- [x] Client-side router mounting with history and link interception
- [x] Signal priming from current URL before island hydration
- [x] Single-call hydration convenience combining priming, mounting, and activation
- [x] Programmatic navigation with history stack control
- [x] Reactive current route accessors (path, params, search, hash)
- [x] Active route detection by pattern
- [x] Delegated link interception skipping external, blank-target, and modifier-key clicks
- [x] Router outlet island rendering the active route or an empty fallback
- [x] Declarative link island for navigation
- [x] Page-level layout wrapper composition
- [x] Error boundary wrapper catching SSR and client render failures
- [x] Vite plugin generating a router from the file system
- [x] File-system routing conventions including layouts, error boundaries, and param segments
- [x] Route groups - not affecting pathname
- [x] defineLayout helper
- [x] SPA and SSR loaders

## Ilha Form

- [x] Form binding factory that defers listener setup until explicitly mounted
- [x] Typed submit callback on successful validation
- [x] Structured error callback on failed validation
- [x] Configurable validation timing (on submit, on blur, or on every keystroke)
- [x] Mount method that attaches listeners and returns a cleanup function
- [x] Idempotent unmount that removes all listeners
- [x] Synchronous read of current form values with pass/fail result
- [x] Per-field error map from the last validation run
- [x] Dirty state tracking since last mount
- [x] Programmatic form submission triggering the full validate/submit cycle
- [x] Utility to convert validation issues into a field error map
- [x] defaultValues property to set initial form state
- [x] Programmatic form.setValue API

## Ilha Store

- [x] Reactive global store factory with optional encapsulated actions
- [x] Stable state snapshot access
- [x] Frozen initial state access for implementing resets
- [x] Shallow state merging via plain object or updater function
- [x] Full-state change subscription with unsubscribe
- [x] Slice subscription firing only when selected value changes
- [x] Reactive DOM rendering driven by full store state
- [x] Reactive DOM rendering driven by a selected state slice
- [x] Effect scope re-export for grouped teardown of multiple subscriptions

## Templates

- [x] Vite: SPA
- [x] Hono: Backend API and SPA
- [x] Nitro: Hybrid SSR with client hydration
- [x] Elysia: Backend API and SPA
- [x] Electrobun: Desktop app with SPA
