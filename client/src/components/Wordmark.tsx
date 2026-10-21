import { MessageSquareHeart } from "lucide-react";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <MessageSquareHeart className="size-6 text-primary" aria-hidden="true" />
      Friendform
    </span>
  );
}
