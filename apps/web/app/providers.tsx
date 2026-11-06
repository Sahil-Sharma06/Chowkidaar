"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  // Framer animates in JS, so CSS media queries can't reach it: honour the OS reduced-motion setting here.
  return (
    <QueryClientProvider client={client}>
      <MotionConfig reducedMotion="user" transition={{ type: "spring", duration: 0.3, bounce: 0 }}>{children}</MotionConfig>
    </QueryClientProvider>
  );
}
