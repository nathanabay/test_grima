# Design system

## What this interface is for

Pharmacy staff work in long shifts against thousands of rows, often on a tablet
in a warehouse aisle or at a till with a queue. The interface is judged on how
fast a real employee completes a real task, not on how it photographs.

That leads to specific choices:

- **Density over decoration.** Vertical space is inventory rows the storekeeper
  can see without scrolling. Three density modes, compact by default on tables.
- **Status is colour-coded and never colour-only.** Every status carries a word.
  A colour-blind pharmacist must read the same meaning.
- **Numbers are tabular.** Quantities, prices, batch numbers and dates align in a
  column so a mis-keyed figure is visible.
- **No decoration that costs a frame.** Motion is used to explain a transition,
  never to entertain.

Explicitly avoided: purple gradients, glassmorphism, oversized rounded cards,
giant empty hero areas, and the generic "AI dashboard" look.

## Tokens

All tokens are CSS custom properties holding RGB channel triplets, so Tailwind's
opacity modifiers (`bg-surface/60`) still work. Never write a raw hex in a
component.

### Surfaces and text

| Token | Role |
| --- | --- |
| `--background` | The page ground behind everything |
| `--surface` | A raised working area: card, table, panel |
| `--surface-sunken` | A recessed area: table header, inset panel |
| `--surface-raised` | Above the surface: popover, dropdown, command palette |
| `--foreground` | Primary text |
| `--muted` | Secondary text, labels, column headers |
| `--subtle` | Tertiary text, placeholders, disabled |
| `--border` | Hairlines between regions |
| `--border-strong` | Input borders and dividers that must read as edges |

### Intent

| Token | Role |
| --- | --- |
| `--primary` | The brand and the primary action |
| `--primary-fg` | Text on primary |
| `--success` `--warning` `--danger` `--info` | Semantic states |
| each with `-soft` | A tinted background for a badge or banner |

### Pharmaceutical status

These are the ones that make this a pharmacy system rather than a CRM. Each maps
to exactly one meaning, everywhere in the product.

| Token | Meaning | Reading |
| --- | --- | --- |
| `--st-available` | Stock that may be picked | Green |
| `--st-low` | At or below its reorder point | Amber |
| `--st-out` | Nothing on hand | Red |
| `--st-near-expiry` | Inside the warning horizon | Amber |
| `--st-expired` | Past its expiry date | Red, heavier |
| `--st-quarantine` | Held pending a QA decision | Violet |
| `--st-recall` | Subject to an active recall | Red, heaviest |
| `--st-blocked` | Administratively blocked | Slate |
| `--st-cold-chain` | Temperature-controlled | Cyan |
| `--st-controlled` | A controlled medicine | Indigo |
| `--st-in-transit` | Dispatched, not yet received | Blue |
| `--st-pending` | Awaiting a decision | Slate |
| `--st-approved` `--st-rejected` | Decision outcomes | Green / red |

Violet for quarantine and indigo for controlled are deliberately outside the
traffic-light range: quarantined stock is not "bad", it is *undecided*, and a
controlled medicine is not a warning, it is a different legal regime. Using amber
for both would collapse three different meanings into one colour.

### Scale

Spacing steps 4/8/12/16/24/32/48. Radius 4/6/8 with 6 the default — an
enterprise table does not want 16px corners. Elevation is three steps and is used
for layering, not for making cards float.

## Typography

System font stack. Weights 400/500/600 only.

| Role | Size / line | Use |
| --- | --- | --- |
| Display | 30/36 600 | Login, empty product |
| Page title | 20/28 600 | One per page |
| Section | 15/20 600 | Card headers |
| Body | 14/20 400 | Default |
| Body strong | 14/20 500 | Emphasis in body |
| Small | 13/18 400 | Secondary detail |
| Caption | 11/16 500 uppercase | Column headers, labels |
| Data | 14/20 400 tabular | Every number, date and code |

`font-variant-numeric: tabular-nums` on the data role, applied to every quantity,
price, batch number, expiry date and identifier.

## Density

`data-density` on the table root: `comfortable` (44px row), `compact` (36px,
default), `dense` (30px). Chosen per user and remembered, because a
procurement officer scanning 500 lines and a pharmacist reading one prescription
want different things.

## Light and dark

Both are designed, not inverted. Dark mode keeps:

- the same status semantics with adjusted lightness so red still reads as danger
- contrast at or above 4.5:1 for body text and 3:1 for large text and boundaries
- table zebra striping that stays subtle rather than becoming stripes of grey
- charts and focus rings visible against the darker ground

Theme resolution: an explicit choice stamps `data-theme` on the root; with no
choice, `prefers-color-scheme` decides.

## Focus and keyboard

A 2px ring in `--ring` with a 2px offset, on every interactive element, never
removed. Tab order follows reading order. The command palette, global search and
every dialog are reachable and escapable by keyboard alone.

## Motion

120ms for state, 180ms for entrance, 240ms for a drawer. Everything is disabled
under `prefers-reduced-motion`. Operational software must feel instant.

## Component contract

A screen composes primitives; it does not invent them. `StatusBadge`, `DataTable`,
`Drawer`, `ConfirmDialog`, `EmptyState`, `ErrorState`, `Skeleton`, `Timeline`,
`Stat`, `PageHeader`, `Toolbar`, `FilterBar`, `Card`. A new visual pattern goes
into the system first, so it appears the same on every screen that needs it.
