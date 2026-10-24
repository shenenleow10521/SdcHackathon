---
name: Browser authentication constraints
description: Non-obvious Clerk browser-bundle initialization and proxied-cookie security behavior.
---

## Clerk's script distribution

Set `data-clerk-publishable-key` (and a proxy URL when applicable) before appending Clerk's browser script, then use its global client instance.

**Why:** The installed Clerk browser bundle initializes during script evaluation. Loading it without the data attribute throws a missing-key error before application code can construct a client. It exposes an initialized singleton, not the constructor expected from an ESM import.

**How to apply:** Preserve this distinction when changing the plain-JavaScript authentication bootstrap. Verify SDK initialization in a real browser; mocked server sessions do not catch this failure.

## Proxied cookies and write protection

Do not rely on `SameSite=Lax` alone to protect cookie-authenticated API writes.

**Why:** The development preview proxy was observed rewriting the guest cookie from `SameSite=Lax` to `SameSite=None; Secure`. Explicit same-origin checks are needed independently of the cookie attributes.

**How to apply:** Keep browser write requests restricted to the application's origin, while allowing trusted non-browser clients without an Origin header. Verify same-origin and foreign-origin behavior through the proxied development URL after authentication changes.
