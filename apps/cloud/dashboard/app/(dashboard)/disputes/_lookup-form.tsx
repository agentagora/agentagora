"use client";

/**
 * Tiny client form: navigates to `/disputes?id=<input>` on submit.
 * Mirrors the `_lookup-form` under /conversations — same pattern,
 * different route. The disputes page is otherwise a Server
 * Component; this island is the only piece that needs hydration.
 */

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "../../_components/button";
import { Input } from "../../_components/input";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex-1" htmlFor="dispute-lookup">
        <span className="sr-only">dispute_id</span>
        <Input
          id="dispute-lookup"
          type="text"
          name="id"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="disp_..."
          mono
        />
      </label>
      <Button type="submit" size="md">
        Look up
      </Button>
    </form>
  );
}
