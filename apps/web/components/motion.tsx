"use client";
import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useSpring, type Variants } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } };
export const item: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({ children, className, delay = 0, y = 24 }: { children: React.ReactNode; className?: string; delay?: number; y?: number }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y, filter: "blur(6px)" }} whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.75, ease: EASE, delay }}>
      {children}
    </motion.div>
  );
}

/** Container whose direct `motion.*` children (using `item`) animate in one after another. */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: "-60px" }}>
      {children}
    </motion.div>
  );
}

/** Each word rises in on its own. */
export function SplitWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <span className={className} aria-label={text}>
      {text.split(" ").map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-1 align-bottom">
          <motion.span className="inline-block" initial={{ y: "110%", opacity: 0 }} animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, ease: EASE, delay: delay + i * 0.07 }}>
            {w}&nbsp;
          </motion.span>
        </span>
      ))}
    </span>
  );
}

/** Counts from the last shown value to `value` when it scrolls into view or changes. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 1.6, className }:
  { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(prev.current, value, { duration, ease: EASE, onUpdate: (v) => setShown(v), onComplete: () => { prev.current = value; } });
    return () => c.stop();
  }, [inView, value, duration]);
  return <span ref={ref} className={className}>{format(shown)}</span>;
}

/** Card that tilts toward the cursor. */
export function Tilt({ children, className, max = 7 }: { children: React.ReactNode; className?: string; max?: number }) {
  const rx = useSpring(0, { stiffness: 220, damping: 18 });
  const ry = useSpring(0, { stiffness: 220, damping: 18 });
  return (
    <motion.div className={className} style={{ rotateX: rx, rotateY: ry, transformPerspective: 900, transformStyle: "preserve-3d" }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        ry.set(((e.clientX - r.left) / r.width - 0.5) * max * 2);
        rx.set(-((e.clientY - r.top) / r.height - 0.5) * max * 2);
      }}
      onMouseLeave={() => { rx.set(0); ry.set(0); }}>
      {children}
    </motion.div>
  );
}
