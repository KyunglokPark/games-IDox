// 렉시오 권한 서버 (authoritative). 순수 ws, 이식성 우선.
// 실행: npm run server  (tsx server/index.ts)
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  GameState,
  Tile,
  botMove,
  computeScores,
  deal,
  pass,
  play,
} from "../src/engine/index.ts";

const PORT = Number(process.env.PORT ?? 3001);

interface Seat {
  id: string;
  name: string;
  isBot: boolean;
  ws: WebSocket | null; // null = 봇이거나 접속 끊김
}
interface Room {
  code: string;
  seats: Seat[];
  hostId: string | null;
  state: GameState | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const rooms = new Map<string, Room>();
let seatCounter = 0;

function getRoom(code: string): Room {
  let r = rooms.get(code);
  if (!r) {
    r = { code, seats: [], hostId: null, state: null, timer: null };
    rooms.set(code, r);
  }
  return r;
}

function send(ws: WebSocket | null, msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ---------- 로비/상태 브로드캐스트 ----------
function broadcastLobby(room: Room) {
  const players = room.seats.map((s) => ({ name: s.name, isBot: s.isBot }));
  for (const s of room.seats) {
    send(s.ws, {
      t: "lobby",
      room: room.code,
      you: room.seats.indexOf(s),
      host: room.seats.findIndex((x) => x.id === room.hostId),
      players,
      started: !!room.state,
    });
  }
}

function viewFor(room: Room, seatIndex: number) {
  const st = room.state!;
  return {
    t: "state",
    seat: seatIndex,
    turn: st.turn,
    phase: st.phase,
    players: st.players.map((p, i) => ({
      name: room.seats[i].name,
      isBot: room.seats[i].isBot,
      handCount: p.hand.length,
      finished: st.finishedOrder.includes(i),
      passed: st.passed[i],
    })),
    hand: st.players[seatIndex].hand, // 본인 손패만
    lastPlay: st.lastPlay
      ? { seat: st.lastPlay.playerIndex, tiles: st.lastPlay.combo.tiles, count: st.lastPlay.combo.count }
      : null,
    log: st.log.slice(-6),
  };
}

function broadcastState(room: Room) {
  if (!room.state) return;
  room.seats.forEach((s, i) => send(s.ws, viewFor(room, i)));
  if (room.state.phase === "ended") {
    const scores = computeScores(room.state).sort((a, b) => b.score - a.score);
    for (const s of room.seats) send(s.ws, { t: "ended", scores });
  }
}

// ---------- 자동 진행 (봇/접속끊김 좌석) ----------
function isAuto(seat: Seat): boolean {
  return seat.isBot || seat.ws === null || seat.ws.readyState !== WebSocket.OPEN;
}

const BOT_MS = Number(process.env.BOT_MS ?? 800);

function scheduleAuto(room: Room) {
  if (room.timer) return;
  const st = room.state;
  if (!st || st.phase !== "playing") return;
  if (!isAuto(room.seats[st.turn])) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    const s = room.state;
    if (!s || s.phase !== "playing") return;
    const idx = s.turn;
    if (!isAuto(room.seats[idx])) return;
    const mv = botMove(s, idx);
    const r = mv ? play(s, idx, mv.tiles) : pass(s, idx);
    room.state = r.state;
    broadcastState(room);
    scheduleAuto(room);
  }, BOT_MS);
}

// ---------- 액션 처리 ----------
function startGame(room: Room) {
  if (room.state) return;
  if (room.seats.length < 3) {
    for (const s of room.seats) send(s.ws, { t: "error", msg: "3명 이상이어야 시작할 수 있습니다 (봇 추가 가능)" });
    return;
  }
  room.state = deal({
    players: room.seats.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })),
  });
  broadcastState(room);
  scheduleAuto(room);
}

function handleMove(room: Room, seatIndex: number, action: () => ReturnType<typeof play>, ws: WebSocket) {
  const st = room.state;
  if (!st || st.phase !== "playing") return;
  if (st.turn !== seatIndex) {
    send(ws, { t: "error", msg: "당신의 차례가 아닙니다" });
    return;
  }
  const r = action();
  if (!r.ok) {
    send(ws, { t: "error", msg: r.error ?? "잘못된 수" });
    return;
  }
  room.state = r.state;
  broadcastState(room);
  scheduleAuto(room);
}

// ---------- 연결 ----------
// HTTP 서버(헬스체크) + WebSocket 을 같은 포트에 붙인다.
// 클라우드 호스팅은 단일 포트($PORT)만 열어주고 HTTP 헬스체크를 요구하므로 통합 필수.
const httpServer = createServer((req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Lexio server OK");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, () => console.log(`[렉시오 서버] :${PORT} 대기 중 (http+ws)`));

wss.on("connection", (ws) => {
  let ctx: { room: Room; seatId: string } | null = null;

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.t === "join") {
      const room = getRoom(String(msg.room || "LOBBY").toUpperCase().slice(0, 8));
      if (room.state) {
        send(ws, { t: "error", msg: "이미 시작된 방입니다" });
        return;
      }
      if (room.seats.filter((s) => !s.isBot).length >= 5) {
        send(ws, { t: "error", msg: "방이 가득 찼습니다 (최대 5명)" });
        return;
      }
      const seat: Seat = {
        id: `s${++seatCounter}`,
        name: String(msg.name || "익명").slice(0, 10),
        isBot: false,
        ws,
      };
      room.seats.push(seat);
      if (!room.hostId) room.hostId = seat.id;
      ctx = { room, seatId: seat.id };
      broadcastLobby(room);
      return;
    }

    if (!ctx) return;
    const { room } = ctx;
    const seatIndex = room.seats.findIndex((s) => s.id === ctx!.seatId);
    if (seatIndex < 0) return;
    const isHost = room.hostId === ctx.seatId;

    switch (msg.t) {
      case "addbot":
        if (!isHost || room.state) break;
        if (room.seats.length >= 5) break;
        room.seats.push({ id: `b${++seatCounter}`, name: `봇${room.seats.length}`, isBot: true, ws: null });
        broadcastLobby(room);
        break;
      case "removebot":
        if (!isHost || room.state) break;
        for (let i = room.seats.length - 1; i >= 0; i--) {
          if (room.seats[i].isBot) {
            room.seats.splice(i, 1);
            break;
          }
        }
        broadcastLobby(room);
        break;
      case "start":
        if (!isHost) break;
        startGame(room);
        break;
      case "play":
        handleMove(room, seatIndex, () => play(room.state!, seatIndex, msg.tiles as Tile[]), ws);
        break;
      case "pass":
        handleMove(room, seatIndex, () => pass(room.state!, seatIndex), ws);
        break;
    }
  });

  ws.on("close", () => {
    if (!ctx) return;
    const { room } = ctx;
    const seat = room.seats.find((s) => s.id === ctx!.seatId);
    if (!seat) return;
    if (room.state) {
      // 게임 중 이탈: 좌석 유지하되 자동 진행으로 대체
      seat.ws = null;
      scheduleAuto(room);
    } else {
      // 로비 중 이탈: 좌석 제거
      const idx = room.seats.indexOf(seat);
      room.seats.splice(idx, 1);
      if (room.hostId === seat.id) room.hostId = room.seats.find((s) => !s.isBot)?.id ?? null;
      if (room.seats.every((s) => s.isBot) || room.seats.length === 0) {
        rooms.delete(room.code);
      } else {
        broadcastLobby(room);
      }
    }
  });
});
