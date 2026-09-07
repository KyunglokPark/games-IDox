// 렉시오 권한 서버 (authoritative). 순수 ws, 이식성 우선.
// 실행: npm run server  (tsx server/index.ts)
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { GameState, Tile, botMove, deal, pass, play } from "../src/engine/index.ts";
import { getProfile, saveProfile, storageMode } from "./store.ts";

const PORT = Number(process.env.PORT ?? 3001);
const NEW_USER_COINS = 1000; // 신규 유저 지급 코인

interface Seat {
  id: string;
  name: string;
  isBot: boolean;
  ws: WebSocket | null; // null = 봇이거나 접속 끊김
  coins: number;
  pin: string; // 봇은 ""
  authName: string; // 프로필 저장 키 (봇은 "")
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

const BOT_NAMES = [
  "초코곰", "왕감자", "라면요정", "구름토끼", "번개손", "달빛여우",
  "코인부자", "졸린판다", "행운의별", "노랑나비", "빨강망토", "치즈냥",
  "밤톨이", "럭키세븐", "무적타일", "핑크솜사탕", "은하수", "포카드킹",
];
function pickBotName(room: Room): string {
  const used = new Set(room.seats.map((s) => s.name));
  const avail = BOT_NAMES.filter((n) => !used.has(n));
  const pool = avail.length ? avail : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
      coins: room.seats[i].coins,
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
}

// 게임 종료: 승자 독식 정산 → 코인 갱신(0 하한) → 유저 프로필 저장 → 최종 상태+결과 전송
async function finishGame(room: Room) {
  const st = room.state;
  if (!st) return;
  const eff = st.players.map((p) => {
    const left = p.hand.length;
    return p.hand.some((t) => t.num === 2) ? left * 2 : left;
  });
  const pot = eff.reduce((a, b) => a + b, 0);
  const deltas = eff.map((e) => (e === 0 ? pot : -e));

  for (let i = 0; i < room.seats.length; i++) {
    const s = room.seats[i];
    s.coins = Math.max(0, s.coins + deltas[i]);
    if (!s.isBot && s.authName) await saveProfile(s.authName, { pin: s.pin, coins: s.coins });
  }

  room.seats.forEach((s, i) => send(s.ws, viewFor(room, i))); // 갱신된 코인 반영된 최종 상태
  const scores = st.players
    .map((p, i) => ({
      playerIndex: i,
      name: room.seats[i].name,
      tilesLeft: p.hand.length,
      score: deltas[i],
      coins: room.seats[i].coins,
    }))
    .sort((a, b) => b.score - a.score);
  for (const s of room.seats) send(s.ws, { t: "ended", scores });
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
    if (room.state.phase === "ended") {
      void finishGame(room);
      return;
    }
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
  if (room.state.phase === "ended") {
    void finishGame(room);
    return;
  }
  broadcastState(room);
  scheduleAuto(room);
}

// ---------- 로그인/입장 (닉네임 + PIN 인증) ----------
async function handleJoin(
  ws: WebSocket,
  msg: any,
  setCtx: (c: { room: Room; seatId: string }) => void,
) {
  const room = getRoom(String(msg.room || "LOBBY").toUpperCase().slice(0, 8));
  if (room.state) return send(ws, { t: "error", msg: "이미 시작된 방입니다" });
  if (room.seats.filter((s) => !s.isBot).length >= 5)
    return send(ws, { t: "error", msg: "방이 가득 찼습니다 (최대 5명)" });

  const name = String(msg.name || "").slice(0, 10).trim();
  const pin = String(msg.pin || "");
  if (!name) return send(ws, { t: "error", msg: "닉네임을 입력하세요" });
  if (!/^\d{4}$/.test(pin)) return send(ws, { t: "error", msg: "PIN 4자리 숫자를 입력하세요" });

  const prof = await getProfile(name);
  if (prof) {
    if (prof.pin !== pin) return send(ws, { t: "error", msg: "PIN이 일치하지 않습니다" });
  } else {
    await saveProfile(name, { pin, coins: NEW_USER_COINS });
  }
  const coins = prof ? prof.coins : NEW_USER_COINS;

  const seat: Seat = {
    id: `s${++seatCounter}`,
    name,
    isBot: false,
    ws,
    coins,
    pin,
    authName: name,
  };
  room.seats.push(seat);
  if (!room.hostId) room.hostId = seat.id;
  setCtx({ room, seatId: seat.id });
  broadcastLobby(room);
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
httpServer.listen(PORT, () =>
  console.log(`[렉시오 서버] :${PORT} 대기 중 (http+ws) · 저장소: ${storageMode()}`),
);

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
      void handleJoin(ws, msg, (c) => (ctx = c));
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
        room.seats.push({ id: `b${++seatCounter}`, name: pickBotName(room), isBot: true, ws: null, coins: NEW_USER_COINS, pin: "", authName: "" });
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
      case "again": // 종료 후 대기실로 리셋 (코인·좌석 유지)
        if (!room.state || room.state.phase !== "ended") break;
        room.state = null;
        if (room.timer) {
          clearTimeout(room.timer);
          room.timer = null;
        }
        room.seats = room.seats.filter((s) => s.isBot || (s.ws && s.ws.readyState === WebSocket.OPEN));
        if (!room.seats.some((s) => s.id === room.hostId)) {
          room.hostId = room.seats.find((s) => !s.isBot)?.id ?? null;
        }
        broadcastLobby(room);
        break;
      case "restart": // 방장: 끝난 게임 리셋 후 같은 인원·코인으로 새 판 바로 시작
        if (!isHost || !room.state || room.state.phase !== "ended") break;
        room.state = null;
        if (room.timer) {
          clearTimeout(room.timer);
          room.timer = null;
        }
        room.seats = room.seats.filter((s) => s.isBot || (s.ws && s.ws.readyState === WebSocket.OPEN));
        if (!room.seats.some((s) => s.id === room.hostId)) {
          room.hostId = room.seats.find((s) => !s.isBot)?.id ?? null;
        }
        if (room.seats.length >= 3) startGame(room);
        else broadcastLobby(room); // 3명 미만이면 대기실로(봇 추가 가능)
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
