"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { api, money } from "@/lib/api";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";

export default function ApprovalsPage() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useApi<any[]>("/workflows/queue", [message]);

  async function act(item: any, action: "APPROVE" | "REJECT" | "RETURN") {
    const comment =
      action === "APPROVE"
        ? (window.prompt("Comment (optional):") ?? undefined)
        : window.prompt(`Reason for ${action.toLowerCase()} (required):`);
    if (action !== "APPROVE" && !comment) return;

    setBusy(true);
    setError(null);
    try {
      const r = await api("/workflows/act", {
        method: "POST",
        body: {
          documentType: item.documentType,
          documentId: item.documentId,
          action,
          comment,
        },
      });
      setMessage(
        `${item.documentType.replace(/_/g, " ")} ${action.toLowerCase()}d — now ${r.status}`,
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="My Approvals"
        subtitle="Documents waiting on a step you are permitted to decide. Anything you already approved is hidden — one person cannot approve two steps of the same document."
      />

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}
      {message && (
        <div className="mb-3 rounded-md border border-ok/30 bg-ok-light px-3 py-2 text-sm text-ok">
          {message}
        </div>
      )}

      <Card title={`${queue.data?.length ?? 0} waiting`}>
        {queue.loading && <Loading />}
        {queue.data?.length ? (
          <Table head={["Document", "Step", "Value", "Waiting", ""]}>
            {queue.data.map((item) => (
              <tr key={item.instanceId}>
                <td className="td">
                  <div className="font-medium">
                    {item.documentType.replace(/_/g, " ")}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {item.documentId.slice(0, 8)}
                  </div>
                </td>
                <td className="td">
                  <Pill tone="info">
                    Step {item.step}: {item.stepName}
                  </Pill>
                </td>
                <td className="td num">
                  {item.amount !== null ? money(item.amount) : "-"}
                </td>
                <td
                  className={`td num ${item.waitingDays > 3 ? "text-warn font-medium" : ""}`}
                >
                  {item.waitingDays}d
                </td>
                <td className="td">
                  <div className="flex gap-1">
                    <button
                      className="btn-primary text-xs"
                      disabled={busy}
                      onClick={() => act(item, "APPROVE")}
                    >
                      Approve
                    </button>
                    <button
                      className="btn-ghost text-xs"
                      disabled={busy}
                      onClick={() => act(item, "RETURN")}
                    >
                      Return
                    </button>
                    <button
                      className="btn-danger text-xs"
                      disabled={busy}
                      onClick={() => act(item, "REJECT")}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          !queue.loading && <Empty>Nothing is waiting on you.</Empty>
        )}
      </Card>
    </Shell>
  );
}
