"use client";

/**
 * Tiny client form: navigates to `/disputes?id=<input>` on submit.
 * Mirrors the `_lookup-form` under /conversations — same pattern,
 * different route. The disputes page is otherwise a Server
 * Component; this island is the only piece that needs hydration.
 */

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

export function LookupForm({ initialId }: { initialId?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialId ?? "");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      router.push("/disputes");
      return;
    }
    router.push(`/disputes?id=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 24,
      }}
    >
      <input
        type="text"
        name="id"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="disp_..."
        style={{
          flex: 1,
          padding: "8px 12px",
          border: "1px solid #d0d0d0",
          borderRadius: 6,
          fontSize: 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
      <button
        type="submit"
        style={{
          padding: "8px 16px",
          background: "#0366d6",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Look up
      </button>
    </form>
  );
}
