"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";
import { useState, type ReactNode } from "react";
import { AppearanceProvider } from "./appearance";
function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      gap={8}
      toastOptions={{ className: "toast" }}
    />
  );
}
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 10000 },
        },
      }),
  );
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AppearanceProvider>
        <QueryClientProvider client={client}>
          {children}
          <ThemedToaster />
        </QueryClientProvider>
      </AppearanceProvider>
    </ThemeProvider>
  );
}
