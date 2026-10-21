import { Plus } from "lucide-react";
import type { Question } from "@shared/form-schema";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { QUESTION_TYPE_LIST, createQuestion } from "@/components/editor/question-types";

export function AddQuestionMenu({ taken, onAdd }: { taken: Iterable<string>; onAdd: (question: Question) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Plus />
          Add question
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {QUESTION_TYPE_LIST.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.type} onSelect={() => onAdd(createQuestion(item.type, taken))}>
              <Icon />
              {item.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
