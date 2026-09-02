"use client";

import { useMemo, useState } from "react";
import { Shell, PageHeader } from "@/components/Shell";
import { api } from "@/lib/api";
import { Card, Empty, ErrorBox, Pill, Table } from "@/components/ui";

/**
 * Data import (§60): UPLOAD -> MAP COLUMNS -> VALIDATE -> PREVIEW -> IMPORT.
 *
 * Nothing is sent until validation passes, and the server rejects the whole
 * file if any row is invalid — a partially imported drug master is worse than
 * no import at all. Errors download as a CSV so they can be fixed in the source
 * spreadsheet.
 */

type Step = "upload" | "map" | "preview" | "done";

interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  hint?: string;
  numeric?: boolean;
}

const PRODUCT_FIELDS: FieldSpec[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "genericName", label: "Generic name", required: true },
  { key: "brandName", label: "Brand name" },
  { key: "activeIngredient", label: "Active ingredient", required: true },
  { key: "strength", label: "Strength", required: true, hint: "e.g. 500 mg" },
  {
    key: "dosageForm",
    label: "Dosage form",
    required: true,
    hint: "Tablet, Capsule, Injection...",
  },
  { key: "baseUnit", label: "Base unit", hint: "TABLET, CAPSULE, VIAL..." },
  { key: "gtin", label: "GTIN / barcode" },
  { key: "atcCode", label: "ATC code" },
  { key: "purchaseCost", label: "Purchase cost", numeric: true },
  { key: "retailPrice", label: "Retail price", numeric: true },
  { key: "taxRate", label: "Tax rate", numeric: true, hint: "0.15 for 15%" },
  { key: "reorderLevel", label: "Reorder level", numeric: true },
  { key: "leadTimeDays", label: "Lead time (days)", numeric: true },
];

/** Minimal RFC-4180 CSV parser: handles quotes, escaped quotes and embedded newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export default function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  function loadFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ""));
      if (parsed.length < 2) {
        setError("The file needs a header row and at least one data row.");
        return;
      }
      const head = parsed[0].map((h) => h.trim());
      setHeaders(head);
      setRows(parsed.slice(1));
      setFileName(file.name);

      // Guess the mapping from header names so the common case needs no work.
      const guessed: Record<string, string> = {};
      for (const field of PRODUCT_FIELDS) {
        const match = head.find(
          (h) =>
            h.toLowerCase().replace(/[^a-z]/g, "") ===
              field.key.toLowerCase() ||
            h.toLowerCase() === field.label.toLowerCase(),
        );
        if (match) guessed[field.key] = match;
      }
      setMapping(guessed);
      setStep("map");
    };
    reader.onerror = () => setError("Could not read the file.");
    reader.readAsText(file);
  }

  /** Validate locally so obvious problems are fixed before anything is sent. */
  const validation = useMemo(() => {
    if (step === "upload") return { errors: [], mapped: [] as any[] };
    const errors: Array<{ row: number; field: string; message: string }> = [];
    const mapped: any[] = [];

    rows.forEach((raw, index) => {
      const record: any = {};
      for (const field of PRODUCT_FIELDS) {
        const column = mapping[field.key];
        if (!column) continue;
        const value = raw[headers.indexOf(column)]?.trim() ?? "";

        if (field.required && !value) {
          errors.push({
            row: index + 2,
            field: field.label,
            message: "is required but empty",
          });
          continue;
        }
        if (!value) continue;

        if (field.numeric) {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            errors.push({
              row: index + 2,
              field: field.label,
              message: `"${value}" is not a number`,
            });
            continue;
          }
          if (n < 0) {
            errors.push({
              row: index + 2,
              field: field.label,
              message: "cannot be negative",
            });
            continue;
          }
          record[field.key] = n;
        } else {
          record[field.key] = value;
        }
      }
      mapped.push(record);
    });

    // Duplicate SKUs inside the file itself would silently overwrite each other.
    const seen = new Map<string, number>();
    mapped.forEach((r, i) => {
      if (!r.sku) return;
      if (seen.has(r.sku)) {
        errors.push({
          row: i + 2,
          field: "SKU",
          message: `duplicates row ${seen.get(r.sku)}`,
        });
      } else seen.set(r.sku, i + 2);
    });

    return { errors, mapped };
  }, [rows, mapping, headers, step]);

  const missingRequired = PRODUCT_FIELDS.filter(
    (f) => f.required && !mapping[f.key],
  );

  function downloadErrors() {
    const csv = [
      "Row,Field,Problem",
      ...validation.errors.map((e) => `${e.row},"${e.field}","${e.message}"`),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-errors-${fileName.replace(/\.[^.]+$/, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    const csv = [
      PRODUCT_FIELDS.map((f) => f.label).join(","),
      PRODUCT_FIELDS.map((f) =>
        f.key === "sku"
          ? "SKU-0001"
          : f.key === "genericName"
            ? "Amoxicillin"
            : f.key === "brandName"
              ? "Amoxil"
              : f.key === "activeIngredient"
                ? "Amoxicillin trihydrate"
                : f.key === "strength"
                  ? "500 mg"
                  : f.key === "dosageForm"
                    ? "Capsule"
                    : f.key === "baseUnit"
                      ? "CAPSULE"
                      : f.key === "taxRate"
                        ? "0.15"
                        : f.numeric
                          ? "0"
                          : "",
      ).join(","),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["﻿" + csv], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api("/products/import", {
          method: "POST",
          body: { rows: validation.mapped },
        }),
      );
      setStep("done");
    } catch (e: any) {
      // The server validates again and rejects the whole file on any bad row.
      const serverErrors = e.body?.error?.errors ?? e.body?.errors;
      setError(
        serverErrors
          ? `${e.message}\n${serverErrors
              .slice(0, 10)
              .map((x: any) => `Row ${x.row}: ${x.error}`)
              .join("\n")}`
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Data Import"
        subtitle="Upload, map columns, validate, preview, then import. Nothing is written unless every row passes."
        action={
          <button className="btn-ghost" onClick={downloadTemplate}>
            Download template
          </button>
        }
      />

      <ol className="mb-4 flex flex-wrap gap-1 text-xs">
        {(["upload", "map", "preview", "done"] as Step[]).map((s) => (
          <li
            key={s}
            className={`rounded px-2 py-1 ${step === s ? "bg-brand text-brand-fg" : "bg-surface-sunken text-ink-subtle"}`}
          >
            {s.toUpperCase()}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mb-3">
          <ErrorBox message={error} />
        </div>
      )}

      {step === "upload" && (
        <Card title="Upload a CSV">
          <input
            aria-label="CSV file to import"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) loadFile(f);
            }}
          />
          <p className="mt-2 text-xs text-ink-subtle">
            The first row must be a header. Download the template above for the
            expected columns.
          </p>
        </Card>
      )}

      {step === "map" && (
        <Card title={`Map columns — ${fileName} (${rows.length} rows)`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCT_FIELDS.map((f) => (
              <div key={f.key}>
                <label className="label">
                  {f.label}
                  {f.required && <span className="text-danger"> *</span>}
                </label>
                <select
                  className="input"
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((p) => ({ ...p, [f.key]: e.target.value }))
                  }
                >
                  <option value="">— not mapped —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                {f.hint && (
                  <p className="mt-0.5 text-xs text-ink-subtle">{f.hint}</p>
                )}
              </div>
            ))}
          </div>

          {missingRequired.length > 0 && (
            <p className="mt-3 text-sm text-danger">
              Map these required fields first:{" "}
              {missingRequired.map((f) => f.label).join(", ")}
            </p>
          )}

          <button
            className="btn-primary mt-3"
            disabled={missingRequired.length > 0}
            onClick={() => setStep("preview")}
          >
            Validate and preview
          </button>
        </Card>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <Card
            title={`Validation — ${validation.errors.length} problem(s) in ${rows.length} rows`}
          >
            {validation.errors.length ? (
              <>
                <Table head={["Row", "Field", "Problem"]}>
                  {validation.errors.slice(0, 50).map((e, i) => (
                    <tr key={i}>
                      <td className="td num">{e.row}</td>
                      <td className="td">{e.field}</td>
                      <td className="td text-danger">{e.message}</td>
                    </tr>
                  ))}
                </Table>
                <div className="mt-3 flex gap-2">
                  <button className="btn-ghost" onClick={downloadErrors}>
                    Download error report
                  </button>
                  <button className="btn-ghost" onClick={() => setStep("map")}>
                    Back to mapping
                  </button>
                </div>
                <p className="mt-2 text-xs text-danger">
                  Nothing will be imported while any row is invalid — a partly
                  imported drug master is worse than none.
                </p>
              </>
            ) : (
              <p className="text-sm text-ok">Every row passed validation.</p>
            )}
          </Card>

          <Card title="Preview (first 10 rows)">
            <Table
              head={PRODUCT_FIELDS.filter((f) => mapping[f.key]).map(
                (f) => f.label,
              )}
            >
              {validation.mapped.slice(0, 10).map((r, i) => (
                <tr key={i}>
                  {PRODUCT_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                    <td key={f.key} className={`td ${f.numeric ? "num" : ""}`}>
                      {String(r[f.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
            <button
              className="btn-primary mt-3"
              disabled={busy || validation.errors.length > 0}
              onClick={runImport}
            >
              {busy
                ? "Importing..."
                : `Import ${validation.mapped.length} product(s)`}
            </button>
          </Card>
        </div>
      )}

      {step === "done" && result && (
        <Card title="Import complete">
          <p className="text-sm">
            <Pill tone="ok">{result.imported} product(s) imported</Pill>
          </p>
          <button
            className="btn-ghost mt-3"
            onClick={() => {
              setStep("upload");
              setRows([]);
              setHeaders([]);
              setResult(null);
            }}
          >
            Import another file
          </button>
        </Card>
      )}
    </Shell>
  );
}
