import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, KeyRound, Plus, MessageCircle, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Whisper · Secure Rooms" },
      { name: "description", content: "Anonymous two-person encrypted chat rooms with hold-to-reveal messages and live calls." },
      { property: "og:title", content: "Whisper · Secure Rooms" },
      { property: "og:description", content: "Anonymous two-person chat rooms with hold-to-reveal messages." },
    ],
  }),
  component: Landing,
});

function genCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function Landing() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"home" | "enter">("home");
  const [code, setCode] = useState("");

  const create = () => {
    const c = genCode();
    navigate({ to: "/room/$code", params: { code: c } });
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim().length < 4) return;
    navigate({ to: "/room/$code", params: { code: code.trim().toUpperCase() } });
  };

  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center justify-center px-6">
      {/* Floating orbs */}
      <motion.div
        className="absolute -top-32 -left-20 w-96 h-96 rounded-full"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--lilac) 90%, transparent), transparent 70%)" }}
        animate={{ y: [0, 30, 0], x: [0, 20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-40 -right-20 w-[28rem] h-[28rem] rounded-full"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--mint) 90%, transparent), transparent 70%)" }}
        animate={{ y: [0, -30, 0], x: [0, -20, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full glass text-sm"
      >
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span className="text-muted-foreground">No login. No traces. Just two.</span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="text-6xl md:text-7xl font-display tracking-tight text-center leading-[1.05]"
      >
        Whisper a <span className="shimmer-text italic">secret</span>
        <br />
        worth keeping.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-5 text-center text-muted-foreground max-w-md"
      >
        Create a private two-person room. Messages stay hidden until held.
      </motion.p>

      <div className="mt-10 w-full max-w-md">
        <AnimatePresence mode="wait">
          {mode === "home" ? (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="flex flex-col gap-3"
            >
              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={create}
                className="glass rounded-2xl p-5 flex items-center gap-4 text-left group"
                style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--lilac) 80%, white), color-mix(in oklab, var(--sky) 70%, white))" }}
              >
                <div className="w-12 h-12 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-base">Create Secure Room</div>
                  <div className="text-xs text-muted-foreground">Generate a fresh 6-character code</div>
                </div>
                <Lock className="w-4 h-4 text-muted-foreground group-hover:text-primary transition" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setMode("enter")}
                className="glass rounded-2xl p-5 flex items-center gap-4 text-left group"
                style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--mint) 75%, white), color-mix(in oklab, var(--peach) 65%, white))" }}
              >
                <div className="w-12 h-12 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
                  <KeyRound className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-base">Enter Code</div>
                  <div className="text-xs text-muted-foreground">Join a room someone shared with you</div>
                </div>
                <MessageCircle className="w-4 h-4 text-muted-foreground group-hover:text-primary transition" />
              </motion.button>
            </motion.div>
          ) : (
            <motion.form
              key="enter"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              onSubmit={join}
              className="glass rounded-2xl p-6"
            >
              <label className="text-sm font-medium text-foreground">Room code</label>
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                maxLength={6}
                placeholder="ABC123"
                className="mt-2 w-full text-center text-3xl tracking-[0.5em] font-mono bg-white/60 rounded-xl py-4 outline-none focus:ring-2 focus:ring-ring border border-border"
              />
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("home")}
                  className="flex-1 rounded-xl py-3 text-sm font-medium border border-border bg-white/50 hover:bg-white/80 transition"
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl py-3 text-sm font-medium text-primary-foreground transition"
                  style={{ background: "linear-gradient(135deg, var(--primary), color-mix(in oklab, var(--primary) 70%, var(--mint)))" }}
                >
                  Join Room
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-12 grid grid-cols-3 gap-3 max-w-md w-full text-center"
      >
        {[
          { t: "Hold to reveal", d: "Tap-and-hold" },
          { t: "2 only", d: "Auto-locked" },
          { t: "Voice & video", d: "Built in" },
        ].map((f) => (
          <div key={f.t} className="glass rounded-xl p-3">
            <div className="text-xs font-semibold">{f.t}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{f.d}</div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
