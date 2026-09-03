'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AuthUser, api } from '@/lib/api';

/**
 * The branch and warehouse the reader is currently working in (§19).
 *
 * This is a *view* preference, not a security boundary. The API scopes every
 * read to the branches a user is assigned to regardless of what is selected
 * here; narrowing the selector narrows what the screen asks for, it does not
 * widen what the server will return. A user with no branch assignment is
 * organization-wide and may pick any branch; one assigned to two sees those two
 * and nothing else, because that is all the server sends.
 */

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  /** A cold room is not where most stock is picked from, so screens skip it. */
  isColdRoom: boolean;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  warehouses: Warehouse[];
}

interface ScopeValue {
  branches: Branch[];
  branchId: string | null;
  warehouseId: string | null;
  setBranch: (id: string | null) => void;
  setWarehouse: (id: string | null) => void;
  branch: Branch | null;
  /**
   * Every warehouse the reader can reach, across their branches.
   *
   * A screen that needs somewhere to pick from wants this, not `branch`: a
   * reader with two branches and no branch selected still has warehouses.
   */
  warehouses: Warehouse[];
  /**
   * Where a screen should default to picking from.
   *
   * The selected warehouse if there is one, otherwise the first general store
   * in the selected branch, otherwise the first anywhere. A cold room is never
   * the default — most stock is not picked from a freezer, and defaulting there
   * shows an empty batch list rather than an error anybody can act on.
   */
  defaultWarehouseId: string | null;
  loading: boolean;
  /** True when the reader may see the whole organization. */
  organizationWide: boolean;
}

const ScopeContext = createContext<ScopeValue | null>(null);
const BRANCH_KEY = 'pharmacore.branch';
const WAREHOUSE_KEY = 'pharmacore.warehouse';

export function useScope(): ScopeValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScope must be used inside ScopeProvider');
  return ctx;
}

export function ScopeProvider({
  user,
  children,
}: {
  user: AuthUser | null;
  children: React.ReactNode;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    /*
     * Read from `/auth/me/scope`, not from `/admin/organization`.
     *
     * The organisation endpoint requires `admin.branch.READ`, which only head
     * office holds — so this used to fail for seven roles out of ten and the
     * selector silently disappeared. That was tolerable while it was only a
     * convenience. It stopped being tolerable once the till, dispensing, counts,
     * adjustments and transfers all read their warehouse from here: knowing
     * where you work is not an administrative privilege.
     */
    api<any>('/auth/me/scope')
      .then((scope) => {
        if (cancelled) return;
        const visible: Branch[] = (scope.branches ?? []).map((b: any) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          isHeadOffice: !!b.isHeadOffice,
          warehouses: (b.warehouses ?? []).map((w: any) => ({
            id: w.id,
            code: w.code,
            name: w.name,
            isColdRoom: !!w.isColdRoom,
          })),
        }));
        setBranches(visible);

        const stored = safeRead(BRANCH_KEY);
        const initial =
          visible.find((b) => b.id === stored) ?? (visible.length === 1 ? visible[0] : null);
        setBranchId(initial?.id ?? null);
        const storedWh = safeRead(WAREHOUSE_KEY);
        if (initial && storedWh && initial.warehouses.some((w) => w.id === storedWh)) {
          setWarehouseId(storedWh);
        }
      })
      .catch(() => {
        // Nothing but a signed-in session is needed now, so a failure here is a
        // real one — a network fault or an expired token — not a permission.
        if (!cancelled) setBranches([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setBranch = useCallback((id: string | null) => {
    setBranchId(id);
    // A warehouse belongs to a branch, so changing branch clears it rather than
    // leaving a warehouse selected that the new branch does not contain.
    setWarehouseId(null);
    safeWrite(BRANCH_KEY, id);
    safeWrite(WAREHOUSE_KEY, null);
  }, []);

  const setWarehouse = useCallback((id: string | null) => {
    setWarehouseId(id);
    safeWrite(WAREHOUSE_KEY, id);
  }, []);

  const branch = useMemo(
    () => branches.find((b) => b.id === branchId) ?? null,
    [branches, branchId],
  );

  const warehouses = useMemo(
    () => (branch ? branch.warehouses : branches.flatMap((b) => b.warehouses)),
    [branch, branches],
  );

  const defaultWarehouseId = useMemo(() => {
    if (warehouseId && warehouses.some((w) => w.id === warehouseId)) return warehouseId;
    return warehouses.find((w) => !w.isColdRoom)?.id ?? warehouses[0]?.id ?? null;
  }, [warehouseId, warehouses]);

  return (
    <ScopeContext.Provider
      value={{
        branches,
        branchId,
        warehouseId,
        setBranch,
        setWarehouse,
        branch,
        warehouses,
        defaultWarehouseId,
        loading,
        organizationWide: !!user && user.branchIds.length === 0,
      }}
    >
      {children}
    </ScopeContext.Provider>
  );
}

function safeRead(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeWrite(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage may be unavailable; the selection still works this session */ }
}

/** Append the current scope to a query string, when the screen wants it. */
export function scopeQuery(scope: { branchId: string | null; warehouseId: string | null }): string {
  const parts: string[] = [];
  if (scope.branchId) parts.push(`branchId=${scope.branchId}`);
  if (scope.warehouseId) parts.push(`warehouseId=${scope.warehouseId}`);
  return parts.join('&');
}
