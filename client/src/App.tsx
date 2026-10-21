import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { queryClient } from "@/lib/session";
import { AppShell } from "@/components/AppShell";
import { RequireOwner } from "@/components/RequireOwner";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EditorPage } from "@/pages/EditorPage";
import { FormsPage } from "@/pages/FormsPage";
import { LoginPage } from "@/pages/LoginPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PublicFormPage } from "@/pages/PublicFormPage";
import { ResponsesPage } from "@/pages/ResponsesPage";

function Owner({ children }: { children: ReactNode }) {
  return (
    <RequireOwner>
      <AppShell>{children}</AppShell>
    </RequireOwner>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Switch>
            <Route path="/login" component={LoginPage} />
            <Route path="/f/:slug" component={PublicFormPage} />
            <Route path="/forms/:id/edit">
              <Owner>
                <EditorPage />
              </Owner>
            </Route>
            <Route path="/forms/:id/responses">
              <Owner>
                <ResponsesPage />
              </Owner>
            </Route>
            <Route path="/">
              <Owner>
                <FormsPage />
              </Owner>
            </Route>
            <Route component={NotFoundPage} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
