import { Socket, Server } from "socket.io";
import http, { get } from "http";
import express from "express";

const app = express();
const server = http.createServer(app);

const port = 4000;

app.get("/", (req, res) => {
  const userAgent = req.headers["user-agent"]!;

  // 간단한 User-Agent 분석 예시
  let deviceType = "Unknown";
  if (/mobile/i.test(userAgent)) {
    deviceType = "Mobile";
  } else if (/tablet/i.test(userAgent)) {
    deviceType = "Tablet";
  } else if (/desktop|linux|windows|macintosh/i.test(userAgent)) {
    deviceType = "Desktop";
  }

  const forwarded = req.headers["x-forwarded-for"];

  const clientIp = forwarded || req.connection.remoteAddress;

  res.send(`Hello World : ${clientIp}, ${deviceType}`);
});

const io = new Server(server);

interface Room {
  roomId: string;
  name: string;
}

interface CustomSocket extends Socket {
  name?: string;
  roomId?: string;
  role?: PlayableRoleNames;
  selected?: string;
  alive?: boolean;
  isHeal?: boolean;
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
    if (cur.name) acc[cur.name] = (acc[cur.name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(mostSelected).reduce(
    (max, entry) => (entry[1] > max[1] ? entry : max),
    ["", -1]
  );
};

io.on("connection", (socket: CustomSocket) => {
  let roomState: NodeJS.Timeout | undefined;

  const clearGame = (roomId: string) => {
    const rooms = getRooms(roomId);

    rooms.forEach((id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      userSocket.role = undefined;
      userSocket.selected = undefined;
      userSocket.alive = true;
      userSocket.isHeal = false;
    });
  };

  const getPlayerList = (roomId: string) => {
    const rooms = getRooms(roomId);

    const players = rooms.map((id, idx) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      return {
        name: userSocket.name,
        color: colors[idx],
        alive: true,
        role: "citizen",
      };
    });

    return players;
  };

  const getPlayer = (roomId: string, name: string) => {
    const rooms = getRooms(roomId);

    const player = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      if (userSocket.name === name) {
        return userSocket;
      }

      return acc;
    }, {} as CustomSocket);

    return player!;
  };

  const getSelectedList = (
    roomId: string,
    filter?: (userSocket: CustomSocket) => boolean
  ) => {
    const rooms = getRooms(roomId);

    const selectedList = rooms
      .filter((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        return userSocket.alive && (!filter || filter(userSocket));
      })
      .map((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        const data = {
          name: userSocket.selected!,
          selector: userSocket.name!,
        };

        userSocket.selected = undefined;

        return data;
      });

    return selectedList;
  };

  const gameFinish = (roomId: string, callback: () => void) => {
    const rooms = getRooms(roomId);

    const mafia = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      if (userSocket.role === "mafia" && userSocket.alive) {
        return acc + 1;
      }

      return acc;
    }, 0);

    const citizen = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      if (userSocket.role === "citizen" && userSocket.alive) {
        return acc + 1;
      }

      return acc;
    }, 0);

    const roles = rooms.reduce((acc, cur) => {
      const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

      return acc.concat(userSocket.role!);
    }, [] as PlayableRoleNames[]);

    if (mafia >= citizen) {
      clearGame(roomId);
      sendAll(rooms, () => ({
        res: "mafiaWin",
        data: roles,
      }));
    } else if (mafia === 0) {
      clearGame(roomId);
      sendAll(rooms, () => ({
        res: "citizenWin",
        data: roles,
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

    const roomsLength = rooms.length;

    if (roomsLength >= 8) {
      socket.emit("joinRoomFail", {
        success: false,
        type: "fullRoom",
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

    const findGameStart = rooms.find((id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;
      return !!userSocket.role;
    });

    if (findGameStart) {
      socket.emit("joinRoomFail", {
        success: false,
        type: "gameStart",
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

  socket.on("sendMessage", ({ message, name, color }) => {
    const { roomId } = socket;

    if (roomId) {
      io.to(roomId).emit("getMessage", {
        message,
        name,
        color,
        isSystem: false,
        time: Date.now(),
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
            data: {
              message,
              name,
              color,
              isSystem: false,
              time: Date.now(),
            },
          };
        }
      });
    }
  });

  socket.on("selectPlayer", ({ name, turn }) => {
    const { roomId } = socket;

    if (roomId) {
      const role = socket.role!;

      socket.selected = name;

      const rooms = getRooms(roomId);
      const isMafiaVote = turn === "mafiaVote";

      const checkSendPlayer = (userSocket: CustomSocket) => {
        if (isMafiaVote) {
          return role === userSocket.role;
        } else {
          return userSocket.name === socket.name;
        }
      };

      sendAll(rooms, (userSocket) => {
        if (checkSendPlayer(userSocket)) {
          return {
            res: "selectPlayerSuccess",
            data: {
              name,
              selector: socket.name!,
            },
          };
        }
      });
    }
  });

  socket.on("mafiaVote", () => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const selectedList = getSelectedList(
        roomId,
        (userSocket) => !!userSocket.selected
      );

      const [name, votes] = getTopVotedUser(selectedList);
      const dieUser = getPlayer(roomId, name);

      if (dieUser.isHeal) {
        sendAll(rooms, () => ({
          res: "citizenHeal",
          data: "",
        }));
      } else if (selectedList.length / 2 > votes) {
        sendAll(rooms, () => ({
          res: "citizenSafe",
          data: "",
        }));
      } else {
        dieUser.alive = false;

        gameFinish(roomId, () =>
          sendAll(rooms, () => ({
            res: "citizenDie",
            data: dieUser.name,
          }))
        );
      }

      rooms.forEach((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        userSocket.isHeal = false;
      });
    }
  });

  socket.on("citizenVote", () => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      const selectedList = getSelectedList(roomId);

      const [name, votes] = getTopVotedUser(selectedList);
      const dieUser = getPlayer(roomId, name);

      if (!name || votes <= selectedList.length / 2) {
        sendAll(rooms, () => ({
          res: "voteSafe",
          data: "",
        }));
      } else {
        dieUser.alive = false;

        gameFinish(roomId, () =>
          sendAll(rooms, () => ({
            res: "voteKill",
            data: dieUser.name,
          }))
        );
      }
    }
  });

  socket.on("heal", () => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);
      const selectedList = getSelectedList(
        roomId,
        (userSocket) => !!userSocket.selected
      );

      const [name] = getTopVotedUser(selectedList);

      if (name) {
        const healUser = getPlayer(roomId, name);

        healUser.isHeal = true;
      }

      sendAll(rooms, () => ({
        res: "healSuccess",
        data: "",
      }));
    }
  });

  socket.on("check", () => {
    const { roomId, name } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);
      const selectedList = getSelectedList(
        roomId,
        (userSocket) => !!userSocket.selected
      );

      const [votedUser] = getTopVotedUser(selectedList);
      const checkUser = getPlayer(roomId, votedUser);

      checkUser.isHeal = true;

      sendAll(rooms, (userSocket) => {
        const sender = selectedList.find(
          ({ selector }) => selector === userSocket.name
        );

        return {
          res: "policeResult",
          data: sender ? checkUser.role : "",
        };
      });
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
        userSocket.alive = true;

        const colleague = randomRoles.reduce((acc, cur, index) => {
          if (role !== "citizen" && cur === role) {
            const colleagueSocket = io.sockets.sockets.get(
              rooms[index]
            ) as CustomSocket;

            return acc.concat(colleagueSocket.name!);
          }

          return acc;
        }, [] as string[]);

        return {
          res: "startGameSuccess",
          data: { role, colleague },
        };
      });
    }
  });

  socket.on("delayStart", (delay: number) => {
    const { roomId } = socket;

    if (roomId) {
      roomState = setTimeout(() => {
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

      clearTimeout(roomState);
      clearGame(roomId);
      socket.leave(roomId);
      socket.disconnect();
    }
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
