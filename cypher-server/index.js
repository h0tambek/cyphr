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
  transitionLock: false,
};

let users = {};

function randomColor() {
  return `hsl(${Math.random() * 360}, 70%, 60%)`;
}

io.on("connection", (socket) => {

  socket.on("register_user", (username) => {
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

    if (!room.currentBeat) startNext();
    io.emit("room_state", room);
  });

  socket.on("skip", () => {
    const expected = room.currentBeat
      ? { videoId: room.currentBeat.videoId, startedAt: room.startedAt }
      : null;
    startNext(expected);
  });

  socket.on("track_ended", ({ videoId, startedAt }) => {
    if (!room.currentBeat || room.transitionLock) return;
    if (room.currentBeat.videoId !== videoId) return;
    if (room.startedAt !== startedAt) return;

    startNext({ videoId, startedAt });
  });

  socket.on("request_sync", () => {
    socket.emit("sync", {
      startedAt: room.startedAt,
    });
  });

  function startNext(expectedCurrent) {
    if (room.transitionLock) return;
    if (expectedCurrent) {
      if (!room.currentBeat) return;
      if (room.currentBeat.videoId !== expectedCurrent.videoId) return;
      if (room.startedAt !== expectedCurrent.startedAt) return;
    }

    room.transitionLock = true;

    if (room.queue.length === 0) {
      room.currentBeat = null;
      room.startedAt = null;
      room.transitionLock = false;
      io.emit("room_state", room);
      return;
    }

    room.currentBeat = room.queue.shift();
    room.startedAt = Date.now();

    io.emit("beat_start", {
      beat: room.currentBeat,
      startedAt: room.startedAt,
    });

    room.transitionLock = false;
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
