"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.playableRoles = void 0;
var socket_io_1 = require("socket.io");
var http_1 = __importDefault(require("http"));
var dotenv = __importStar(require("dotenv"));
var env = process.env.NODE_ENV;
var envPath = env === "production" ? ".env.production" : ".env.development";
dotenv.config({ path: envPath });
var server = http_1.default.createServer();
var port = 4000;
var io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.CORS,
        methods: ["GET", "POST"],
    },
});
var colors = [
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
exports.playableRoles = Object.freeze([
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
]);
var getRooms = function (roomId, filter) {
    if (filter === void 0) { filter = function (socket) { return true; }; }
    var rooms = io.sockets.adapter.rooms;
    return Array.from(rooms.get(roomId) || []).filter(function (id) {
        var userSocket = io.sockets.sockets.get(id);
        return userSocket.name && filter(userSocket);
    });
};
var shuffle = function (array) {
    var _a;
    var currentIndex = array.length;
    while (currentIndex != 0) {
        var randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        _a = [
            array[randomIndex],
            array[currentIndex],
        ], array[currentIndex] = _a[0], array[randomIndex] = _a[1];
    }
};
var sendAll = function (sender, getEmit) {
    sender.forEach(function (id, index) {
        var userSocket = io.sockets.sockets.get(id);
        var emit = getEmit(userSocket, index);
        if (emit) {
            var res = emit.res, data = emit.data;
            userSocket.emit(res, data);
        }
    });
};
var getTopVotedUser = function (selectedList) {
    var mostSelected = selectedList.reduce(function (acc, cur) {
        acc[cur.name] = (acc[cur.name] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(mostSelected).reduce(function (max, entry) { return (entry[1] > max[1] ? entry : max); }, ["", -1]);
};
io.on("connection", function (socket) {
    var getPlayerList = function (roomId) {
        var rooms = getRooms(roomId);
        var players = rooms.map(function (id, idx) {
            var userSocket = io.sockets.sockets.get(id);
            userSocket.color = colors[idx];
            return {
                name: userSocket.name,
                color: userSocket.color,
            };
        });
        return players;
    };
    var getPlayer = function (roomId, name) {
        var rooms = getRooms(roomId);
        var players = rooms.reduce(function (acc, cur) {
            var userSocket = io.sockets.sockets.get(cur);
            if (userSocket.name === name) {
                return userSocket;
            }
            return acc;
        }, {});
        return players;
    };
    var gameFinish = function (roomId, callback) {
        var rooms = getRooms(roomId);
        var mafia = rooms.reduce(function (acc, cur) {
            var userSocket = io.sockets.sockets.get(cur);
            if (userSocket.role === "mafia" && !userSocket.isDie) {
                return acc + 1;
            }
            return acc;
        }, 0);
        var citizen = rooms.reduce(function (acc, cur) {
            var userSocket = io.sockets.sockets.get(cur);
            if (userSocket.role === "citizen" && !userSocket.isDie) {
                return acc + 1;
            }
            return acc;
        }, 0);
        if (mafia >= citizen) {
            sendAll(rooms, function () { return ({
                res: "mafiaWin",
                data: "",
            }); });
        }
        else if (mafia === 0) {
            sendAll(rooms, function () { return ({
                res: "citizenWin",
                data: "",
            }); });
        }
        else {
            callback();
        }
    };
    socket.on("joinRoom", function (_a) {
        var roomId = _a.roomId, name = _a.name;
        var rooms = getRooms(roomId);
        if (rooms.length === 0) {
            socket.emit("joinRoomFail", {
                success: false,
                type: "noRoom",
            });
            return;
        }
        var findSameName = rooms.find(function (id) {
            var userSocket = io.sockets.sockets.get(id);
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
        var playerList = getPlayerList(roomId);
        io.to(roomId).emit("playerList", playerList);
        socket.emit("joinRoomSuccess", {
            playerList: playerList,
            player: {
                name: name,
                color: colors[playerList.length - 1],
                role: "citizen",
                alive: true,
                isAdmin: false,
            },
        });
    });
    socket.on("createRoom", function (_a) {
        var roomId = _a.roomId, name = _a.name;
        var rooms = getRooms(roomId);
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
            name: name,
            color: colors[0],
            role: "citizen",
            alive: true,
            isAdmin: true,
        });
    });
    socket.on("leaveRoom", function () {
        var roomId = socket.roomId;
        if (!roomId)
            return;
        socket.leave(roomId);
        socket.name = undefined;
        socket.roomId = undefined;
    });
    socket.on("ready", function () {
        var roomId = socket.roomId;
        var name = socket.name;
        io.to(roomId).emit("readyPlayerList", name);
    });
    socket.on("sendMessage", function (_a) {
        var message = _a.message, name = _a.name, color = _a.color;
        var roomId = socket.roomId;
        if (roomId) {
            io.to(roomId).emit("getMessage", {
                message: message,
                name: name,
                color: color,
                isSystem: false,
            });
        }
    });
    socket.on("sendMafiaMessage", function (_a) {
        var message = _a.message, name = _a.name, color = _a.color;
        var roomId = socket.roomId;
        if (roomId) {
            sendAll(getRooms(roomId), function (userSocket) {
                if (userSocket.role === "mafia") {
                    return {
                        res: "getMessage",
                        data: { message: message, name: name, color: color, isSystem: false },
                    };
                }
            });
        }
    });
    socket.on("selectPlayer", function (name) {
        var roomId = socket.roomId;
        if (roomId) {
            var role_1 = socket.role;
            var isMafia = role_1 === "mafia";
            var rooms = getRooms(roomId);
            var max_1 = isMafia
                ? rooms.reduce(function (acc, cur) {
                    var userSocket = io.sockets.sockets.get(cur);
                    if (userSocket.role === role_1) {
                        return acc + 1;
                    }
                    return acc;
                }, 0)
                : 1;
            sendAll(getRooms(roomId), function (userSocket) {
                if (role_1 === userSocket.role) {
                    return {
                        res: "selectPlayerSuccess",
                        data: {
                            selected: {
                                name: name,
                                selector: socket.name,
                            },
                            max: max_1,
                        },
                    };
                }
            });
        }
    });
    socket.on("mafiaVote", function (selectedList) {
        var roomId = socket.roomId;
        if (roomId) {
            var rooms_1 = getRooms(roomId);
            var _a = getTopVotedUser(selectedList), name_1 = _a[0], votes = _a[1];
            var dieUser_1 = getPlayer(roomId, name_1);
            if (dieUser_1.isHeal) {
                sendAll(rooms_1, function () { return ({
                    res: "citizenHeal",
                    data: "",
                }); });
            }
            else {
                dieUser_1.isDie = true;
                gameFinish(roomId, function () {
                    return sendAll(rooms_1, function () { return ({
                        res: "citizenDie",
                        data: { name: dieUser_1.name, color: dieUser_1.color },
                    }); });
                });
            }
            rooms_1.forEach(function (id) {
                var userSocket = io.sockets.sockets.get(id);
                userSocket.isHeal = false;
            });
        }
    });
    socket.on("citizenVote", function (selectedList) {
        var roomId = socket.roomId;
        if (roomId) {
            var rooms_2 = getRooms(roomId);
            var _a = getTopVotedUser(selectedList), name_2 = _a[0], votes = _a[1];
            var dieUser_2 = getPlayer(roomId, name_2);
            if (votes <= selectedList.length / 2) {
                sendAll(rooms_2, function () { return ({
                    res: "voteSafe",
                    data: "",
                }); });
            }
            else {
                dieUser_2.isDie = true;
                gameFinish(roomId, function () {
                    return sendAll(rooms_2, function () { return ({
                        res: "voteKill",
                        data: { name: dieUser_2.name, color: dieUser_2.color },
                    }); });
                });
            }
        }
    });
    socket.on("heal", function (selectedList) {
        var roomId = socket.roomId;
        if (roomId) {
            var rooms = getRooms(roomId);
            var name_3 = getTopVotedUser(selectedList)[0];
            var healUser = getPlayer(roomId, name_3);
            healUser.isHeal = true;
            sendAll(rooms, function () { return ({
                res: "healSuccess",
                data: "",
            }); });
        }
    });
    socket.on("check", function (selectedList) {
        var roomId = socket.roomId, name = socket.name;
        if (roomId) {
            var rooms = getRooms(roomId);
            var name_4 = getTopVotedUser(selectedList)[0];
            var checkUser_1 = getPlayer(roomId, name_4);
            checkUser_1.isHeal = true;
            sendAll(rooms, function (userSocket) { return ({
                res: "policeResult",
                data: userSocket.name === name_4 ? checkUser_1.role : "",
            }); });
        }
    });
    socket.on("startGame", function (roles) {
        var roomId = socket.roomId;
        if (roomId) {
            var rooms = getRooms(roomId);
            var randomRoles_1 = Object.entries(roles).reduce(function (acc, _a) {
                var role = _a[0], count = _a[1];
                return acc.concat(Array(count).fill(role));
            }, []);
            shuffle(randomRoles_1);
            sendAll(rooms, function (userSocket, index) {
                var role = randomRoles_1[index];
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
    socket.on("delayStart", function (delay) {
        var roomId = socket.roomId;
        if (roomId) {
            setTimeout(function () {
                io.to(roomId).emit("delayFinish");
            }, delay);
        }
    });
    socket.on("disconnect", function () {
        var roomId = socket.roomId, name = socket.name;
        if (roomId) {
            var rooms = getRooms(roomId);
            sendAll(rooms, function () {
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
server.listen(port, function () {
    console.log("Server is running on port ".concat(port));
});
