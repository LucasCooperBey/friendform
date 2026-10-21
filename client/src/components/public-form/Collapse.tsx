import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      inert={open ? undefined : true}
      aria-hidden={open ? undefined : true}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
