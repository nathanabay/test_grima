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

export interface Branch {
  id: string;
  code: string;
  name: string;
  warehouses: { id: string; code: string; name: string }[];
}

interface ScopeValue {
  branches: Branch[];
  branchId: string | null;
  warehouseId: string | null;
  setBranch: (id: string | null) => void;
  setWarehouse: (id: string | null) => void;
  branch: Branch | null;
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
    api<any>('/admin/organization')
      .then((org) => {
        if (cancelled) return;
        const all: Branch[] = (org.branches ?? []).map((b: any) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          warehouses: (b.warehouses ?? []).map((w: any) => ({ id: w.id, code: w.code, name: w.name })),
        }));
        // The server already scopes this, but filtering again costs nothing and
        // makes the selector honest if the endpoint is ever widened.
        const visible = user.branchIds.length
          ? all.filter((b) => user.branchIds.includes(b.id))
          : all;
        setBranches(visible);

        const stored = safeRead(BRANCH_KEY);
        const initial = visible.find((b) => b.id === stored) ?? (visible.length === 1 ? visible[0] : null);
        setBranchId(initial?.id ?? null);
        const storedWh = safeRead(WAREHOUSE_KEY);
        if (initial && storedWh && initial.warehouses.some((w) => w.id === storedWh)) {
          setWarehouseId(storedWh);
        }
      })
      .catch(() => {
        // A reader without admin.branch.READ cannot list branches. That is not
        // an error to shout about: the selector simply does not appear.
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

  return (
    <ScopeContext.Provider
      value={{
        branches,
        branchId,
        warehouseId,
        setBranch,
        setWarehouse,
        branch,
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
