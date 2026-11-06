"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { EASE } from "@/components/motion";

/** First-visit curtain: the mark draws in, a bar fills, the page is revealed. Shown once per browser session. */
export function Preloader() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("chowkidaar:seen") === "1"; sessionStorage.setItem("chowkidaar:seen", "1"); } catch { /* storage blocked */ }
    if (seen) { setShow(false); return; }
    const t = setTimeout(() => setShow(false), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div key="curtain" className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-surface"
          exit={{ opacity: 0, scale: 1.03, filter: "blur(8px)" }} transition={{ duration: 0.55, ease: EASE }}>
          <motion.div initial={{ scale: 0.6, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 220, damping: 16 }}
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-lg">
            <ShieldCheck className="h-8 w-8" />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5, ease: EASE }} className="mt-4 font-display text-xl font-semibold tracking-tight">Chowkidaar</motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Guarding the call</motion.div>
          <div className="mt-6 h-[3px] w-40 overflow-hidden rounded-full bg-surface-container-high">
            <motion.div className="h-full w-full origin-left rounded-full bg-secondary" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1.1, ease: EASE, delay: 0.2 }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
