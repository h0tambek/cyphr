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
  sessionId: 0,
};

let users = {};
let voiceParticipants = new Set();

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
      source: room.currentBeat?.source || null,
    });
  });

  socket.on("beat_ended", ({ sessionId }) => {
    if (!room.currentBeat || room.sessionId !== sessionId) return;
    startNext();
  });

  socket.on("join_voice", () => {
    if (voiceParticipants.has(socket.id)) return;

    const existing = Array.from(voiceParticipants);
    voiceParticipants.add(socket.id);

    socket.emit("voice_existing", existing);
    socket.broadcast.emit("voice_user_joined", socket.id);
  });

  socket.on("leave_voice", () => {
    if (!voiceParticipants.has(socket.id)) return;
    voiceParticipants.delete(socket.id);
    socket.broadcast.emit("voice_user_left", socket.id);
  });

  socket.on("voice_offer", ({ targetId, offer }) => {
    io.to(targetId).emit("voice_offer", {
      fromId: socket.id,
      offer,
    });
  });

  socket.on("voice_answer", ({ targetId, answer }) => {
    io.to(targetId).emit("voice_answer", {
      fromId: socket.id,
      answer,
    });
  });

  socket.on("voice_ice_candidate", ({ targetId, candidate }) => {
    io.to(targetId).emit("voice_ice_candidate", {
      fromId: socket.id,
      candidate,
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
    room.sessionId += 1;

    io.emit("beat_start", {
      beat: room.currentBeat,
      startedAt: room.startedAt,
      sessionId: room.sessionId,
    });

    io.emit("room_state", room);
  }

  socket.on("disconnect", () => {
    delete users[socket.id];

    if (voiceParticipants.has(socket.id)) {
      voiceParticipants.delete(socket.id);
      socket.broadcast.emit("voice_user_left", socket.id);
    }

    io.emit("presence_update", Object.values(users));
  });
});

server.listen(4000, () => {
  console.log("Server running on 4000");
});
