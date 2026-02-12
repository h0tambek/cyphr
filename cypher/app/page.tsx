"use client";

console.log("offset: ", offset);
console.log("start time:", startedAt);
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

if (!socketUrl) {
  throw new Error("NEXT_PUBLIC_SOCKET_URL is not defined");
}

const socket = io(socketUrl);

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export default function Home() {
  const ytPlayerRef = useRef<any>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<any>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [username, setUsername] = useState("");
  const [tempName, setTempName] = useState("");
  const [registered, setRegistered] = useState(false);

  const [queue, setQueue] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [currentBeat, setCurrentBeat] = useState<any>(null);
  const [ytReady, setYtReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  useEffect(() => {
    if (!registered) return;

    loadYouTube();

    const onRoomState = (room: any) => {
      setQueue(room.queue);
      setCurrentBeat(room.currentBeat);
    };

    const onPresenceUpdate = (userList: any[]) => {
      setUsers(userList);
    };

    const onBeatStart = ({ beat, startedAt }: { beat: any; startedAt: number }) => {
      const offset = (Date.now() - startedAt) / 1000;
      setCurrentBeat(beat);

      if (ytReady && ytPlayerRef.current) {
        ytPlayerRef.current.loadVideoById(beat.videoId, offset);
      }
    };

    const onSync = ({ startedAt }: { startedAt: number }) => {
      if (!startedAt || !ytPlayerRef.current) return;

      const correctTime = (Date.now() - startedAt) / 1000;
      const currentTime = ytPlayerRef.current.getCurrentTime?.();

      if (Math.abs(currentTime - correctTime) > 2) {
        ytPlayerRef.current.seekTo(correctTime, true);
      }
    };

    socket.on("room_state", onRoomState);
    socket.on("presence_update", onPresenceUpdate);
    socket.on("beat_start", onBeatStart);
    socket.on("sync", onSync);

    const syncInterval = setInterval(() => {
      socket.emit("request_sync");
    }, 5000);

    const watchdog = setInterval(() => {
      if (!ytPlayerRef.current) return;
      const state = ytPlayerRef.current.getPlayerState?.();
      if (state === 2 || state === 0) {
        ytPlayerRef.current.playVideo();
      }
    }, 3000);

    return () => {
      clearInterval(syncInterval);
      clearInterval(watchdog);
      socket.off("room_state", onRoomState);
      socket.off("presence_update", onPresenceUpdate);
      socket.off("beat_start", onBeatStart);
      socket.off("sync", onSync);
    };
  }, [registered, ytReady]);

  function registerUser() {
    if (!tempName.trim()) return;
    setUsername(tempName);
    socket.emit("register_user", tempName);
    setRegistered(true);
  }

  function loadYouTube() {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
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
          onReady: () => setYtReady(true),
        },
      });
    };
  }

  function getYouTubeId(url: string): string | null {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    return match ? match[1] : null;
  }

  function addBeat() {
    const id = getYouTubeId(urlInput);
    if (!id) return alert("Invalid YouTube link");

    socket.emit("add_beat", {
      url: urlInput,
      videoId: id,
      source: "youtube",
    });

    setUrlInput("");
  }

  function skip() {
    socket.emit("skip");
  }

  async function toggleMic() {
    if (micEnabled) {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      setMicEnabled(false);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);

    analyserRef.current = analyser;
    dataArrayRef.current = dataArray;

    setMicEnabled(true);
    monitorVolume();
  }

  function monitorVolume() {
  const analyser = analyserRef.current;
  const dataArray = dataArrayRef.current;

  if (!analyser || !dataArray) return;

  analyser.getByteFrequencyData(dataArray);

  const avg =
    dataArray.reduce((a: number, b: number) => a + b, 0) /
    dataArray.length;

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
            {b.url}
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

        <div
          style={{ width: "70%", maxWidth: 800, position: "relative" }}
        >
          <div style={{ pointerEvents: "none" }}>
            <div id="yt-player" />
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 10,
              right: 20,
              fontSize: 12,
              opacity: 0.6,
            }}
          >
            🔊 Live Sync
          </div>
        </div>

        <div
          className="mic-circle"
          style={{
            marginTop: 40,
            transform: micEnabled
              ? `scale(${1 + volumeLevel / 200})`
              : "scale(1)",
            boxShadow: micEnabled
              ? `0 0 ${volumeLevel}px rgba(0,255,150,0.6)`
              : "none",
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
            border: micEnabled
              ? "1px solid #00ff99"
              : "1px solid rgba(255,255,255,0.1)",
            color: micEnabled ? "#00ff99" : "white",
          }}
          onClick={toggleMic}
        >
          {micEnabled ? "Mic Enabled" : "Enable Mic"}
        </button>

        <div style={{ marginTop: 20 }}>
          <input
            className="input-modern"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Paste YouTube link"
          />
          <button
            className="button-modern"
            onClick={addBeat}
            style={{ marginLeft: 10 }}
          >
            Add
          </button>
          <button
            className="button-modern"
            onClick={skip}
            style={{ marginLeft: 10 }}
          >
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
