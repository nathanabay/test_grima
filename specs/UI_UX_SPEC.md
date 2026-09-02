# UI and UX specification

How the interface is meant to behave, and what it deliberately avoids.

## The intent

This is a working tool for people who are on their feet, often in a hurry,
sometimes holding a box in one hand. Density, legibility and predictability beat
decoration in every case where they conflict.

What the interface deliberately avoids: generic template layouts, the
gradient-heavy "AI dashboard" look, glassmorphism with no purpose, cards nested
inside cards, oversized radii, vast empty space at desktop widths, colours that
carry no meaning, and visual noise that competes with the data.

## Information architecture

Twelve sidebar groups, each a word a pharmacy employee already uses: Overview,
Pharmacy, Inventory, Purchasing, Warehouse, Sales, Quality, Compliance, Finance,
Analytics, Administration. A group disappears entirely when the reader may see
none of its pages, so a cashier is not looking at eight headings with nothing
under them.

Not one flat list of seventy items. A destination that belongs to a screen —
loss analysis, supplier risk, expiry calendar — is a tab or a panel on that
screen, not another sidebar row.

## The shell

- **Global search** and a **command palette** on Ctrl/Cmd+K, which is both a way
  to move around and a way to begin work: "Start a sale", "Receive a delivery".
- **Context selector** for company, branch and warehouse, which hides itself
  when there is only one option. It is a view preference and never a security
  boundary — the server decides what this user may see regardless.
- **Notifications**, **quick actions**, **user menu** carrying theme, density
  and language.
- A **skip-to-content** link as the first tab stop.

## Role-aware dashboards

A pharmacist, a warehouse manager, a procurement officer and an executive open
the same URL and see different panels, because the same dashboard for everyone
is a dashboard tuned for nobody. Persona is derived from the roles the user
actually holds.

## The command centre

Every signal that needs a decision today, ranked by severity and then by value
at risk, across seven sources — stockouts, expiry, cold chain, recalls,
quarantine, approvals, late deliveries. Ranked by severity rather than by
module, because a cold-chain excursion and a critical stockout compete for the
same person's next ten minutes.

Every row states the recommended action and links to the screen where it can be
taken. A list of problems with no way to act on them is a worry generator.

## Tables

One `DataTable`, used by every list screen, so a new screen inherits all of it
rather than reimplementing a subset: sorting, multi-filter, column visibility,
sticky columns and header, pagination with a page-size selector, bulk selection
and actions, saved views, export, print, density, row expansion, row tone.

Row height follows the reader's density preference through the `--row-py` token,
so one setting changes every table in the product.

## Status

One map from status to tone, in `components/status.tsx`. Every screen passes the
raw API value through it. A different visual style per page is how a reader
learns that yellow means one thing here and another thing there.

The status palette carries pharmaceutical meaning: quarantine is violet because
it must not read as a warning to be cleared; controlled is indigo because it is
a legal category rather than a risk level; recall is the strongest red in the
system.

## Accessibility

Verified in a real browser, not asserted. `pnpm test:ui` fails the build on:

- Any text below WCAG AA contrast — 4.5:1, or 3:1 for large text — measured by
  compositing the actual painted layers, including translucent badge washes.
- Any page whose body scrolls sideways at 375, 428, 768, 1280, 1536 or 1920px.
- Any interactive control with no accessible name.
- Any image with no `alt`.
- Any console exception or failed request.

Plus a keyboard pass: the skip link is the first tab stop, 25 consecutive tab
stops all show a focus indicator, Ctrl+K opens the palette and Escape closes it.

The current state is zero failures across 39 pages, six widths and both themes.

## Theme and density

Three theme states — light, dark, and system. An explicit choice stamps
`data-theme`; the absence of the attribute lets `prefers-color-scheme` decide. A
bootstrap script applies the stored choice before first paint, so the page never
flashes the wrong theme.

Dark mode is not an inversion. Surfaces are re-layered, borders are re-weighted,
and each text step is re-measured against its new ground — the light and dark
values for `--muted` and `--subtle` were each chosen by measurement, not by
flipping a number.

Three densities — comfortable, compact, dense — through `--row-h` and `--row-py`.

## Empty, loading and error states

Every screen has all three, and each says something useful. An empty expiry list
explains what would appear there and why it is empty; an error offers a retry.
"No data" tells the reader nothing about whether the system is working.

## Motion

Short and functional: 120ms for state changes, 180ms for entrances, 240ms for
drawers. Everything is disabled under `prefers-reduced-motion`.
