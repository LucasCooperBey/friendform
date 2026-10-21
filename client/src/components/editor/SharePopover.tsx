import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";
import { shareUrl } from "@/lib/format";
import type { FormDetail } from "@/components/editor/useDraft";

export function SharePopover({
  form,
  publicUrl,
  open,
  onOpenChange,
}: {
  form: FormDetail;
  publicUrl: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const published = form.publishedVersion !== null;
  const url = shareUrl(form.slug, publicUrl);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "The link could not be copied." });
    }
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline">Share</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {published ? (
          <div className="space-y-3">
            <p className="break-all text-sm">{url}</p>
            <div className="flex gap-2">
              <Button onClick={() => void copy()}>Copy</Button>
              <Button variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener">
                  Open
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm">Publish to get a link</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
