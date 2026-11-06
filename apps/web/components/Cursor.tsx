"use client";
import { useEffect, useState } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";

/** Dot + lagging ring that follow the pointer; the ring grows over anything clickable. Mouse devices only. */
export function Cursor() {
  const [enabled, setEnabled] = useState(false);
  const [hover, setHover] = useState(false);
  const [down, setDown] = useState(false);
  const [hidden, setHidden] = useState(true);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const dot = { x: useSpring(x, { stiffness: 900, damping: 50 }), y: useSpring(y, { stiffness: 900, damping: 50 }) };
  const ring = { x: useSpring(x, { stiffness: 180, damping: 22 }), y: useSpring(y, { stiffness: 180, damping: 22 }) };

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    setEnabled(true);
    document.documentElement.classList.add("custom-cursor");
    const move = (e: MouseEvent) => {
      x.set(e.clientX); y.set(e.clientY); setHidden(false);
      const t = e.target as Element | null;
      setHover(Boolean(t?.closest("a,button,[role=button],input,select,textarea,label,summary")));
    };
    const downFn = () => setDown(true);
    const upFn = () => setDown(false);
    const leave = () => setHidden(true);
    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mousedown", downFn);
    window.addEventListener("mouseup", upFn);
    document.documentElement.addEventListener("mouseleave", leave);
    return () => {
      document.documentElement.classList.remove("custom-cursor");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", downFn);
      window.removeEventListener("mouseup", upFn);
      document.documentElement.removeEventListener("mouseleave", leave);
    };
  }, [x, y]);

  if (!enabled) return null;
  return (
    <>
      <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[100] h-1.5 w-1.5 rounded-full bg-white mix-blend-difference"
        style={{ x: dot.x, y: dot.y, translateX: "-50%", translateY: "-50%" }} animate={{ opacity: hidden ? 0 : 1, scale: down ? 2 : 1 }} transition={{ duration: 0.15 }} />
      <motion.div aria-hidden className="pointer-events-none fixed left-0 top-0 z-[100] rounded-full border border-white mix-blend-difference"
        style={{ x: ring.x, y: ring.y, translateX: "-50%", translateY: "-50%" }}
        animate={{ width: hover ? 48 : 30, height: hover ? 48 : 30, opacity: hidden ? 0 : hover ? 1 : 0.7, scale: down ? 0.8 : 1, borderWidth: hover ? 2 : 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 22 }} />
    </>
  );
}
