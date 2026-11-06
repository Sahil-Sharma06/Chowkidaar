"use client";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Thin progress bar under the nav while something is in flight: any save/send (mutation),
 * or a query loading for the first time. Background polling of data already on screen
 * does not count, so the bar does not flicker every few seconds.
 */
export function TopLoader() {
  const sending = useIsMutating();
  const loading = useIsFetching({ predicate: (q) => q.state.data === undefined && q.state.status !== "error" });
  const busy = sending + loading > 0;
  return (
    <AnimatePresence>
      {busy && (
        <motion.div key="top-loader" role="progressbar" aria-label="Loading" aria-busy
          className="pointer-events-none fixed inset-x-0 top-16 z-[60] h-0.5 overflow-hidden bg-secondary/15"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.15 } }}>
          <motion.div className="h-full w-1/3 rounded-full bg-secondary"
            animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
