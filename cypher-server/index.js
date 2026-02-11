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
    io.emit("presence_update", Object.values(users));
  });
});

server.listen(4000, () => {
  console.log("Server running on 4000");
});
