"use client";

import { useEffect, useRef, useState } from "react";

interface InlineEditProps {
  value: string;
  onCommit: (value: string) => void;
  /** Render a textarea instead of a single-line input. */
  multiline?: boolean;
  label: string;
  placeholder?: string;
  className?: string;
}

/**
 * Click (or focus and press Enter) to edit in place.
 *
 * Local draft state means typing never round-trips; the value is committed on
 * blur or Enter, and Escape restores the original. The read view is a real
 * button so the whole list stays keyboard navigable.
 */
export function InlineEdit({ value, onCommit, multiline, label, placeholder, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  // Adjust the draft during render when the value changes underneath us (a
  // regeneration, or a save coming back from the server). React's documented
  // alternative to a syncing effect. An open editor keeps what the user typed.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    if (!editing) setDraft(value);
  }

  useEffect(() => {
    if (editing && fieldRef.current) {
      fieldRef.current.focus();
      const end = fieldRef.current.value.length;
      fieldRef.current.setSelectionRange(end, end);
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    else setDraft(value);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`inline-edit-display ${className ?? ""}`}
        onClick={() => setEditing(true)}
        aria-label={`Edit ${label}`}
      >
        {value || <span className="inline-edit-placeholder">{placeholder ?? `Add ${label}`}</span>}
      </button>
    );
  }

  const shared = {
    ref: fieldRef as never,
    className: `inline-edit-field ${className ?? ""}`,
    value: draft,
    "aria-label": label,
    placeholder,
    onBlur: commit,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
      if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commit();
      }
    },
  };

  return multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />;
}
