"use client";

import { useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { useApi } from "@/lib/useApi";
import { useDeepLink, useLinkedRow } from "@/lib/deepLink";
import { api, money } from "@/lib/api";
import { usePolling, sinceLabel } from "@/lib/poll";
import { useFeedback } from "@/components/Feedback";
import { Card, Empty, ErrorBox, Loading, Pill, Table } from "@/components/ui";

export default function ApprovalsPage() {
  const { prompt } = useFeedback();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queue = useApi<any[]>("/workflows/queue", [message]);
  // The approvals queue has nothing to open — every row is already expanded —
  // so a link that names an instance scrolls to it and rings it instead.
  const link = useDeepLink("id");
  useLinkedRow(link.id, !!queue.data);
  // A queue is the one shape of screen that is wrong when it is static: a
  // document arriving is exactly what the reader is here for. Half a minute
  // is often enough for a queue and rare enough not to fight a reader who is
  // in the middle of deciding.
  const { lastRefreshedAt } = usePolling(queue.refresh, 30_000, !busy);

  async function act(item: any, action: "APPROVE" | "REJECT" | "RETURN") {
    const verb = action.toLowerCase();
    const answer = await prompt({
      title: `${verb[0].toUpperCase()}${verb.slice(1)} ${item.documentType.replace(/_/g, " ").toLowerCase()}?`,
      body:
        action === "APPROVE"
          ? "Your approval is recorded against your name and moves the document to its next step."
          : "The document goes back to whoever raised it, with what you write here.",
      confirmLabel: `${verb[0].toUpperCase()}${verb.slice(1)}`,
      tone: action === "APPROVE" ? "primary" : "danger",
      fields: [
        {
          name: "comment",
          label: action === "APPROVE" ? "Comment" : `Reason to ${verb}`,
          type: "textarea",
          required: action !== "APPROVE",
        },
      ],
    });
    if (!answer) return;
    const comment = answer.comment || undefined;

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
        action={
          <span className="text-small text-ink-muted">
            Refreshes every 30 seconds &middot; {sinceLabel(lastRefreshedAt)}
          </span>
        }
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
              <tr key={item.instanceId} data-row-id={item.instanceId}>
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
