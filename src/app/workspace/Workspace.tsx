"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Kit } from "@/lib/kit/types";
import type { KitSummary } from "@/lib/store/kits";
import type { PublicUser } from "@/lib/auth";
import { CreateKitModal } from "./CreateKitModal";
import { KitView } from "./KitView";

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

export function Workspace({ user, initialKits }: { user: PublicUser; initialKits: KitSummary[] }) {
  const router = useRouter();
  const [kits, setKits] = useState(initialKits);
  const [selectedId, setSelectedId] = useState<string | null>(initialKits[0]?.id ?? null);
  const [loadedKit, setLoadedKit] = useState<Kit | null>(null);
  const [loading, setLoading] = useState(Boolean(initialKits.length));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // The open kit's pending autosave, so navigating away can flush it first.
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  // Loading the selected kit is a real synchronisation with an external system.
  // A stale response is discarded so switching kits quickly cannot leave the
  // wrong one open.
  useEffect(() => {
    // Callers that clear the selection also clear the loaded kit, so there is
    // nothing to reset here.
    if (!selectedId) return;

    let active = true;
    const controller = new AbortController();

    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/kits/${selectedId}`, { signal: controller.signal });
        if (response.status === 401) {
          router.push("/login");
          return;
        }
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error?.message ?? "Could not open that kit.");
        if (active) setLoadedKit(payload.kit as Kit);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "Could not open that kit.");
        setLoadedKit(null);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [selectedId, router]);

  async function selectKit(id: string) {
    if (id === selectedId) return;
    await flushRef.current?.();
    setLoadedKit(null);
    setSelectedId(id);
  }

  async function logout() {
    await flushRef.current?.();
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function deleteKit(id: string) {
    const response = await fetch(`/api/kits/${id}`, { method: "DELETE" });
    if (!response.ok) return;
    const remaining = kits.filter((entry) => entry.id !== id);
    setKits(remaining);
    if (selectedId === id) {
      setLoadedKit(null);
      setSelectedId(remaining[0]?.id ?? null);
    }
  }

  const showKit = Boolean(selectedId && loadedKit && !loading);

  return (
    <main className="workspace-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <span>&#9678;</span> prepwise
        </div>

        <div className="sidebar-label">YOUR KITS</div>
        <nav aria-label="Your kits" className="kit-nav">
          {kits.map((entry) => (
            <div className="kit-link-row" key={entry.id}>
              <button
                type="button"
                className={`kit-link ${entry.id === selectedId ? "active" : ""}`}
                onClick={() => void selectKit(entry.id)}
                aria-current={entry.id === selectedId}
              >
                <span className={`status-dot ${entry.uncoveredCount ? "" : "muted"}`} />
                <span className="kit-link-text">{entry.title}</span>
                <small>{entry.days}d</small>
              </button>
              <button
                type="button"
                className="delete-button"
                aria-label={`Delete ${entry.title}`}
                onClick={() => void deleteKit(entry.id)}
              >
                &times;
              </button>
            </div>
          ))}
          <button type="button" className="kit-link" onClick={() => setCreating(true)}>
            <span className="status-dot muted" /> <span className="kit-link-text">Add a new kit</span> <b>+</b>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="profile">
            <div className="avatar">{initials(user.name)}</div>
            <div>
              <strong>{user.name}</strong>
              <span>{user.email}</span>
            </div>
            <button type="button" className="logout-button" onClick={() => void logout()}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <section className="main-column">
        {showKit ? (
          <KitView
            key={selectedId}
            kitId={selectedId!}
            initialKit={loadedKit!}
            onBeforeLeave={(flush) => {
              flushRef.current = flush;
            }}
          />
        ) : (
          <>
            <header className="topbar">
              <div>
                <span className="eyebrow">INTERVIEW KIT</span>
                <h1>{loading ? "Opening your kit" : "No kit open"}</h1>
              </div>
            </header>
            <div className="content-wrap">
              {loading ? (
                <KitSkeleton />
              ) : (
                <EmptyState hasKits={kits.length > 0} error={loadError} onCreate={() => setCreating(true)} />
              )}
            </div>
          </>
        )}
      </section>

      {creating && (
        <CreateKitModal
          onClose={() => setCreating(false)}
          onCreated={(record, newKit) => {
            setKits((current) => [record, ...current.filter((entry) => entry.id !== record.id)]);
            setLoadedKit(newKit);
            setSelectedId(record.id);
            setLoading(false);
            setCreating(false);
          }}
        />
      )}
    </main>
  );
}

function EmptyState({
  hasKits,
  error,
  onCreate,
}: {
  hasKits: boolean;
  error: string | null;
  onCreate: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="section-kicker">{error ? "SOMETHING WENT WRONG" : "NOTHING HERE YET"}</span>
      <h2>{error ? "That kit could not be opened." : "Your first kit starts with a job description."}</h2>
      <p>
        {error ??
          (hasKits
            ? "Pick a kit from the sidebar, or build another one."
            : "Paste the description, give us the company's website, and tell us how many days you have. We do the research.")}
      </p>
      <button type="button" className="primary-button" onClick={onCreate}>
        Create a kit <span>&rarr;</span>
      </button>
    </div>
  );
}

function KitSkeleton() {
  return (
    <div className="skeleton-grid" aria-busy="true" aria-label="Loading kit">
      <div className="skeleton skeleton-panel" />
      <div className="skeleton skeleton-panel short" />
      <div className="skeleton skeleton-panel" />
      <div className="skeleton skeleton-panel short" />
    </div>
  );
}
