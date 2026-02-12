const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const debugSync = process.env.DEBUG_SYNC === "true" || process.env.NEXT_PUBLIC_DEBUG_SYNC === "true";

function logTransition(event, socketId, queueLength) {
  if (!debugSync) return;
  console.log(`[sync-debug] ${event}`, {
    socketId,
    queueLength,
  });
}

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

function randomColor() {
  return `hsl(${Math.random() * 360}, 70%, 60%)`;
}

io.on("connection", (socket) => {

  socket.on("register_user", (username) => {
    logTransition("register_user", socket.id, room.queue.length);
    users[socket.id] = {
      id: socket.id,
      name: username,
      color: randomColor()
    };

    io.emit("presence_update", Object.values(users));
    socket.emit("room_state", room);
  });

  socket.on("add_beat", (beat) => {
    room.queue.push(beat);
    logTransition("add_beat", socket.id, room.queue.length);

    if (!room.currentBeat) startNext(socket.id);
    io.emit("room_state", room);
  });

  socket.on("skip", () => {
    logTransition("skip", socket.id, room.queue.length);
    startNext(socket.id);
  });

  socket.on("request_sync", () => {
    socket.emit("sync", {
      startedAt: room.startedAt,
    });
  });

  function startNext(triggeredBySocketId = "system") {
    logTransition("startNext", triggeredBySocketId, room.queue.length);
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
    io.emit("presence_update", Object.values(users));
  });
});

server.listen(4000, () => {
  console.log("Server running on 4000");
});
