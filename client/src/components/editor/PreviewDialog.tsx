import { PublicFormView } from "@/components/public-form/PublicFormView";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DraftFields } from "@/components/editor/useDraft";

export function PreviewDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: DraftFields;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Preview</DialogTitle>
          <DialogDescription>This is how the form looks with your unsaved edits.</DialogDescription>
        </DialogHeader>
        <PublicFormView
          mode="preview"
          form={{
            title: draft.title,
            description: draft.description,
            schema: draft.schema,
            settings: {
              theme: draft.settings.theme,
              showProgress: draft.settings.showProgress,
              thankYou: draft.settings.thankYou,
            },
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
