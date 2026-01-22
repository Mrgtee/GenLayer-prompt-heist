import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";

function useOutsideClick(ref, onClose) {
  useEffect(() => {
    function onDown(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) onClose();
    }
    function onEsc(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [ref, onClose]);
}

export default function HowToPlayPopover({ open, onClose }) {
  const panelRef = useRef(null);
  useOutsideClick(panelRef, onClose);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="mx-auto max-w-6xl px-4">
            <div className="relative">
              <motion.div
                ref={panelRef}
                className="absolute right-0 top-16 w-full max-w-lg rounded-3xl border border-white/10 bg-black/70 p-4 shadow-noir"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.18 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-white/55 font-mono">HOW TO PLAY</div>
                    <div className="mt-1 text-base font-semibold">Prompt Heist</div>
                    <div className="mt-2 text-sm text-white/75 leading-relaxed">
                      An AI image is the <span className="text-white/90">evidence</span>. Your job is to write the
                      <span className="text-white/90"> hidden prompt</span> that could’ve created it. The
                      <span className="text-white/90"> Intelligent Contract</span> rules first — the crew can appeal via
                      <span className="text-white/90"> Optimistic Democracy</span>.
                    </div>
                  </div>

                  <button
                    onClick={onClose}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-sm hover:bg-white/10"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-4 grid gap-2">
                  <RuleRow step="1" title="Join a room" text="Connect wallet, set a name, join a room code." />
                  <RuleRow step="2" title="Study the evidence" text="Observe style, objects, setting, mood." />
                  <RuleRow step="3" title="Submit your theory" text="Write a coherent prompt (not keyword spam)." />
                  <RuleRow step="4" title="Judge’s ruling" text="IC scores everyone + explains in one sentence." />
                  <RuleRow step="5" title="Appeal (optional)" text="Challenge the ruling; the room votes." />
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3">
                  <div className="text-[11px] text-white/55 font-mono">SCORING TIP</div>
                  <div className="mt-1 text-sm text-white/80">
                    Include <span className="text-white/90">subject + style + setting + mood</span>.
                    Example: “pixel art cat astronaut, neon city, playful vibe”.
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-white/55 font-mono">5–15 min · Rooms · Weekly rotation</span>
                  <button
                    onClick={onClose}
                    className="rounded-2xl border border-white/10 bg-white text-black px-4 py-2 text-sm font-semibold hover:bg-white/90"
                  >
                    Got it
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RuleRow({ step, title, text }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-black/30 p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-xs font-mono text-white/80">
        {step}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-0.5 text-xs text-white/70 leading-relaxed">{text}</div>
      </div>
    </div>
  );
}
