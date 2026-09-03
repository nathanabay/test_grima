"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import {
  Card,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  PageHeader,
  Stat,
} from "@/components/primitives";
import { StatusBadge } from "@/components/status";
import { api, can, money, qty, tokenStore } from "@/lib/api";
import { posQueue, QueuedSale } from "@/lib/posQueue";
import { useScope } from "@/lib/scope";
import { PaymentDialog, Tender } from "@/components/pos/PaymentDialog";
import { ShiftDrawer } from "@/components/pos/ShiftDrawer";
import { CustomerPicker, PosCustomer } from "@/components/pos/CustomerPicker";
import { SaleLookup } from "@/components/pos/SaleLookup";
import { Receipt } from "@/components/pos/Receipt";

/**
 * The till (§22, §46).
 *
 * A till is driven by a scanner and a keyboard, not a mouse: the cashier's eyes
 * are on the customer and the goods. So the search box keeps focus, Enter adds
 * the top result, and the function keys reach payment, hold and the drawer
 * without anybody looking for a button.
 *
 * The cart survives a refresh. A browser that reloads mid-sale used to lose
 * everything the customer had put on the counter.
 */

interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  listPrice: number;
  taxRate: number;
  quantity: number;
  available: number;
  baseUnit: string;
  discountPct: number;
  priceOverrideReason?: string;
  batchId?: string;
  batchLabel?: string;
  overrideReason?: string;
  unitCode?: string;
  packSize?: number;
  isColdChain?: boolean;
  isAgeRestricted?: boolean;
  minimumAgeYears?: number | null;
  maxQuantityPerSale?: number | null;
}

const CART_KEY = "pharmacore.pos.cart";

export default function PosPage() {
  return (
    <Shell>
      <Till />
    </Shell>
  );
}

function Till() {
  const user = typeof window !== "undefined" ? tokenStore.user : null;
  const canDiscount = can(user, "sales.sale.APPROVE");
  const canOverridePrice = can(user, "catalog.price.EDIT");
  const canVoid = can(user, "sales.sale.CANCEL");
  const canOverrideBatch = can(user, "inventory.fefo_override.CREATE");
  const canRunShift = can(user, "sales.cash_session.READ");

  /*
   * The till's branch and warehouse come from the reader's own scope.
   *
   * This used to call `/admin/branches`, which requires `admin.branch.READ` —
   * so a cashier opening the till was told "Missing required permission(s):
   * admin.branch.READ", the warehouse stayed empty, and the product search
   * never fired. The one screen a cashier signs in to use did not work for a
   * cashier.
   */
  const scope = useScope();
  const branches = scope.branches;
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const [term, setTerm] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // A scanner-style multiplier: type 3* then scan, and three go on.
  const [multiplier, setMultiplier] = useState<number | null>(null);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [saleDiscountPct, setSaleDiscountPct] = useState(0);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);

  const [session, setSession] = useState<any | null>(null);
  const [held, setHeld] = useState<any[]>([]);
  const [today, setToday] = useState<any | null>(null);
  const [queue, setQueue] = useState<QueuedSale[]>([]);

  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<any | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Stable for the life of this cart.
   *
   * The old till built the key from Date.now(), so a retry after a network
   * error created a second sale for the same goods. One key per cart means a
   * retry returns the sale that was already made.
   */
  const idempotencyKey = useRef<string>(newKey());

  function newKey() {
    return `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const focusSearch = useCallback(() => {
    setTimeout(() => searchRef.current?.focus(), 30);
  }, []);

  // ---- Sites the cashier can actually reach ----
  useEffect(() => {
    if (branchId || !branches.length) return;
    const first = branches.find((b: any) => b.id === scope.branchId) ?? branches[0];
    setBranchId(first.id);
    setWarehouseId(
      first.warehouses.find((w: any) => !w.isColdRoom)?.id ?? first.warehouses[0]?.id ?? "",
    );
  }, [branches, branchId, scope.branchId]);

  useEffect(() => {
    setQueue(posQueue.list());
  }, []);

  // ---- Shift, held carts and today's takings ----
  useEffect(() => {
    if (!branchId) return;
    // A pharmacist may sell without running a till, so the shift panel is asked
    // for only by somebody who may see one. Firing it regardless leaves a 403
    // in the log and a panel that vanishes without saying why.
    if (canRunShift) {
      api(`/pos/cash-sessions/current?branchId=${branchId}`)
        .then(setSession)
        .catch(() => setSession(null));
    }
    api(`/pos/held?branchId=${branchId}`)
      .then(setHeld)
      .catch(() => setHeld([]));
    api(`/pos/today?branchId=${branchId}`)
      .then(setToday)
      .catch(() => setToday(null));
  }, [branchId, refresh]);

  // ---- The cart survives a refresh ----
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) ?? "null");
      if (saved?.lines?.length) {
        setCart(saved.lines);
        setCustomer(saved.customer ?? null);
        idempotencyKey.current = saved.idempotencyKey ?? newKey();
      }
    } catch {
      // A corrupt saved cart is discarded rather than crashing the till.
    }
  }, []);

  useEffect(() => {
    try {
      if (cart.length) {
        localStorage.setItem(
          CART_KEY,
          JSON.stringify({ lines: cart, customer, idempotencyKey: idempotencyKey.current }),
        );
      } else {
        localStorage.removeItem(CART_KEY);
      }
    } catch {
      // Storage being unavailable must not stop a sale.
    }
  }, [cart, customer]);

  // ---- Search, and barcode resolution ----
  useEffect(() => {
    if (!term.trim() || !warehouseId) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await api<any[]>(
          `/pos/search?q=${encodeURIComponent(term.trim())}&warehouseId=${warehouseId}`,
        );
        setResults(found);
        setHighlight(0);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [term, warehouseId]);

  /**
   * A scanned code goes through the scanner, not the search box.
   *
   * A GS1 DataMatrix carries the batch and expiry as well as the product, and
   * resolving it properly is what lets the till put the scanned batch on the
   * line rather than whatever FEFO would otherwise pick.
   */
  async function resolveScan(raw: string) {
    try {
      const res = await api<any>("/scan", { method: "POST", body: { code: raw } });
      if (!res.product) {
        setError(`Scanned code does not match any product in the drug master.`);
        return false;
      }
      const priced = await api<any[]>(
        `/pos/search?q=${encodeURIComponent(res.product.sku)}&warehouseId=${warehouseId}`,
      );
      const match = priced.find((p) => p.id === res.product.id);
      if (!match) {
        setError(`${res.product.genericName} has no sellable stock in this warehouse.`);
        return false;
      }
      addToCart(match, multiplier ?? 1, res.batch?.id, res.batch?.batchNumber);
      for (const w of res.warnings ?? []) {
        if (/expired|quarantine|recall/i.test(w)) setError(w);
      }
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }

  function addToCart(p: any, count = 1, batchId?: string, batchLabel?: string) {
    setError(null);
    if (p.requiresPrescription || p.isControlled) {
      setError(
        `${p.genericName} is ${p.isControlled ? "a controlled medicine" : "prescription-only"} ` +
          `and must go through dispensing, where the prescription and the register are recorded.`,
      );
      return;
    }
    if (p.available <= 0) {
      setError(`${p.genericName} is out of stock in this warehouse.`);
      return;
    }
    setCart((c) => {
      const existing = c.find((l) => l.productId === p.id);
      if (existing) {
        return c.map((l) =>
          l.productId === p.id
            ? { ...l, quantity: Math.min(l.available, l.quantity + count) }
            : l,
        );
      }
      return [
        ...c,
        {
          productId: p.id,
          name: `${p.genericName} ${p.strength}`.trim(),
          sku: p.sku,
          unitPrice: Number(p.retailPrice),
          listPrice: Number(p.retailPrice),
          taxRate: Number(p.taxRate),
          quantity: count,
          available: p.available,
          baseUnit: p.baseUnit,
          discountPct: 0,
          batchId,
          batchLabel,
          isColdChain: p.isColdChain,
          isAgeRestricted: p.isAgeRestricted,
          minimumAgeYears: p.minimumAgeYears,
          maxQuantityPerSale: p.maxQuantityPerSale ? Number(p.maxQuantityPerSale) : null,
        },
      ];
    });
    setMultiplier(null);
    setTerm("");
    setResults([]);
    focusSearch();
  }

  // ---- Totals ----
  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const lineDiscounts = cart.reduce(
    (s, l) => s + l.unitPrice * l.quantity * l.discountPct,
    0,
  );
  const afterLine = subtotal - lineDiscounts;
  const saleDiscount = afterLine * saleDiscountPct;
  const net = afterLine - saleDiscount;
  const tax = cart.reduce(
    (s, l) => s + l.unitPrice * l.quantity * (1 - l.discountPct) * (1 - saleDiscountPct) * l.taxRate,
    0,
  );
  const total = Number((net + tax).toFixed(2));

  const needsAge = cart.some((l) => l.isAgeRestricted);
  const overLimit = cart.filter(
    (l) => l.maxQuantityPerSale != null && l.quantity > l.maxQuantityPerSale,
  );
  const creditAvailable = customer
    ? Math.max(0, Number(customer.creditLimit ?? 0) - Number(customer.creditBalance ?? 0))
    : null;

  // ---- Keyboard ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2" && cart.length) {
        e.preventDefault();
        setPaying(true);
      } else if (e.key === "F3" && cart.length) {
        e.preventDefault();
        void holdCart();
      } else if (e.key === "F4") {
        e.preventDefault();
        setCustomerOpen(true);
      } else if (e.key === "F8") {
        e.preventDefault();
        setLookupOpen(true);
      } else if (e.key === "Escape" && !paying && !shiftOpen && !customerOpen && !lookupOpen) {
        setTerm("");
        setResults([]);
        focusSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function holdCart() {
    if (!cart.length) return;
    setBusy(true);
    try {
      await api("/pos/hold", {
        method: "POST",
        body: {
          branchId,
          warehouseId,
          cashSessionId: session?.id,
          patientId: customer?.id,
          lines: cart.map(toLineInput),
          payments: [],
        },
      });
      clearCart();
      setHeld(await api<any[]>(`/pos/held?branchId=${branchId}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function toLineInput(l: CartLine) {
    return {
      productId: l.productId,
      quantity: l.quantity,
      unitCode: l.unitCode,
      batchId: l.batchId,
      overrideReason: l.overrideReason,
      discountPct: l.discountPct || undefined,
      priceOverride: l.unitPrice !== l.listPrice ? l.unitPrice : undefined,
      priceOverrideReason: l.priceOverrideReason,
    };
  }

  function clearCart() {
    setCart([]);
    setCustomer(null);
    setSaleDiscountPct(0);
    setAgeConfirmed(false);
    setAcknowledged([]);
    idempotencyKey.current = newKey();
    focusSearch();
  }

  async function takePayment(tenders: Tender[]) {
    setBusy(true);
    setError(null);
    const body = {
      branchId,
      warehouseId,
      cashSessionId: session?.id,
      patientId: customer?.id,
      lines: cart.map(toLineInput),
      payments: tenders,
      saleDiscountPct: saleDiscountPct || undefined,
      ageConfirmed: ageConfirmed || undefined,
      acknowledgedWarnings: acknowledged.length ? acknowledged : undefined,
      idempotencyKey: idempotencyKey.current,
    };
    try {
      const sale = await api<any>("/pos/checkout", { method: "POST", body });
      setReceipt(sale);
      setPaying(false);
      clearCart();
      setRefresh((r) => r + 1);
    } catch (e: any) {
      // A duplicate-sale warning is a question, not a failure: acknowledge it
      // and the same cart goes through.
      if (/already bought/i.test(e.message)) {
        setError(`${e.message} Press "Take payment" again to confirm.`);
        setAcknowledged(cart.map((l) => `DUPLICATE:${l.productId}`));
        setBusy(false);
        return;
      }
      // The server was unreachable rather than unhappy. Hold the sale rather
      // than losing it — and say plainly that it is queued, not done.
      if (/fetch|network|Failed to fetch/i.test(e.message)) {
        setQueue(posQueue.enqueue(idempotencyKey.current, body, e.message));
        setError(
          "The server could not be reached. This sale is QUEUED, not completed — " +
            "the stock has not moved and the customer has not been charged. It will be sent " +
            "when the connection returns.",
        );
        setPaying(false);
        clearCart();
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function flushQueue() {
    setBusy(true);
    for (const queued of posQueue.list()) {
      try {
        await api("/pos/checkout", { method: "POST", body: queued.body });
        setQueue(posQueue.remove(queued.idempotencyKey));
      } catch (e: any) {
        setQueue(posQueue.recordFailure(queued.idempotencyKey, e.message));
      }
    }
    setBusy(false);
    setRefresh((r) => r + 1);
  }

  const branchName = branches.find((b) => b.id === branchId)?.name;

  return (
    <>
      <PageHeader
        title="Point of sale"
        subtitle="FEFO picks the batch. Prescription-only and controlled medicines go through dispensing, where the prescription and the register are recorded."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {branches.length > 1 && (
            <select
              className="input w-auto py-1 text-small"
              aria-label="Branch"
              value={branchId}
              onChange={(e) => {
                const b = branches.find((x: any) => x.id === e.target.value);
                setBranchId(e.target.value);
                setWarehouseId(
                  b?.warehouses.find((w: any) => !w.isColdRoom)?.id ?? b?.warehouses[0]?.id ?? "",
                );
                clearCart();
              }}
            >
              {branches.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            )}
            <button className="btn-ghost btn-sm" onClick={() => setLookupOpen(true)}>
              Find a sale <kbd className="ml-1 text-caption text-ink-subtle">F8</kbd>
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-3">
          <ErrorState message={error} />
        </div>
      )}

      {queue.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-card border border-warn/30 bg-warn-light px-3 py-2 text-small text-warn">
          <span>
            {queue.length} sale(s) are queued and NOT yet recorded. The stock has not moved.
          </span>
          <button className="btn-quiet btn-sm" disabled={busy} onClick={flushQueue}>
            Send them now
          </button>
        </div>
      )}

      {receipt && (
        <Card className="mb-4" title={`Sale ${receipt.saleNo} completed`}>
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="num text-title font-semibold">{money(receipt.grandTotal)}</span>
                {Number(receipt.changeDue ?? 0) > 0 && (
                  <span className="rounded-card bg-ok/10 px-2 py-1 text-body font-semibold text-ok">
                    Change {money(receipt.changeDue)}
                  </span>
                )}
                <span className="text-small text-ink-muted">{receipt.items.length} line(s)</span>
              </div>
              {(receipt.warnings ?? []).map((w: string) => (
                <p key={w} className="text-small text-warn">{w}</p>
              ))}
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" onClick={() => window.print()}>
                  Print receipt
                </button>
                <button className="btn-ghost btn-sm" onClick={() => { setReceipt(null); focusSearch(); }}>
                  Next sale
                </button>
              </div>
            </div>
            <Receipt sale={receipt} branchName={branchName} />
          </div>
        </Card>
      )}

      {/* Shift and takings */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {session ? (
          <Stat
            label={`Shift ${session.sessionNo}`}
            value={money(session.cashSales)}
            sub="Cash taken this shift"
            tone="ok"
            onClick={() => setShiftOpen(true)}
          />
        ) : (
          <Stat
            label="No shift open"
            value="Open one"
            sub="Cash sales will not reconcile to a drawer"
            tone="warn"
            onClick={async () => {
              try {
                const opened = await api("/pos/cash-sessions/open", {
                  method: "POST",
                  body: { branchId, openingCash: 0 },
                });
                setSession(opened);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          />
        )}
        <Stat label="Takings today" value={money(today?.takings ?? 0)} sub={`${today?.salesCount ?? 0} sale(s)`} />
        <Stat label="Average basket" value={money(today?.averageBasket ?? 0)} sub="Today" />
        <Stat
          label="Held carts"
          value={held.length}
          sub={held.length ? "Waiting to be resumed" : "None parked"}
        />
      </div>

      {today?.topSellers?.length > 0 && (
        <Card className="mb-4" title="Top sellers today" padded={false}>
          <ul className="divide-y divide-border">
            {today.topSellers.slice(0, 5).map((t: any) => (
              <li key={t.productId} className="flex justify-between px-4 py-1.5 text-small">
                <span className="text-ink">{t.product}</span>
                <span className="num text-ink-muted">
                  {qty(t.quantity)} · {money(t.value)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {held.length > 0 && (
        <Card className="mb-4" title={`${held.length} held cart(s)`} padded={false}>
          <ul className="divide-y divide-border">
            {held.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="text-small">
                  <span className="text-ink">{h.saleNo}</span>
                  <span className="text-caption text-ink-subtle">
                    {" "}· {h.patient?.fullName ?? "Walk-in"} · {h.items.length} line(s)
                  </span>
                </span>
                <span className="flex gap-1">
                  <button
                    className="btn-quiet btn-sm"
                    onClick={async () => {
                      try {
                        const resumed = await api<any>(`/pos/held/${h.id}/resume`, { method: "POST" });
                        // The resume response carries the parked lines; each is
                        // re-priced against live stock so the cart shows what is
                        // actually sellable now rather than what it was then.
                        const restored: CartLine[] = [];
                        for (const line of resumed.lines) {
                          const matches = await api<any[]>(
                            `/pos/search?q=${encodeURIComponent(line.sku ?? line.productId)}&warehouseId=${warehouseId}`,
                          ).catch(() => []);
                          const p = matches.find((m: any) => m.id === line.productId);
                          restored.push({
                            productId: line.productId,
                            name: p ? `${p.genericName} ${p.strength}`.trim() : (line.productName ?? "Parked line"),
                            sku: p?.sku ?? "",
                            unitPrice: Number(line.unitPrice),
                            listPrice: p ? Number(p.retailPrice) : Number(line.unitPrice),
                            taxRate: p ? Number(p.taxRate) : 0,
                            quantity: Number(line.quantity),
                            available: p?.available ?? Number(line.quantity),
                            baseUnit: p?.baseUnit ?? "",
                            discountPct: 0,
                            isColdChain: p?.isColdChain,
                            isAgeRestricted: p?.isAgeRestricted,
                            maxQuantityPerSale: p?.maxQuantityPerSale ? Number(p.maxQuantityPerSale) : null,
                          });
                        }
                        setCart(restored);
                        setHeld((prev) => prev.filter((x) => x.id !== h.id));
                        focusSearch();
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Resume
                  </button>
                  <button
                    className="btn-quiet btn-sm"
                    onClick={async () => {
                      if (!window.confirm(`Abandon ${h.saleNo}? Its reserved stock is released.`)) return;
                      try {
                        await api(`/pos/held/${h.id}/abandon`, { method: "POST" });
                        setHeld((prev) => prev.filter((x) => x.id !== h.id));
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Abandon
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Scan or search"
          description="Enter adds the highlighted result. Type a number then * to set a quantity before scanning."
        >
          <div className="flex gap-2">
            <input
              ref={searchRef}
              className="input"
              autoFocus
              placeholder="Scan a barcode, or type a name, brand or SKU"
              aria-label="Scan or search for a product"
              value={term}
              onChange={(e) => {
                const v = e.target.value;
                // "3*" sets a quantity for the next thing scanned.
                const m = /^(\d+)\*$/.exec(v);
                if (m) {
                  setMultiplier(Number(m[1]));
                  setTerm("");
                  return;
                }
                setTerm(v);
              }}
              onKeyDown={async (e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, results.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(0, h - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const raw = term.trim();
                  if (!raw) return;
                  // A long numeric or GS1-looking string is a scan, not a query.
                  if (/^[\x1D0-9A-Za-z()\[\]{}\-\.]{8,}$/.test(raw) && !results.length) {
                    if (await resolveScan(raw)) return;
                  }
                  if (results[highlight]) addToCart(results[highlight], multiplier ?? 1);
                }
              }}
            />
            {multiplier && (
              <span className="flex items-center rounded-card bg-brand/10 px-2 text-small font-medium text-brand-dark">
                ×{multiplier}
              </span>
            )}
          </div>

          <div className="mt-3">
            {searching && <Loading label="Searching" />}
            {!searching && term && results.length === 0 && (
              <EmptyState
                title="Nothing matches"
                body="Try the generic name, the brand, or the SKU. A scanned pack resolves through the barcode reader."
              />
            )}
            {results.length > 0 && (
              <ul className="divide-y divide-border rounded-card border border-border">
                {results.map((p, i) => {
                  const blocked = p.requiresPrescription || p.isControlled;
                  return (
                    <li key={p.id}>
                      <button
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left
                          ${i === highlight ? "bg-brand/5" : "hover:bg-surface-sunken"}
                          ${blocked ? "opacity-60" : ""}`}
                        disabled={blocked || p.available <= 0}
                        onClick={() => addToCart(p, multiplier ?? 1)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-small text-ink">
                            {p.genericName} {p.strength}
                          </span>
                          <span className="block text-caption text-ink-subtle">
                            {p.brandName ? `${p.brandName} · ` : ""}{p.sku}
                            {p.isColdChain && " · cold chain"}
                            {p.isAgeRestricted && ` · age ${p.minimumAgeYears ?? 18}+`}
                            {p.maxQuantityPerSale && ` · max ${Number(p.maxQuantityPerSale)} per sale`}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {blocked && (
                            <StatusBadge status={p.isControlled ? "CONTROLLED" : "PENDING"} />
                          )}
                          <span className="num text-small">{money(p.retailPrice)}</span>
                          <span className={`num text-caption ${p.available <= 0 ? "text-danger" : "text-ink-muted"}`}>
                            {qty(p.available)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card
          title={`Cart (${cart.length})`}
          action={
            <button className="btn-quiet btn-sm" onClick={() => setCustomerOpen(true)}>
              {customer ? customer.fullName : "Attach customer"}{" "}
              <kbd className="text-caption text-ink-subtle">F4</kbd>
            </button>
          }
        >
          {!cart.length ? (
            <EmptyState
              title="Nothing on the counter yet"
              body="Scan a pack or search for a product to start a sale. F2 takes payment, F3 holds the cart, F4 attaches a customer."
            />
          ) : (
            <>
              {customer && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface-sunken px-3 py-2 text-small">
                  <span>
                    <span className="text-ink">{customer.fullName}</span>
                    <span className="text-caption text-ink-subtle"> · {customer.patientCode}</span>
                  </span>
                  <span className="text-caption text-ink-muted">
                    {creditAvailable !== null && creditAvailable > 0
                      ? `${money(creditAvailable)} credit available`
                      : "No credit agreed"}
                    <button className="btn-quiet btn-sm ml-2" onClick={() => setCustomer(null)}>
                      Remove
                    </button>
                  </span>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-small">
                  <thead>
                    <tr>
                      <th className="th">Product</th>
                      <th className="th text-right">Qty</th>
                      <th className="th text-right">Unit</th>
                      {canDiscount && <th className="th text-right">Disc %</th>}
                      <th className="th text-right">Line</th>
                      <th className="th"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((l) => {
                      const over =
                        l.maxQuantityPerSale != null && l.quantity > l.maxQuantityPerSale;
                      return (
                        <tr key={l.productId} className={over ? "bg-danger/5" : ""}>
                          <td className="td">
                            <div className="text-ink">{l.name}</div>
                            <div className="text-caption text-ink-subtle">
                              {l.batchLabel && `batch ${l.batchLabel} · `}
                              {l.isColdChain && "cold chain · "}
                              {l.unitPrice !== l.listPrice && (
                                <span className="text-warn">
                                  price overridden from {money(l.listPrice)} ·{" "}
                                </span>
                              )}
                              {over && (
                                <span className="text-danger">
                                  over the {l.maxQuantityPerSale} limit for one sale
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="td text-right">
                            <input
                              className="input num w-16 text-right"
                              type="number"
                              min={1}
                              max={l.available}
                              aria-label={`Quantity of ${l.name}`}
                              value={l.quantity}
                              onChange={(e) =>
                                setCart((c) =>
                                  c.map((x) =>
                                    x.productId === l.productId
                                      ? {
                                          ...x,
                                          quantity: Math.max(
                                            1,
                                            Math.min(l.available, Number(e.target.value) || 1),
                                          ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="td num text-right">
                            {canOverridePrice ? (
                              <input
                                className="input num w-24 text-right"
                                type="number"
                                step="0.01"
                                min="0"
                                aria-label={`Unit price of ${l.name}`}
                                value={l.unitPrice}
                                onChange={(e) => {
                                  const value = Number(e.target.value);
                                  setCart((c) =>
                                    c.map((x) =>
                                      x.productId === l.productId
                                        ? {
                                            ...x,
                                            unitPrice: value,
                                            priceOverrideReason:
                                              value !== x.listPrice
                                                ? x.priceOverrideReason || "Agreed at the counter"
                                                : undefined,
                                          }
                                        : x,
                                    ),
                                  );
                                }}
                              />
                            ) : (
                              money(l.unitPrice)
                            )}
                          </td>
                          {canDiscount && (
                            <td className="td text-right">
                              <input
                                className="input num w-16 text-right"
                                type="number"
                                min="0"
                                max="100"
                                aria-label={`Discount on ${l.name}`}
                                value={Math.round(l.discountPct * 100)}
                                onChange={(e) =>
                                  setCart((c) =>
                                    c.map((x) =>
                                      x.productId === l.productId
                                        ? {
                                            ...x,
                                            discountPct: Math.min(
                                              1,
                                              Math.max(0, Number(e.target.value) / 100),
                                            ),
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </td>
                          )}
                          <td className="td num text-right">
                            {money(l.unitPrice * l.quantity * (1 - l.discountPct))}
                          </td>
                          <td className="td">
                            <button
                              className="btn-quiet btn-sm"
                              aria-label={`Remove ${l.name}`}
                              onClick={() =>
                                setCart((c) => c.filter((x) => x.productId !== l.productId))
                              }
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {needsAge && (
                <label className="mt-3 flex items-start gap-2 rounded-card border border-warn/30 bg-warn-light px-3 py-2 text-small text-warn">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={ageConfirmed}
                    onChange={(e) => setAgeConfirmed(e.target.checked)}
                  />
                  <span>
                    This sale contains an age-restricted product. Confirm you have checked the
                    buyer is at least{" "}
                    {cart.find((l) => l.isAgeRestricted)?.minimumAgeYears ?? 18}.
                  </span>
                </label>
              )}

              {overLimit.length > 0 && (
                <p className="mt-2 text-small text-danger">
                  {overLimit.map((l) => l.name).join(", ")} exceed(s) the quantity a single sale may
                  supply. The server will refuse this until the quantity comes down.
                </p>
              )}

              {canDiscount && (
                <div className="mt-3">
                  <Field label="Discount on the whole sale (%)">
                    <input
                      className="input num w-24"
                      type="number"
                      min="0"
                      max="100"
                      value={Math.round(saleDiscountPct * 100)}
                      onChange={(e) =>
                        setSaleDiscountPct(Math.min(1, Math.max(0, Number(e.target.value) / 100)))
                      }
                    />
                  </Field>
                </div>
              )}

              <dl className="mt-4 space-y-1 text-small">
                <Row label="Subtotal" value={money(subtotal)} />
                {lineDiscounts > 0 && <Row label="Line discounts" value={`-${money(lineDiscounts)}`} />}
                {saleDiscount > 0 && <Row label="Sale discount" value={`-${money(saleDiscount)}`} />}
                <Row label="Tax" value={money(tax)} />
                <div className="flex justify-between border-t border-border pt-1 text-section font-semibold">
                  <dt>Total</dt>
                  <dd className="num">{money(total)}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  className="btn-primary flex-1"
                  disabled={busy || (needsAge && !ageConfirmed) || overLimit.length > 0}
                  onClick={() => setPaying(true)}
                >
                  Take payment {money(total)} <kbd className="ml-1 text-caption opacity-70">F2</kbd>
                </button>
                <button className="btn-ghost" disabled={busy} onClick={holdCart}>
                  Hold <kbd className="text-caption text-ink-subtle">F3</kbd>
                </button>
                <button className="btn-quiet" onClick={clearCart}>
                  Clear
                </button>
              </div>
            </>
          )}
        </Card>
      </div>

      <PaymentDialog
        open={paying}
        total={total}
        customerName={customer?.fullName ?? null}
        creditAvailable={creditAvailable}
        busy={busy}
        error={error}
        onClose={() => setPaying(false)}
        onConfirm={takePayment}
      />

      <ShiftDrawer
        open={shiftOpen}
        session={session}
        onClose={() => setShiftOpen(false)}
        onChanged={() => setRefresh((r) => r + 1)}
      />

      <CustomerPicker
        open={customerOpen}
        onClose={() => { setCustomerOpen(false); focusSearch(); }}
        onSelect={setCustomer}
      />

      <SaleLookup
        open={lookupOpen}
        branchId={branchId}
        branchName={branchName}
        canVoid={canVoid}
        canRefund={canVoid}
        onClose={() => { setLookupOpen(false); focusSearch(); }}
        onChanged={() => setRefresh((r) => r + 1)}
      />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}
