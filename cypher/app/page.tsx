"use client";

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/immutability */

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

if (!socketUrl) {
  throw new Error("NEXT_PUBLIC_SOCKET_URL is not defined");
}

const socket = io(socketUrl);

type BeatSource = "youtube" | "soundcloud";
type Beat = {
  url: string;
  source: BeatSource;
  videoId?: string;
};

declare global {
  interface Window {
    YT: any;
    SC: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export default function Home() {
  const ytPlayerRef = useRef<any>(null);
  const ytScriptLoadedRef = useRef(false);
  const ytReadyRef = useRef(false);

  const scWidgetRef = useRef<any>(null);
  const scIframeRef = useRef<HTMLIFrameElement | null>(null);
  const scScriptLoadedRef = useRef(false);
  const scReadyRef = useRef(false);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const currentSessionIdRef = useRef<number | null>(null);
  const currentBeatRef = useRef<Beat | null>(null);

  const [tempName, setTempName] = useState("");
  const [registered, setRegistered] = useState(false);

  const [queue, setQueue] = useState<Beat[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [currentBeat, setCurrentBeat] = useState<Beat | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  useEffect(() => {
    if (!registered) return;

    ensureYouTubePlayer();
    ensureSoundCloudWidget();

    socket.on("room_state", (room: any) => {
      setQueue(room.queue || []);
      setCurrentBeat(room.currentBeat || null);
      currentBeatRef.current = room.currentBeat || null;
    });

    socket.on("presence_update", (userList: any[]) => {
      setUsers(userList);
    });

    socket.on("beat_start", ({ beat, startedAt, sessionId }: any) => {
      currentSessionIdRef.current = sessionId;
      setCurrentBeat(beat);
      currentBeatRef.current = beat;
      void playBeat(beat, startedAt);
    });

    socket.on("sync", ({ startedAt, source }: any) => {
      if (!startedAt || !source) return;
      void syncPlayback(source, startedAt);
    });

    socket.on("voice_existing", (participantIds: string[]) => {
      if (!localStreamRef.current) return;
      for (const id of participantIds) {
        if (id === socket.id) continue;
        void createOfferTo(id);
      }
    });

    socket.on("voice_user_joined", (participantId: string) => {
      if (!localStreamRef.current) return;
      if (participantId === socket.id) return;
      void createOfferTo(participantId);
    });

    socket.on("voice_user_left", (participantId: string) => {
      removePeer(participantId);
    });

    socket.on("voice_offer", async ({ fromId, offer }) => {
      if (!localStreamRef.current) return;
      const pc = await getOrCreatePeerConnection(fromId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("voice_answer", { targetId: fromId, answer });
    });

    socket.on("voice_answer", async ({ fromId, answer }) => {
      const pc = peerConnectionsRef.current.get(fromId);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("voice_ice_candidate", async ({ fromId, candidate }) => {
      const pc = peerConnectionsRef.current.get(fromId);
      if (!pc || !candidate) return;
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    const syncInterval = setInterval(() => {
      socket.emit("request_sync");
    }, 5000);

    return () => {
      clearInterval(syncInterval);
      socket.off("room_state");
      socket.off("presence_update");
      socket.off("beat_start");
      socket.off("sync");
      socket.off("voice_existing");
      socket.off("voice_user_joined");
      socket.off("voice_user_left");
      socket.off("voice_offer");
      socket.off("voice_answer");
      socket.off("voice_ice_candidate");
    };
  }, [registered]);

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      closeAllPeers();
      socket.emit("leave_voice");
    };
  }, []);

  function registerUser() {
    if (!tempName.trim()) return;
    socket.emit("register_user", tempName.trim());
    setRegistered(true);
  }

  function ensureYouTubePlayer() {
    if (ytScriptLoadedRef.current) return;
    ytScriptLoadedRef.current = true;

    if (window.YT?.Player) {
      createYouTubePlayer();
      return;
    }

    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => createYouTubePlayer();
  }

  function createYouTubePlayer() {
    if (ytPlayerRef.current || !window.YT?.Player) return;

    ytPlayerRef.current = new window.YT.Player("yt-player", {
      height: "380",
      width: "100%",
      playerVars: {
        controls: 0,
        disablekb: 1,
        modestbranding: 1,
        rel: 0,
        fs: 0,
      },
      events: {
        onReady: () => {
          ytReadyRef.current = true;
        },
        onStateChange: (event: any) => {
          if (event.data === window.YT.PlayerState.ENDED && currentSessionIdRef.current !== null) {
            socket.emit("beat_ended", { sessionId: currentSessionIdRef.current });
          }
        },
      },
    });
  }

  function ensureSoundCloudWidget() {
    if (scScriptLoadedRef.current) return;
    scScriptLoadedRef.current = true;

    const tag = document.createElement("script");
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = () => {
      if (!scIframeRef.current || !window.SC?.Widget) return;
      scWidgetRef.current = window.SC.Widget(scIframeRef.current);
      scWidgetRef.current.bind(window.SC.Widget.Events.READY, () => {
        scReadyRef.current = true;
      });
      scWidgetRef.current.bind(window.SC.Widget.Events.FINISH, () => {
        if (currentSessionIdRef.current !== null) {
          socket.emit("beat_ended", { sessionId: currentSessionIdRef.current });
        }
      });
    };
    document.body.appendChild(tag);
  }

  async function playBeat(beat: Beat, startedAt: number) {
    const offset = Math.max(0, (Date.now() - startedAt) / 1000);

    if (beat.source === "youtube") {
      if (!ytReadyRef.current || !ytPlayerRef.current || !beat.videoId) return;

      scWidgetRef.current?.pause?.();
      ytPlayerRef.current.loadVideoById(beat.videoId, offset);
      return;
    }

    if (!scWidgetRef.current) return;

    ytPlayerRef.current?.pauseVideo?.();
    scReadyRef.current = false;

    scWidgetRef.current.load(beat.url, {
      auto_play: true,
      show_comments: false,
      show_playcount: false,
      buying: false,
      sharing: false,
      download: false,
    });

    const seekWhenReady = () => {
      if (!scReadyRef.current) {
        setTimeout(seekWhenReady, 120);
        return;
      }

      scWidgetRef.current.seekTo(offset * 1000);
      scWidgetRef.current.play();
    };

    seekWhenReady();
  }

  async function syncPlayback(source: BeatSource, startedAt: number) {
    const correctTime = Math.max(0, (Date.now() - startedAt) / 1000);

    if (source === "youtube") {
      const player = ytPlayerRef.current;
      if (!player) return;

      const currentTime = player.getCurrentTime?.() || 0;
      if (Math.abs(currentTime - correctTime) > 2.5) {
        player.seekTo(correctTime, true);
      }

      const state = player.getPlayerState?.();
      if (state !== window.YT?.PlayerState.PLAYING) {
        player.playVideo?.();
      }
      return;
    }

    const widget = scWidgetRef.current;
    if (!widget) return;

    widget.getPosition((positionMs: number) => {
      const currentSec = positionMs / 1000;
      if (Math.abs(currentSec - correctTime) > 2.5) {
        widget.seekTo(correctTime * 1000);
      }
      widget.play();
    });
  }

  function getYouTubeId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([0-9A-Za-z_-]{11})/,
      /youtube\.com\/embed\/([0-9A-Za-z_-]{11})/,
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  function parseBeatInput(rawInput: string): Beat | null {
    const input = rawInput.trim();
    if (!input) return null;

    const ytId = getYouTubeId(input);
    if (ytId) {
      return { url: input, source: "youtube", videoId: ytId };
    }

    try {
      const parsed = new URL(input);
      if (parsed.hostname.includes("soundcloud.com")) {
        return { url: input, source: "soundcloud" };
      }
    } catch {
      return null;
    }

    return null;
  }

  function addBeat() {
    const beat = parseBeatInput(urlInput);
    if (!beat) {
      alert("Paste a valid YouTube or SoundCloud track URL.");
      return;
    }

    socket.emit("add_beat", beat);
    setUrlInput("");
  }

  function skip() {
    socket.emit("skip");
  }

  async function toggleMic() {
    if (micEnabled) {
      socket.emit("leave_voice");
      closeAllPeers();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      audioContextRef.current?.close();
      audioContextRef.current = null;
      setMicEnabled(false);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    localStreamRef.current = stream;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = audioContext;

    setMicEnabled(true);
    monitorVolume();

    socket.emit("join_voice");
  }

  async function createOfferTo(targetId: string) {
    const pc = await getOrCreatePeerConnection(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("voice_offer", { targetId, offer });
  }

  async function getOrCreatePeerConnection(targetId: string): Promise<RTCPeerConnection> {
    const existing = peerConnectionsRef.current.get(targetId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current as MediaStream);
    });

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit("voice_ice_candidate", {
        targetId,
        candidate: event.candidate,
      });
    };

    pc.ontrack = (event) => {
      let audioEl = remoteAudioElsRef.current.get(targetId);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
        remoteAudioElsRef.current.set(targetId, audioEl);
      }

      audioEl.srcObject = event.streams[0];
      void audioEl.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "closed" || state === "disconnected") {
        removePeer(targetId);
      }
    };

    peerConnectionsRef.current.set(targetId, pc);
    return pc;
  }

  function removePeer(peerId: string) {
    const pc = peerConnectionsRef.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      peerConnectionsRef.current.delete(peerId);
    }

    const audioEl = remoteAudioElsRef.current.get(peerId);
    if (audioEl) {
      audioEl.srcObject = null;
      audioEl.remove();
      remoteAudioElsRef.current.delete(peerId);
    }
  }

  function closeAllPeers() {
    for (const peerId of peerConnectionsRef.current.keys()) {
      removePeer(peerId);
    }
  }

  function monitorVolume() {
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;

    if (!analyser || !dataArray || !localStreamRef.current) {
      setVolumeLevel(0);
      return;
    }

    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    setVolumeLevel(avg);

    requestAnimationFrame(monitorVolume);
  }

  if (!registered) {
    return (
      <div className="animated-bg">
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              padding: 40,
              background: "rgba(255,255,255,0.05)",
              backdropFilter: "blur(10px)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <h2>Enter Your Name</h2>
            <input
              className="input-modern"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              placeholder="Username"
              style={{ marginTop: 10 }}
            />
            <div style={{ marginTop: 15 }}>
              <button className="button-modern" onClick={registerUser}>
                Join Cypher
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-grid">
      <div className="animated-bg" />

      <div className="panel left">
        <h3>Queue</h3>
        {queue.map((b, i) => (
          <div key={i} style={{ fontSize: 12, opacity: 0.7 }}>
            [{b.source}] {b.url}
          </div>
        ))}
      </div>

      <div
        className="panel"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <h2>Global Cypher</h2>
        <p style={{ fontSize: 12, opacity: 0.7, marginTop: -5 }}>
          Breaking change: room now supports live voice relay + YouTube/SoundCloud queue. Everyone should refresh once.
        </p>

        <div style={{ width: "70%", maxWidth: 800, position: "relative" }}>
          <div style={{ pointerEvents: "none", display: currentBeat?.source === "youtube" ? "block" : "none" }}>
            <div id="yt-player" />
          </div>

          <iframe
            ref={scIframeRef}
            title="SoundCloud player"
            style={{
              width: "100%",
              height: 380,
              border: 0,
              display: currentBeat?.source === "soundcloud" ? "block" : "none",
            }}
            allow="autoplay"
            src="https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/forss/flickermood&visual=false"
          />

          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 20,
              fontSize: 12,
              opacity: 0.6,
            }}
          >
            🔊 Live Sync ({currentBeat?.source || "idle"})
          </div>
        </div>

        <div
          className="mic-circle"
          style={{
            marginTop: 40,
            transform: micEnabled ? `scale(${1 + volumeLevel / 200})` : "scale(1)",
            boxShadow: micEnabled ? `0 0 ${volumeLevel}px rgba(0,255,150,0.6)` : "none",
          }}
        >
          <div
            className="mic-core"
            style={{
              background: micEnabled ? "#00ff99" : "#222",
            }}
          />
        </div>

        <button
          className="button-modern"
          style={{
            marginTop: 20,
            border: micEnabled ? "1px solid #00ff99" : "1px solid rgba(255,255,255,0.1)",
            color: micEnabled ? "#00ff99" : "white",
          }}
          onClick={toggleMic}
        >
          {micEnabled ? "Mic Live (Room Voice On)" : "Enable Mic + Join Voice"}
        </button>

        <div style={{ marginTop: 20 }}>
          <input
            className="input-modern"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste YouTube or SoundCloud link"
          />
          <button className="button-modern" onClick={addBeat} style={{ marginLeft: 10 }}>
            Add
          </button>
          <button className="button-modern" onClick={skip} style={{ marginLeft: 10 }}>
            Skip
          </button>
        </div>
      </div>

      <div className="panel right">
        <h3>Users</h3>
        {users.map((u) => (
          <div key={u.id}>
            <span
              style={{
                color: u.color,
                marginRight: 6,
              }}
            >
              ●
            </span>
            {u.name}
          </div>
        ))}
      </div>
    </div>
  );
}
