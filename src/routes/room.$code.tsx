import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { sounds } from "@/lib/sounds";
import {
  Phone, Video, Send, Copy, ArrowLeft, Lock, Mic, MicOff,
  VideoOff, PhoneOff, Eye, Check, CheckCheck, Loader2, Users
} from "lucide-react";

export const Route = createFileRoute("/room/$code")({
  head: ({ params }) => ({
    meta: [
      { title: `Room ${params.code} · Whisper` },
      { name: "description", content: "Private secure chat room." },
    ],
  }),
  component: Room,
});

type Msg = {
  id: string;
  from: string;
  text: string;
  ts: number;
  mine: boolean;
  revealed?: boolean;
};

type Status = "connecting" | "waiting" | "ready" | "full";

const myId =
  typeof window !== "undefined"
    ? (sessionStorage.getItem("wid") ||
        (() => {
          const id = Math.random().toString(36).slice(2, 10);
          sessionStorage.setItem("wid", id);
          return id;
        })())
    : "ssr";

function Room() {
  const { code } = useParams({ from: "/room/$code" });
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("connecting");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [peerTyping, setPeerTyping] = useState(false);
  const [copied, setCopied] = useState(false);

  // Call state
  const [callMode, setCallMode] = useState<null | "audio" | "video">(null);
  const [callState, setCallState] = useState<"idle" | "ringing" | "incoming" | "active">("idle");
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [incomingOffer, setIncomingOffer] = useState<{ from: string; sdp: RTCSessionDescriptionInit; mode: "audio" | "video" } | null>(null);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Setup channel
  useEffect(() => {
    const channel = supabase.channel(`room:${code}`, {
      config: { presence: { key: myId }, broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const ids = Object.keys(state);
        if (ids.length > 2 && !ids.includes(myId)) {
          setStatus("full");
        } else if (ids.length >= 2) {
          setStatus((prev) => {
            if (prev !== "ready") {
              sounds.join();
              sounds.unlock();
            }
            return "ready";
          });
        } else {
          setStatus("waiting");
        }
      })
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        if (payload.from === myId) return;
        sounds.receive();
        setMessages((m) => [
          ...m,
          { id: payload.id, from: payload.from, text: payload.text, ts: payload.ts, mine: false, revealed: false },
        ]);
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.from === myId) return;
        setPeerTyping(payload.typing);
      })
      .on("broadcast", { event: "signal" }, async ({ payload }) => {
        if (payload.to !== myId) return;
        await handleSignal(payload);
      })
      .on("broadcast", { event: "hangup" }, () => {
        endCall(false);
      })
      .subscribe(async (s) => {
        if (s === "SUBSCRIBED") {
          // Check current presence before tracking
          const state = channel.presenceState();
          const ids = Object.keys(state);
          if (ids.length >= 2 && !ids.includes(myId)) {
            setStatus("full");
            return;
          }
          await channel.track({ id: myId, at: Date.now() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      endCall(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, peerTyping]);

  const peerId = useMemo(() => {
    const state = channelRef.current?.presenceState() || {};
    return Object.keys(state).find((k) => k !== myId) || null;
  }, [status, messages]);

  // ---------- Messaging ----------
  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || status !== "ready") return;
    const msg = { id: Math.random().toString(36).slice(2), from: myId, text, ts: Date.now() };
    channelRef.current?.send({ type: "broadcast", event: "msg", payload: msg });
    setMessages((m) => [...m, { ...msg, mine: true, revealed: true }]);
    setInput("");
    sounds.send();
    channelRef.current?.send({ type: "broadcast", event: "typing", payload: { from: myId, typing: false } });
  };

  const onInputChange = (v: string) => {
    setInput(v);
    channelRef.current?.send({ type: "broadcast", event: "typing", payload: { from: myId, typing: true } });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      channelRef.current?.send({ type: "broadcast", event: "typing", payload: { from: myId, typing: false } });
    }, 1200);
  };

  // ---------- WebRTC ----------
  function createPC(target: string) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        channelRef.current?.send({
          type: "broadcast",
          event: "signal",
          payload: { kind: "ice", from: myId, to: target, candidate: e.candidate.toJSON() },
        });
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = stream;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setCallState("active");
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) endCall(false);
    };
    pcRef.current = pc;
    return pc;
  }

  async function startCall(mode: "audio" | "video") {
    if (!peerId) return;
    setCallMode(mode);
    setCallState("ringing");
    sounds.call();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "video",
      });
      localStreamRef.current = stream;
      if (mode === "video" && localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = createPC(peerId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "offer", from: myId, to: peerId, sdp: offer, mode },
      });
    } catch (err) {
      console.error(err);
      endCall(true);
      alert("Couldn't access mic/camera. Please grant permission.");
    }
  }

  async function answerCall() {
    if (!incomingOffer) return;
    const { from, sdp, mode } = incomingOffer;
    setCallMode(mode);
    setCallState("active");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: mode === "video",
      });
      localStreamRef.current = stream;
      if (mode === "video" && localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = createPC(from);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      channelRef.current?.send({
        type: "broadcast",
        event: "signal",
        payload: { kind: "answer", from: myId, to: from, sdp: answer },
      });
      setIncomingOffer(null);
    } catch (err) {
      console.error(err);
      endCall(true);
    }
  }

  async function handleSignal(p: any) {
    if (p.kind === "offer") {
      setIncomingOffer({ from: p.from, sdp: p.sdp, mode: p.mode });
      setCallState("incoming");
      setCallMode(p.mode);
      sounds.call();
    } else if (p.kind === "answer") {
      await pcRef.current?.setRemoteDescription(p.sdp);
    } else if (p.kind === "ice") {
      try {
        await pcRef.current?.addIceCandidate(p.candidate);
      } catch {}
    }
  }

  function endCall(notify = true) {
    if (notify) channelRef.current?.send({ type: "broadcast", event: "hangup", payload: { from: myId } });
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setCallMode(null);
    setCallState("idle");
    setIncomingOffer(null);
    setMuted(false);
    setCamOff(false);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
  }
  function toggleCam() {
    const next = !camOff;
    setCamOff(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
  }

  // ---------- UI ----------
  if (status === "full") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass rounded-3xl p-8 max-w-sm text-center">
          <Lock className="w-10 h-10 mx-auto text-primary" />
          <h2 className="font-display text-3xl mt-3">Room sealed</h2>
          <p className="text-sm text-muted-foreground mt-2">
            This room already has two members. No one else can join.
          </p>
          <button
            onClick={() => navigate({ to: "/" })}
            className="mt-5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
          >
            Back home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <header className="glass m-3 rounded-2xl px-4 py-3 flex items-center gap-3 sticky top-3 z-10">
        <button onClick={() => navigate({ to: "/" })} className="p-2 -ml-2 rounded-lg hover:bg-black/5">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-lg leading-none">Room</span>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="font-mono text-sm tracking-widest bg-white/70 px-2 py-0.5 rounded-md border border-border flex items-center gap-1.5 hover:bg-white"
            >
              {code}
              {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
            {status === "connecting" && <><Loader2 className="w-3 h-3 animate-spin" /> Connecting…</>}
            {status === "waiting" && <><Users className="w-3 h-3" /> Waiting for the other person…</>}
            {status === "ready" && <><Lock className="w-3 h-3 text-emerald-600" /> Sealed · End-to-end</>}
          </div>
        </div>
        <button
          disabled={status !== "ready" || !!callMode}
          onClick={() => startCall("audio")}
          className="w-10 h-10 rounded-full bg-white/70 border border-border flex items-center justify-center hover:bg-white disabled:opacity-40"
          aria-label="Audio call"
        >
          <Phone className="w-4 h-4 text-primary" />
        </button>
        <button
          disabled={status !== "ready" || !!callMode}
          onClick={() => startCall("video")}
          className="w-10 h-10 rounded-full bg-white/70 border border-border flex items-center justify-center hover:bg-white disabled:opacity-40"
          aria-label="Video call"
        >
          <Video className="w-4 h-4 text-primary" />
        </button>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-2">
        <AnimatePresence>
          {status === "waiting" && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-center py-12"
            >
              <div className="text-center">
                <div className="relative w-20 h-20 mx-auto">
                  <div className="absolute inset-0 rounded-full bg-primary/30 pulse-ring" />
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center">
                    <Users className="w-7 h-7 text-white" />
                  </div>
                </div>
                <p className="mt-5 text-sm text-muted-foreground">Share this code to start chatting</p>
                <div className="mt-2 font-mono text-3xl tracking-[0.4em] font-semibold">{code}</div>
              </div>
            </motion.div>
          )}

          {messages.map((m, i) => (
            <MessageBubble
              key={m.id}
              msg={m}
              onReveal={(rev) =>
                setMessages((arr) => arr.map((x, idx) => (idx === i ? { ...x, revealed: rev } : x)))
              }
            />
          ))}

          {peerTyping && status === "ready" && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="bubble-them rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5 shadow-sm">
                {[0, 1, 2].map((d) => (
                  <motion.span
                    key={d}
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
                    animate={{ y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <form onSubmit={send} className="glass m-3 rounded-2xl p-2 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={status !== "ready"}
          placeholder={status === "ready" ? "Type a secret…" : "Waiting for peer…"}
          className="flex-1 bg-transparent px-3 py-2.5 outline-none text-sm placeholder:text-muted-foreground/70 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!input.trim() || status !== "ready"}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-primary-foreground disabled:opacity-40 transition"
          style={{ background: "linear-gradient(135deg, var(--primary), color-mix(in oklab, var(--primary) 65%, var(--mint)))" }}
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* Audio sink for audio-only calls */}
      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      {/* Call overlay */}
      <AnimatePresence>
        {callMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-gradient-to-br from-slate-900/95 to-slate-800/95 backdrop-blur-xl flex flex-col"
          >
            {callMode === "video" && (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute top-6 right-6 w-32 h-44 object-cover rounded-2xl border-2 border-white/20 shadow-2xl z-10"
                />
              </>
            )}

            <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-white px-6">
              {callMode === "audio" && (
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="relative mb-6"
                >
                  <div className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />
                  <div className="w-32 h-32 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-5xl font-display">
                    {code[0]}
                  </div>
                </motion.div>
              )}
              {callState !== "active" && (
                <>
                  <div className="font-display text-4xl">Room {code}</div>
                  <div className="mt-2 text-white/70 text-sm">
                    {callState === "ringing" && "Calling…"}
                    {callState === "incoming" && `Incoming ${callMode} call`}
                  </div>
                </>
              )}
            </div>

            <div className="relative z-10 pb-10 flex items-center justify-center gap-4">
              {callState === "incoming" ? (
                <>
                  <button
                    onClick={() => endCall(true)}
                    className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                  <button
                    onClick={answerCall}
                    className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-white shadow-xl"
                  >
                    <Phone className="w-6 h-6" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={toggleMute}
                    className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-xl ${muted ? "bg-red-500" : "bg-white/15 backdrop-blur"}`}
                  >
                    {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => endCall(true)}
                    className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-xl"
                  >
                    <PhoneOff className="w-6 h-6" />
                  </button>
                  {callMode === "video" && (
                    <button
                      onClick={toggleCam}
                      className={`w-14 h-14 rounded-full flex items-center justify-center text-white shadow-xl ${camOff ? "bg-red-500" : "bg-white/15 backdrop-blur"}`}
                    >
                      {camOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </button>
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessageBubble({ msg, onReveal }: { msg: Msg; onReveal: (r: boolean) => void }) {
  const time = new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = () => {
    if (msg.mine) return;
    holdRef.current = setTimeout(() => onReveal(true), 80);
  };
  const endHold = () => {
    if (holdRef.current) clearTimeout(holdRef.current);
    if (!msg.mine) onReveal(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={`flex ${msg.mine ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`relative max-w-[78%] px-3.5 py-2 shadow-sm select-none ${
          msg.mine
            ? "bubble-me rounded-2xl rounded-br-sm"
            : "bubble-them rounded-2xl rounded-bl-sm cursor-pointer"
        }`}
        onMouseDown={startHold}
        onMouseUp={endHold}
        onMouseLeave={endHold}
        onTouchStart={startHold}
        onTouchEnd={endHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="relative">
          <p
            className={`text-[15px] leading-snug whitespace-pre-wrap break-words transition-all duration-300 ${
              !msg.mine && !msg.revealed ? "blur-md opacity-60" : "blur-0"
            }`}
          >
            {msg.text}
          </p>
          {!msg.mine && !msg.revealed && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-1.5 bg-white/80 backdrop-blur px-2.5 py-1 rounded-full text-[11px] font-medium text-foreground shadow-sm">
                <Eye className="w-3 h-3" /> Hold to reveal
              </div>
            </div>
          )}
        </div>
        <div className={`flex items-center justify-end gap-1 mt-1 text-[10px] ${msg.mine ? "text-emerald-900/60" : "text-muted-foreground"}`}>
          <span>{time}</span>
          {msg.mine && <CheckCheck className="w-3 h-3" />}
        </div>
      </div>
    </motion.div>
  );
}
