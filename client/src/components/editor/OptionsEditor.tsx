import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const OPTION_LIMIT = 100;

export function optionsFromPaste(text: string): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
    if (next.length >= OPTION_LIMIT) break;
  }
  return next;
}

export function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [pasting, setPasting] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocus = useRef<number | null>(null);

  useEffect(() => {
    if (pendingFocus.current === null) return;
    inputs.current[pendingFocus.current]?.focus();
    pendingFocus.current = null;
  }, [options]);

  function applyPaste(text: string) {
    const next = optionsFromPaste(text);
    if (next.length === 0) return;
    onChange(next);
    setPasting(false);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    const current = next[index];
    const other = next[target];
    if (current === undefined || other === undefined) return;
    next[index] = other;
    next[target] = current;
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Options</p>
      <ul className="space-y-2">
        {options.map((option, index) => {
          const position = index + 1;
          return (
            <li key={index} className="flex items-center gap-2">
              <Input
                ref={(node) => {
                  inputs.current[index] = node;
                }}
                aria-label={`Option ${position}`}
                placeholder={`Option ${position}`}
                value={option}
                maxLength={200}
                onChange={(event) => {
                  const next = [...options];
                  next[index] = event.target.value;
                  onChange(next);
                }}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={`Move option ${position} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Move option ${position} down`}
                disabled={index === options.length - 1}
                onClick={() => move(index, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={`Remove option ${position}`}
                onClick={() => onChange(options.filter((_, item) => item !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={options.length >= OPTION_LIMIT}
          onClick={() => {
            pendingFocus.current = options.length;
            onChange([...options, ""]);
          }}
        >
          <Plus />
          Add option
        </Button>
        <Button variant="outline" onClick={() => setPasting(true)}>
          Paste a list
        </Button>
      </div>
      <Dialog open={pasting} onOpenChange={setPasting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Paste a list</DialogTitle>
            <DialogDescription>One option per line. Blank lines and duplicates are dropped.</DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            aria-label="Option list"
            placeholder={"Red\nBlue\nGreen"}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text") || event.clipboardData.getData("text/plain");
              if (text.trim() === "") return;
              event.preventDefault();
              applyPaste(text);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
