import { Socket, Server } from "socket.io";
import http from "http";

const server = http.createServer();

const port = 4000;

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

interface Chat {
  turn: string;
  message: string;
}

interface Room {
  roomId: string;
  name: string;
}

interface CustomSocket extends Socket {
  name?: string;
  roomId?: string;
  ready?: boolean;
  role?: string;
  loading?: boolean;
}

export const playableRoles = Object.freeze([
  {
    label: "마피아",
    name: "mafia",
  },
  {
    label: "시민",
    name: "citizen",
  },
  {
    label: "경찰",
    name: "police",
  },
  {
    label: "의사",
    name: "doctor",
  },
  {
    label: "정치인",
    name: "politician",
  },
] as const);

export const playMode = Object.freeze([
  { label: "동률", value: "even" },
  { label: "난장판", value: "chaos" },
] as const);

type PlayableRoleNames = (typeof playableRoles)[number]["name"];
type PlayModeValues = (typeof playMode)[number];

export interface ISetting extends Record<PlayableRoleNames, number> {
  mode: PlayModeValues;
  time: number;
}

const getRooms = (roomId: string) => {
  const rooms = io.sockets.adapter.rooms;

  return Array.from(rooms.get(roomId) || []);
};

const getPlayerInRoom = (roomId: string) => {
  const rooms = getRooms(roomId);

  return rooms.map((id) => {
    const userSocket = io.sockets.sockets.get(id) as CustomSocket;
    return { name: userSocket.name, isReady: false };
  });
};

function shuffle(array: PlayableRoleNames[]) {
  let currentIndex = array.length;

  while (currentIndex != 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
}

io.on("connection", (socket: CustomSocket) => {
  socket.on("createRoom", ({ roomId, name }: Room) => {
    const rooms = io.sockets.adapter.rooms;

    socket.name = name;
    socket.roomId = roomId;
    socket.ready = false;

    if (!rooms.has(roomId)) {
      socket.join(roomId);
      socket.emit("createRoomRes", true);

      const playerInRoom = getPlayerInRoom(roomId);
      io.to(roomId).emit("players", playerInRoom);
    } else {
      socket.emit("createRoomRes", false);
    }
  });

  socket.on("joinRoom", ({ roomId, name }: Room) => {
    const rooms = io.sockets.adapter.rooms;

    socket.name = name;
    socket.roomId = roomId;
    socket.ready = false;

    if (!rooms.has(roomId)) {
      socket.emit("joinRoomRes", false);
    } else {
      socket.emit("joinRoomRes", true);
      socket.join(roomId);

      const playerInRoom = getPlayerInRoom(roomId);
      io.to(roomId).emit("players", playerInRoom);
    }
  });

  socket.on("leaveRoom", () => {
    const { roomId } = socket;

    if (!roomId) return;

    socket.leave(roomId);

    socket.name = undefined;
    socket.roomId = undefined;
  });

  socket.on("chat", ({ message, turn }: Chat) => {
    const { roomId, name } = socket;

    if (roomId) {
      if (turn === "kill") {
        const rooms = getRooms(roomId);

        rooms.forEach((id) => {
          const userSocket = io.sockets.sockets.get(id) as CustomSocket;

          if (userSocket.role === "mafia") {
            socket.to(id).emit("messages", { name, message });
          }
        });
      } else {
        socket.to(roomId).emit("messages", { name, message });
      }
    }
  });

  socket.on("gameStart", (setting: ISetting) => {
    const { roomId } = socket;
    const { time, mode, ...roles } = setting;

    if (roomId) {
      const randomRoles = Object.entries(roles).reduce((acc, [role, count]) => {
        return acc.concat(Array(count).fill(role));
      }, [] as PlayableRoleNames[]);

      shuffle(randomRoles);

      const rooms = getRooms(roomId);

      rooms.forEach((id, index) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;
        userSocket.role = randomRoles[index];

        userSocket.emit("gameStartRes", {
          role: randomRoles[index],
        });
      });
    }
  });

  socket.on(
    "animationFinish",
    ({ turn, day }: { turn: string; day: number }) => {
      const { roomId } = socket;
      if (roomId) {
        const rooms = getRooms(roomId);

        socket.loading = true;

        const allLoading = rooms.every((id) => {
          const userSocket = io.sockets.sockets.get(id) as CustomSocket;

          return userSocket.loading;
        });

        //

        if (allLoading) {
          rooms.forEach((id) => {
            const userSocket = io.sockets.sockets.get(id) as CustomSocket;

            if (userSocket.loading) {
              userSocket.loading = false;
              userSocket.emit("animationFinishRes", { turn, day });
            }
          });
        }
      }
    }
  );

  socket.on("ready", () => {
    const { roomId, name } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      socket.ready = !socket.ready;

      const playerInRoom = rooms.map((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        return {
          name: userSocket.name,
          isReady: name === userSocket.name ? socket.ready : userSocket.ready,
        };
      });

      io.to(roomId).emit("players", playerInRoom);
    }
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
