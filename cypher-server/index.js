const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

let room = {
  queue: [],
  currentBeat: null,
  startedAt: null,
};

let users = {};
const lastEnqueueAtByUser = {};

const MAX_USERNAME_LENGTH = 24;
const MAX_QUEUE_LENGTH = 100;
const ENQUEUE_COOLDOWN_MS = 1500;

function emitPayloadError(socket, action, reason, details = {}) {
  socket.emit("payload_error", {
    action,
    reason,
    ...details,
  });
}

function normalizeNonEmptyString(value, maxLength) {
  if (typeof value !== "string") return null;

  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : null;
}

function normalizeBeatPayload(beat) {
  if (!beat || typeof beat !== "object") return null;

  const url = normalizeNonEmptyString(beat.url, 2048);
  const videoId = normalizeNonEmptyString(beat.videoId, 128);
  const source = normalizeNonEmptyString(beat.source, 64);

  if (!url || !videoId || !source) return null;

  return { url, videoId, source };
}

function randomColor() {
  return `hsl(${Math.random() * 360}, 70%, 60%)`;
}

io.on("connection", (socket) => {

  socket.on("register_user", (username) => {
    const normalizedUsername = normalizeNonEmptyString(username, MAX_USERNAME_LENGTH);

    if (!normalizedUsername) {
      emitPayloadError(socket, "register_user", "invalid_username", {
        maxLength: MAX_USERNAME_LENGTH,
      });
      return;
    }

    users[socket.id] = {
      id: socket.id,
      name: normalizedUsername,
      color: randomColor()
    };

    io.emit("presence_update", Object.values(users));
    socket.emit("room_state", room);
  });

  socket.on("add_beat", (beat) => {
    const normalizedBeat = normalizeBeatPayload(beat);

    if (!normalizedBeat) {
      emitPayloadError(socket, "add_beat", "invalid_beat_payload", {
        requiredFields: ["url", "videoId", "source"],
      });
      return;
    }

    if (room.queue.length >= MAX_QUEUE_LENGTH) {
      emitPayloadError(socket, "add_beat", "queue_full", {
        maxQueueLength: MAX_QUEUE_LENGTH,
      });
      return;
    }

    const now = Date.now();
    const lastEnqueueAt = lastEnqueueAtByUser[socket.id] || 0;
    if (now - lastEnqueueAt < ENQUEUE_COOLDOWN_MS) {
      emitPayloadError(socket, "add_beat", "cooldown_active", {
        cooldownMs: ENQUEUE_COOLDOWN_MS,
      });
      return;
    }

    room.queue.push(normalizedBeat);
    lastEnqueueAtByUser[socket.id] = now;

    if (!room.currentBeat) startNext();
    io.emit("room_state", room);
  });

  socket.on("skip", startNext);

  socket.on("request_sync", () => {
    socket.emit("sync", {
      startedAt: room.startedAt,
    });
  });

  function startNext() {
    if (room.queue.length === 0) {
      room.currentBeat = null;
      room.startedAt = null;
      io.emit("room_state", room);
      return;
    }

    room.currentBeat = room.queue.shift();
    room.startedAt = Date.now();

    io.emit("beat_start", {
      beat: room.currentBeat,
      startedAt: room.startedAt,
    });

    io.emit("room_state", room);
  }

  socket.on("disconnect", () => {
    delete users[socket.id];
    delete lastEnqueueAtByUser[socket.id];
    io.emit("presence_update", Object.values(users));
  });
});

server.listen(4000, () => {
  console.log("Server running on 4000");
});
