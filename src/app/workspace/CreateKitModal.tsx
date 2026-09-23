"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { Kit } from "@/lib/kit/types";
import type { KitSummary } from "@/lib/store/kits";

export interface CreateInput {
  jd: string;
  company_url: string;
  days: number;
}

interface BatchCase extends CreateInput {
  id?: string;
}

interface Props {
  onClose: () => void;
  onCreated: (record: KitSummary, kit: Kit) => void;
}

interface RunState {
  label: string;
  stage: string;
  percent: number;
}

/**
 * Streams the create request so the user sees which step is running. The server
 * sends newline-delimited JSON: progress lines, then one done/error line.
 */
async function createKit(
  input: CreateInput,
  onProgress: (state: RunState) => void,
  label: string,
): Promise<{ record: KitSummary; kit: Kit; duplicate?: boolean }> {
  const response = await fetch("/api/kits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });

  // A duplicate submission is answered with plain JSON rather than a stream.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("x-ndjson")) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error?.message ?? "Could not generate the kit.");
    return payload as { record: KitSummary; kit: Kit; duplicate?: boolean };
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: { record: KitSummary; kit: Kit } | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event.type === "progress") {
        onProgress({ label, stage: String(event.message), percent: Number(event.percent) });
      } else if (event.type === "error") {
        const error = event.error as { message?: string } | undefined;
        throw new Error(error?.message ?? "Could not generate the kit.");
      } else if (event.type === "done") {
        result = { record: event.record as KitSummary, kit: event.kit as Kit };
      }
    }
  }

  if (!result) throw new Error("Generation ended without returning a kit.");
  return result;
}

function parseBatch(text: string): BatchCase[] {
  const parsed = JSON.parse(text) as unknown;
  const list = Array.isArray(parsed) ? parsed : [];
  return list.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const days = Number(record.days);
    if (typeof record.jd !== "string" || typeof record.company_url !== "string" || !Number.isFinite(days)) return [];
    return [{
      id: typeof record.id === "string" ? record.id : undefined,
      jd: record.jd,
      company_url: record.company_url,
      days,
    }];
  });
}

export function CreateKitModal({ onClose, onCreated }: Props) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState("5");
  const [batch, setBatch] = useState<BatchCase[]>([]);
  const [batchError, setBatchError] = useState("");
  const [running, setRunning] = useState<RunState | null>(null);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);

  const busy = running !== null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCompleted([]);

    const cases: BatchCase[] = batch.length
      ? batch
      : [{ jd, company_url: companyUrl, days: Number(days) }];

    let last: { record: KitSummary; kit: Kit } | null = null;
    const failures: string[] = [];

    for (const [index, entry] of cases.entries()) {
      const label = cases.length > 1 ? `Kit ${index + 1} of ${cases.length}` : "Building your kit";
      setRunning({ label, stage: "Starting", percent: 0 });
      try {
        // Cases run one at a time: a free-tier provider will rate-limit a burst.
        const outcome = await createKit(entry, setRunning, label);
        last = outcome;
        setCompleted((current) => [...current, outcome.record.title]);
      } catch (caught) {
        failures.push(`${entry.id ?? entry.company_url}: ${caught instanceof Error ? caught.message : "failed"}`);
      }
    }

    setRunning(null);

    if (!last) {
      setError(failures.join(" | ") || "Could not generate a kit.");
      return;
    }
    if (failures.length) setError(`${failures.length} case(s) failed: ${failures.join(" | ")}`);
    onCreated(last.record, last.kit);
  }

  function readBatchFile(file: File) {
    setBatchError("");
    void file
      .text()
      .then((text) => {
        const cases = parseBatch(text);
        if (!cases.length) {
          setBatchError("That file contained no usable cases. Each needs jd, company_url and days.");
          setBatch([]);
          return;
        }
        setBatch(cases);
      })
      .catch(() => setBatchError("That file is not valid JSON."));
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create an interview kit">
      <form className="create-kit-modal" onSubmit={onSubmit}>
        <button
          type="button"
          className="close-button"
          onClick={() => !busy && onClose()}
          aria-label="Close"
          disabled={busy}
        >
          &times;
        </button>

        <span className="section-kicker">NEW INTERVIEW KIT</span>
        <h2>Turn a job description into a plan.</h2>
        <p className="modal-description">
          We crawl the company site for what they do and how they hire, search public discussion of their interview
          process, then build the kit from the description.
        </p>

        {busy ? (
          <div className="generation-progress" aria-live="polite">
            <strong>{running.label}</strong>
            <div className="progress-track wide-track">
              <div style={{ width: `${running.percent}%` }} />
            </div>
            <p className="progress-stage">{running.stage}</p>
            {completed.length > 0 && (
              <ul className="completed-list">
                {completed.map((title) => (
                  <li key={title}>&#10003; {title}</li>
                ))}
              </ul>
            )}
            <p className="progress-note">This usually takes 20 to 60 seconds. Leaving this open keeps it running.</p>
          </div>
        ) : (
          <>
            <label>
              Job description
              <textarea
                required={!batch.length}
                minLength={10}
                value={jd}
                onChange={(event) => setJd(event.target.value)}
                placeholder="Paste the full job description here..."
              />
            </label>

            <label>
              Company website
              <input
                required={!batch.length}
                type="url"
                value={companyUrl}
                onChange={(event) => setCompanyUrl(event.target.value)}
                placeholder="https://company.com"
              />
            </label>

            <label>
              Days until the interview
              <input
                required={!batch.length}
                type="number"
                min={1}
                max={60}
                value={days}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>

            <details className="batch-details">
              <summary>Preparing for more than one role?</summary>
              <label>
                Upload a JSON file of cases
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => event.target.files?.[0] && readBatchFile(event.target.files[0])}
                />
              </label>
              <p className="field-hint">
                An array of objects with <code>jd</code>, <code>company_url</code> and <code>days</code>.
              </p>
              {batch.length > 0 && <p className="batch-note">{batch.length} case(s) ready. They run one at a time.</p>}
              {batchError && <p className="error-text">{batchError}</p>}
            </details>

            {error && <p className="error-text">{error}</p>}

            <button className="primary-button generate-button" type="submit">
              {batch.length ? `Generate ${batch.length} kits` : "Generate my kit"}
              <span>&rarr;</span>
            </button>
          </>
        )}
      </form>
    </div>
  );
}
