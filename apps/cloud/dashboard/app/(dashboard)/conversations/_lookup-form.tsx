"use client";

/**
 * Tiny client form: navigates to `/conversations?id=<input>` on
 * submit. The conversations page is otherwise a Server Component;
 * this island is the only piece that needs hydration.
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
      router.push("/conversations");
      return;
    }
    router.push(`/conversations?id=${encodeURIComponent(trimmed)}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <label className="flex-1" htmlFor="convo-lookup">
        <span className="sr-only">conversation_id</span>
        <Input
          id="convo-lookup"
          type="text"
          name="id"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="convo-..."
          mono
        />
      </label>
      <Button type="submit" size="md">
        Look up
      </Button>
    </form>
  );
}
