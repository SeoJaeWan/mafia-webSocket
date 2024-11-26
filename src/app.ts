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
  type: "create" | "join";
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

export interface PlayerStatus {
  isReady?: boolean;
  isDie?: boolean;
  role?: PlayableRoleNames;
}

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

interface Emit<T> {
  res: string;
  data: T;
}

function sendAll<T>(
  sender: string[],
  getEmit: (userSocket: CustomSocket, index: number) => Emit<T> | void
) {
  sender.forEach((id, index) => {
    const userSocket = io.sockets.sockets.get(id) as CustomSocket;

    const emit = getEmit(userSocket, index);

    if (emit) {
      const { res, data } = emit;

      userSocket.emit(res, data);
    }
  });
}

io.on("connection", (socket: CustomSocket) => {
  const getPlayers = () => {
    const { roomId } = socket;
    if (!roomId) return;

    const rooms = getRooms(roomId);

    const players = rooms.map((id, idx) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      return {
        name: userSocket.name,
        color: colors[idx],
        isReady: userSocket.isReady,
      };
    });

    return players;
  };

  const getPlayerStatuses = () => {
    const { roomId } = socket;
    if (!roomId) return;

    const rooms = getRooms(roomId);

    const players = rooms.map((id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      const status: PlayerStatus = {
        isDie: userSocket.isDie,
        role: undefined,
      };

      if (userSocket.isDie) {
        status.role = userSocket.role as PlayableRoleNames;
      }

      return status;
    });

    return players;
  };

  socket.on("enterRoom", ({ roomId, name, type }: Room) => {
    const rooms = getRooms(roomId);

    if (type === "join" && rooms.length === 0) {
      socket.emit("enterRoomRes", {
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
      socket.emit("enterRoomRes", {
        success: false,
        type: "sameName",
      });

      return;
    }

    socket.name = name;
    socket.roomId = roomId;
    socket.isReady = false;
    socket.isDie = false;

    socket.join(roomId);

    const players = getPlayers();

    sendAll(getRooms(roomId), (userSocket) => ({
      res: "enterRoomRes",
      data: { success: true, name: userSocket.name, players, roomId },
    }));
  });

  socket.on("leaveRoom", () => {
    const { roomId } = socket;

    if (!roomId) return;

    socket.leave(roomId);

    socket.name = undefined;
    socket.roomId = undefined;
  });

  socket.on("systemChat", ({ message }) => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      sendAll(rooms, () => ({
        res: "chatRss",
        data: { name: "알림", message, isSystem: true },
      }));
    }
  });

  socket.on("chat", ({ message, turn }: Chat) => {
    const { roomId, name } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      if (turn === "kill") {
        sendAll(rooms, (userSocket) => {
          if (userSocket.role === "mafia")
            return {
              res: "chatRss",
              data: { name, message, isSystem: false },
            };
        });
      } else {
        sendAll(rooms, () => ({
          res: "chatRss",
          data: { name, message, isSystem: false },
        }));
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

      socket.roles = randomRoles;

      rooms.forEach((id, index) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;
        userSocket.role = randomRoles[index];
        userSocket.isDie = false;
        userSocket.isHeal = false;
        userSocket.isReady = false;
      });

      const playerStatuses = getPlayerStatuses();

      sendAll(rooms, (_, index) => ({
        res: "gameStartRes",
        data: {
          role: randomRoles[index],
          playerStatuses,
        },
      }));
    }
  });

  socket.on("animationFinish", () => {
    const { roomId } = socket;
    if (roomId) {
      const rooms = getRooms(roomId);

      socket.isLoading = true;

      const allLoading = rooms.every((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        return userSocket.isLoading;
      });

      //

      if (allLoading) {
        sendAll(rooms, (userSocket) => {
          userSocket.isLoading = false;

          return {
            res: "animationFinishRes",
            data: "",
          };
        });
      }
    }
  });

  const gameFinish = (
    aliveUser: string[],
    dieUser: CustomSocket,
    turn: string,
    callback: () => void
  ) => {
    if (turn === "vote" && dieUser.role === "politician") {
      return sendAll(aliveUser, () => ({
        res: "gameFinish",
        data: "politicianWin",
      }));
    }

    const [mafia, citizen] = aliveUser.reduce(
      (acc, cur) => {
        const userSocket = io.sockets.sockets.get(cur) as CustomSocket;

        if (userSocket.isDie) return acc;
        else if (userSocket.role === "mafia") return [acc[0] + 1, acc[1]];
        else return [acc[0], acc[1] + 1];
      },
      [0, 0]
    );

    if (mafia === 0) {
      return sendAll(aliveUser, () => ({
        res: "gameFinish",
        data: "citizenWin",
      }));
    } else if (mafia >= citizen) {
      return sendAll(aliveUser, () => ({
        res: "gameFinish",
        data: "mafiaWin",
      }));
    }

    callback();
  };

  const submitResult = (
    selectedUsers: string[],
    aliveUser: string[],
    turn: string
  ) => {
    const mostSelected = selectedUsers.reduce((acc, cur) => {
      acc[cur] = (acc[cur] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const [name, votes] = Object.entries(mostSelected).reduce(
      (max, entry) => (entry[1] > max[1] ? entry : max),
      ["", -1]
    );

    const rooms = getRooms(socket.roomId || "");

    const dieUser = aliveUser.reduce((acc, id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      return userSocket.name === name ? userSocket : acc;
    }, {} as CustomSocket);

    if (turn === "vote") {
      if (aliveUser.length / 2 < votes) {
        dieUser.isDie = true;

        const playerStatuses = getPlayerStatuses();
        gameFinish(aliveUser, dieUser, turn, () =>
          sendAll(rooms, () => ({
            res: "vote result",
            data: { name, playerStatuses },
          }))
        );
      } else {
        sendAll(rooms, () => ({
          res: "vote result",
          data: "",
        }));
      }
    }

    if (turn === "heal") {
      dieUser.isHeal = true;
      sendAll(rooms, () => ({
        res: "heal result",
        data: "",
      }));
    }

    if (turn === "check") {
      const checkRole = dieUser.role;
      socket.emit("check result", checkRole);
    }

    if (turn === "kill") {
      if (dieUser.isHeal) {
        sendAll(rooms, () => ({
          res: "kill result",
          data: "",
        }));
      } else {
        dieUser.isDie = true;
        const playerStatuses = getPlayerStatuses();

        gameFinish(aliveUser, dieUser, turn, () =>
          sendAll(rooms, () => ({
            res: "kill result",
            data: { name, playerStatuses },
          }))
        );
      }
    }

    aliveUser.forEach((id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      userSocket.selected = "";
      userSocket.isHeal = false;
    });
  };

  socket.on("selectUser", ({ name, turn }: { name: string; turn: string }) => {
    const { roomId } = socket;

    if (roomId) {
      socket.selected = name;

      const turnRole =
        {
          kill: ["mafia"],
          heal: ["doctor"],
          check: ["police"],
          vote: ["mafia", "citizen", "politician", "doctor", "police"],
        }[turn] || [];

      const aliveUser = getRooms(roomId, (userSocket) => !userSocket.isDie);
      const sameRoleUser = getRooms(
        roomId,
        (userSocket) =>
          !userSocket.isDie && turnRole.includes(userSocket.role || "")
      );

      const selectedUsers = sameRoleUser
        .map((id) => {
          const userSocket = io.sockets.sockets.get(id) as CustomSocket;

          return userSocket.selected;
        })
        .filter((name) => name) as string[];

      if (selectedUsers.length === sameRoleUser.length) {
        submitResult(selectedUsers, aliveUser, turn);
      } else {
        sendAll(sameRoleUser, () => {
          return {
            res: "selectUserRes",
            data: { selector: socket.name, name },
          };
        });
      }
    }
  });

  socket.on("discussionFinish", () => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);
      socket.isLoading = true;

      const allLoading = rooms.every((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        return userSocket.isLoading;
      });

      if (allLoading) {
        sendAll(rooms, (userSocket) => {
          userSocket.isLoading = false;

          return {
            res: "discussionFinishRes",
            data: "",
          };
        });
      }
    }
  });

  socket.on("ready", () => {
    const { roomId } = socket;

    if (roomId) {
      socket.isReady = !socket.isReady;

      const players = getPlayers();

      sendAll(getRooms(roomId), () => ({
        res: "readyRes",
        data: players,
      }));
    }
  });

  socket.on("clearGame", () => {
    const { roomId } = socket;

    if (roomId) {
      const rooms = getRooms(roomId);

      rooms.forEach((id) => {
        const userSocket = io.sockets.sockets.get(id) as CustomSocket;

        userSocket.role = undefined;
        userSocket.isDie = false;
        userSocket.isHeal = false;
        userSocket.isReady = false;
      });

      const players = getPlayers();

      sendAll(rooms, () => ({
        res: "clearGameRes",
        data: players,
      }));
    }
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
