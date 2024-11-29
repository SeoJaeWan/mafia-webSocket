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

interface Room {
  roomId: string;
  name: string;
}

interface CustomSocket extends Socket {
  name?: string;
  roomId?: string;
  color?: string;
  role?: string;
  roles?: string[];
  selected?: string;
  isDie?: boolean;
  isHeal?: boolean;
  isReady?: boolean;
  isLoading?: boolean;
}

interface Selected {
  name: string;
  selector: string;
}

const colors = [
  "#f82d39",
  "#2d5165",
  "#b9ab6c",
  "#0c3fb5",
  "#900599",
  "#b57731",
  "#56e616",
  "#913353",
  "#f1d65d",
  "#3e2528",
];

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
] as const);

type PlayableRoleNames = (typeof playableRoles)[number]["name"];

const getRooms = (
  roomId: string,
  filter: (socket: CustomSocket) => boolean = (socket) => true
) => {
  const rooms = io.sockets.adapter.rooms;

  return Array.from(rooms.get(roomId) || []).filter((id) => {
    const userSocket = io.sockets.sockets.get(id) as CustomSocket;

    return userSocket.name && filter(userSocket);
  });
};

const shuffle = (array: PlayableRoleNames[]) => {
  let currentIndex = array.length;

  while (currentIndex != 0) {
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex],
      array[currentIndex],
    ];
  }
};

interface Emit<T> {
  res: string;
  data: T;
}

const sendAll = <T>(
  sender: string[],
  getEmit: (userSocket: CustomSocket, index: number) => Emit<T> | void
) => {
  sender.forEach((id, index) => {
    const userSocket = io.sockets.sockets.get(id) as CustomSocket;

    const emit = getEmit(userSocket, index);

    if (emit) {
      const { res, data } = emit;

      userSocket.emit(res, data);
    }
  });
};

const getTopVotedUser = (selectedList: Selected[]) => {
  const mostSelected = selectedList.reduce((acc, cur) => {
    acc[cur.name] = (acc[cur.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(mostSelected).reduce(
    (max, entry) => (entry[1] > max[1] ? entry : max),
    ["", -1]
  );
};

io.on("connection", (socket: CustomSocket) => {
  const getPlayerList = (roomId: string) => {
    const rooms = getRooms(roomId);

    const players = rooms.map((id, idx) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      userSocket.color = colors[idx];

      return {
        name: userSocket.name,
        color: userSocket.color,
      };
    });

    return players;
  };

  const getPlayer = (roomId: string, name: string) => {
    const rooms = getRooms(roomId);

    const players = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      if (userSocket.name === name) {
        return userSocket;
      }

      return acc;
    }, {} as CustomSocket);

    return players!;
  };

  const gameFinish = (roomId: string, callback: () => void) => {
    const rooms = getRooms(roomId);

    const mafia = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      if (userSocket.role === "mafia" && !userSocket.isDie) {
        return acc + 1;
      }

      return acc;
    }, 0);

    const citizen = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      if (userSocket.role === "citizen" && !userSocket.isDie) {
        return acc + 1;
      }

      return acc;
    }, 0);

    if (mafia >= citizen) {
      sendAll(rooms, () => ({
        res: "mafiaWin",
        data: "",
      }));
    } else if (mafia === 0) {
      sendAll(rooms, () => ({
        res: "citizenWin",
        data: "",
      }));
    } else {
      callback();
    }
  };

  socket.on("joinRoom", ({ roomId, name }: Room) => {
    const rooms = getRooms(roomId);

    if (rooms.length === 0) {
      socket.emit("joinRoomFail", {
        success: false,
        type: "noRoom",
      });

      return;
    }

    const findSameName = rooms.find((id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;
      return userSocket.name === name;
    });

    if (findSameName) {
      socket.emit("joinRoomFail", {
        success: false,
        type: "sameName",
      });

      return;
    }

    socket.join(roomId);
    socket.name = name;
    socket.roomId = roomId;

    const playerList = getPlayerList(roomId);

    io.to(roomId).emit("playerList", playerList);
    socket.emit("joinRoomSuccess", {
      playerList,
      player: {
        name,
        color: colors[playerList.length - 1],
        role: "citizen",
        alive: true,
        isAdmin: false,
      },
    });
  });

  socket.on("createRoom", ({ roomId, name }: Room) => {
    const rooms = getRooms(roomId);

    if (rooms.length) {
      socket.emit("createRoomFail", {
        success: false,
        type: "existRoom",
      });

      return;
    }

    socket.join(roomId);

    socket.name = name;
    socket.roomId = roomId;

    socket.emit("createRoomSuccess", {
      name,
      color: colors[0],
      role: "citizen",
      alive: true,
      isAdmin: true,
    });
  });

  socket.on("leaveRoom", () => {
    const { roomId } = socket;

    if (!roomId) return;

    socket.leave(roomId);

    socket.name = undefined;
    socket.roomId = undefined;
  });

  socket.on("ready", () => {
    const roomId = socket.roomId!;
    const name = socket.name!;

    io.to(roomId).emit("readyPlayerList", name);
  });

  socket.on("sendMessage", ({ message, name, color }) => {
    const { roomId } = socket;

    if (roomId) {
      io.to(roomId).emit("getMessage", {
        message,
        name,
        color,
        isSystem: false,
      });
    }
  });

  socket.on("sendMafiaMessage", ({ message, name, color }) => {
    const { roomId } = socket;

    if (roomId) {
      sendAll(getRooms(roomId), (userSocket) => {
        if (userSocket.role === "mafia") {
          return {
            res: "getMessage",
            data: { message, name, color, isSystem: false },
          };
        }
      });
    }
  });

  socket.on("selectPlayer", (name) => {
    const { roomId } = socket;

    if (roomId) {
      const role = socket.role!;
      const isMafia = role === "mafia";

      const rooms = getRooms(roomId);

      const max = isMafia
        ? rooms.reduce((acc, cur) => {
            const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

            if (userSocket.role === role) {
              return acc + 1;
            }

            return acc;
          }, 0)
        : 1;

      sendAll(getRooms(roomId), (userSocket) => {
        if (role === userSocket.role) {
          return {
            res: "selectPlayerSuccess",
            data: {
              selected: {
                name,
                selector: socket.name,
              },
              max,
            },
          };
        }
      });
    }
  });

  socket.on("mafiaVote", (selectedList: Selected[]) => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const [name, votes] = getTopVotedUser(selectedList);
      const dieUser = getPlayer(roomId, name);

      if (dieUser.isHeal) {
        sendAll(rooms, () => ({
          res: "citizenHeal",
          data: "",
        }));
      } else {
        dieUser.isDie = true;

        gameFinish(roomId, () =>
          sendAll(rooms, () => ({
            res: "citizenDie",
            data: { name: dieUser.name, color: dieUser.color },
          }))
        );
      }

      rooms.forEach((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        userSocket.isHeal = false;
      });
    }
  });

  socket.on("citizenVote", (selectedList: Selected[]) => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const [name, votes] = getTopVotedUser(selectedList);
      const dieUser = getPlayer(roomId, name);

      if (votes <= selectedList.length / 2) {
        sendAll(rooms, () => ({
          res: "voteSafe",
          data: "",
        }));
      } else {
        dieUser.isDie = true;

        gameFinish(roomId, () =>
          sendAll(rooms, () => ({
            res: "voteKill",
            data: { name: dieUser.name, color: dieUser.color },
          }))
        );
      }
    }
  });

  socket.on("heal", (selectedList: Selected[]) => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const [name] = getTopVotedUser(selectedList);
      const healUser = getPlayer(roomId, name);

      healUser.isHeal = true;

      sendAll(rooms, () => ({
        res: "healSuccess",
        data: "",
      }));
    }
  });

  socket.on("check", (selectedList: Selected[]) => {
    const { roomId, name } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const [name] = getTopVotedUser(selectedList);
      const checkUser = getPlayer(roomId, name);

      checkUser.isHeal = true;

      sendAll(rooms, (userSocket) => ({
        res: "policeResult",
        data: userSocket.name === name ? checkUser.role : "",
      }));
    }
  });

  socket.on("startGame", (roles: Record<PlayableRoleNames, number>) => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const randomRoles = Object.entries(roles).reduce((acc, [role, count]) => {
        return acc.concat(Array(count).fill(role));
      }, [] as PlayableRoleNames[]);

      shuffle(randomRoles);

      sendAll(rooms, (userSocket, index) => {
        const role = randomRoles[index];

        userSocket.role = role;
        userSocket.isHeal = false;
        userSocket.isReady = false;
        userSocket.isDie = false;

        return {
          res: "startGameSuccess",
          data: role,
        };
      });
    }
  });

  socket.on("delayStart", (delay: number) => {
    const { roomId } = socket;

    if (roomId) {
      setTimeout(() => {
        io.to(roomId).emit("delayFinish");
      }, delay);
    }
  });

  socket.on("disconnect", () => {
    const { roomId, name } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      sendAll(rooms, () => {
        return {
          res: "playerLeave",
          data: name,
        };
      });

      socket.leave(roomId);
      socket.disconnect();
    }
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
