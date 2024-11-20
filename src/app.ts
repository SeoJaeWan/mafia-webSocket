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
  isSystem?: boolean;
}

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

type Turn =
  | ""
  | "intro"
  | "kill" // 채팅 설명
  | "heal" // 채팅 설명
  | "check" // 채팅 설명
  | "discussion" // 채팅 설명
  | "vote" // 채팅 설명
  | "마피아 사망"
  | "일반인 사망";

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

    const players = rooms.map((id) => {
      const userSocket = io.sockets.sockets.get(id) as CustomSocket;

      return {
        name: userSocket.name,
        color: userSocket.color,
        isDie: userSocket.isDie,
        isReady: userSocket.isReady,
      };
    });

    return players;
  };

  socket.on("enterRoom", ({ roomId, name }: Room) => {
    socket.name = name;
    socket.roomId = roomId;
    socket.isReady = false;
    socket.isDie = false;

    socket.join(roomId);

    const players = getPlayers();
    const rooms = getRooms(roomId);

    sendAll(rooms, (userSocket) => ({
      res: "enterRoomRes",
      data: { name: userSocket.name, players },
    }));
  });

  socket.on("leaveRoom", () => {
    const { roomId } = socket;

    if (!roomId) return;

    socket.leave(roomId);

    socket.name = undefined;
    socket.roomId = undefined;
  });

  socket.on("chat", ({ message, turn, isSystem }: Chat) => {
    const { roomId, name } = socket;
    const sender = isSystem ? "알림" : name;

    if (roomId) {
      const rooms = getRooms(roomId);

      if (turn === "kill") {
        sendAll(rooms, (userSocket) => {
          if (userSocket.role === "mafia")
            return {
              res: "chatRss",
              data: { name: sender, message, isSystem },
            };
        });
      } else {
        sendAll(rooms, () => ({
          res: "chatRss",
          data: { name: sender, message, isSystem },
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
        userSocket.color = colors[index];
      });

      const players = getPlayers();

      sendAll(rooms, (_, index) => ({
        res: "gameStartRes",
        data: {
          role: randomRoles[index],
          players,
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
        data: "0",
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
        data: "1",
      }));
    } else if (mafia >= citizen) {
      return sendAll(aliveUser, () => ({
        res: "gameFinish",
        data: "2",
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

        const players = getPlayers();
        gameFinish(aliveUser, dieUser, turn, () =>
          sendAll(rooms, () => ({
            res: "vote result",
            data: { name, players },
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
        const players = getPlayers();

        gameFinish(aliveUser, dieUser, turn, () =>
          sendAll(rooms, () => ({
            res: "kill result",
            data: { name, players },
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

      sendAll(getRooms(roomId), () => ({ res: "readyRes", data: players }));
    }
  });
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
