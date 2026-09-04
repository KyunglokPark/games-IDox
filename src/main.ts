import {
  Combo,
  ComboType,
  GameState,
  Tile,
  botMove,
  computeScores,
  deal,
  evaluate,
  pass,
  play,
  tileId,
} from "./engine/index.ts";
import { Net, ServerMsg, StateMsg, LobbyMsg, defaultServerUrl } from "./net.ts";

const SUIT_SYMBOL = ["☁", "★", "☾", "☀"]; // 구름 별 달 해
const COMBO_KR: Record<ComboType, string> = {
  [ComboType.Single]: "싱글",
  [ComboType.Pair]: "페어",
  [ComboType.Triple]: "트리플",
  [ComboType.Straight]: "스트레이트",
  [ComboType.Flush]: "플러시",
  [ComboType.FullHouse]: "풀하우스",
  [ComboType.FourKind]: "포카드",
  [ComboType.StraightFlush]: "스트레이트 플러시",
};

const app = document.getElementById("app")!;

// ---------- 공통 보드 모델 ----------
interface BoardPlayer {
  name: string;
  handCount: number;
  finished: boolean;
  passed: boolean;
  isMe: boolean;
  active: boolean;
}
interface Board {
  players: BoardPlayer[];
  myHand: Tile[];
  mySeat: number;
  phase: "playing" | "ended";
  lastPlayTiles: Tile[] | null;
  lastPlayCombo: Combo | null;
  myTurn: boolean;
}
interface ScoreRowLite {
  playerIndex: number;
  name: string;
  tilesLeft: number;
  score: number;
}

// ---------- 앱 상태 ----------
type Mode = "menu" | "local" | "online";
let mode: Mode = "menu";
let selected = new Set<string>();
let message = "";
let numPlayers = 3;

// local
let local: GameState | null = null;
let botTimer: number | null = null;
const HUMAN = 0;

// online
const net = new Net();
let lobby: LobbyMsg | null = null;
let view: StateMsg | null = null;
let netName = localStorage.getItem("idox.name") || "나";
let netRoom = localStorage.getItem("idox.room") || "ROOM1";
let netServer = localStorage.getItem("idox.server") || defaultServerUrl();

// ---------- 타일/선택 유틸 ----------
function tileHTML(t: Tile, opts: { small?: boolean; selected?: boolean; disabled?: boolean } = {}) {
  const cls = ["tile", `s${t.suit}`, opts.small ? "small" : "", opts.selected ? "selected" : "", opts.disabled ? "disabled" : ""]
    .filter(Boolean)
    .join(" ");
  return `<div class="${cls}" data-id="${tileId(t)}"><span class="num">${t.num}</span><span class="suit">${SUIT_SYMBOL[t.suit]}</span></div>`;
}

function selectedTiles(board: Board): Tile[] {
  return board.myHand.filter((t) => selected.has(tileId(t)));
}

function betterThan(a: Combo | null, b: Combo | null): boolean {
  if (!a || !b) return false;
  if (a.category !== b.category) return a.category > b.category;
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const d = (a.key[i] ?? -1) - (b.key[i] ?? -1);
    if (d !== 0) return d > 0;
  }
  return false;
}

function evalSelection(board: Board): { canPlay: boolean; hint: string } {
  const need = board.lastPlayCombo;
  const sel = selectedTiles(board);
  if (sel.length === 0) {
    return { canPlay: false, hint: need ? `받아칠 조합 선택 (${need.count}장)` : "원하는 조합을 내세요" };
  }
  const combo = evaluate(sel);
  if (!combo) return { canPlay: false, hint: "유효하지 않은 조합" };
  if (need) {
    if (combo.count !== need.count) return { canPlay: false, hint: `${need.count}장을 내야 합니다` };
    if (!betterThan(combo, need)) return { canPlay: false, hint: `직전보다 약함 (${COMBO_KR[combo.type]})` };
  }
  return { canPlay: true, hint: `${COMBO_KR[combo.type]} — 낼 수 있음` };
}

// ---------- 보드 구성 ----------
function localBoard(): Board {
  const s = local!;
  return {
    players: s.players.map((p, i) => ({
      name: p.name,
      handCount: p.hand.length,
      finished: s.finishedOrder.includes(i),
      passed: s.passed[i],
      isMe: i === HUMAN,
      active: i === s.turn,
    })),
    myHand: s.players[HUMAN].hand,
    mySeat: HUMAN,
    phase: s.phase,
    lastPlayTiles: s.lastPlay?.combo.tiles ?? null,
    lastPlayCombo: s.lastPlay?.combo ?? null,
    myTurn: s.turn === HUMAN && s.phase === "playing",
  };
}
function onlineBoard(): Board {
  const v = view!;
  return {
    players: v.players.map((p, i) => ({
      name: p.name,
      handCount: p.handCount,
      finished: p.finished,
      passed: p.passed,
      isMe: i === v.seat,
      active: i === v.turn,
    })),
    myHand: v.hand,
    mySeat: v.seat,
    phase: v.phase,
    lastPlayTiles: v.lastPlay?.tiles ?? null,
    lastPlayCombo: v.lastPlay ? evaluate(v.lastPlay.tiles) : null,
    myTurn: v.turn === v.seat && v.phase === "playing",
  };
}

// ---------- 액션 디스패치 ----------
function doPlay(tiles: Tile[]) {
  if (mode === "local") {
    const r = play(local!, HUMAN, tiles);
    if (!r.ok) return void ((message = r.error ?? ""), renderGame());
    local = r.state;
    selected.clear();
    message = "";
    afterLocalMove();
  } else {
    net.play(tiles); // 서버가 state 또는 error 로 응답
  }
}
function doPass() {
  if (mode === "local") {
    const r = pass(local!, HUMAN);
    if (!r.ok) return void ((message = r.error ?? ""), renderGame());
    local = r.state;
    selected.clear();
    message = "";
    afterLocalMove();
  } else {
    net.pass();
  }
}

function afterLocalMove() {
  renderGame();
  if (!local) return;
  if (local.phase === "ended") return void setTimeout(() => renderEnd(localScores()), 500);
  scheduleBot();
}
function scheduleBot() {
  if (botTimer !== null || !local || local.phase !== "playing" || local.turn === HUMAN) return;
  botTimer = window.setTimeout(() => {
    botTimer = null;
    if (!local || local.phase !== "playing" || local.turn === HUMAN) return;
    const idx = local.turn;
    const mv = botMove(local, idx);
    const r = mv ? play(local, idx, mv.tiles) : pass(local, idx);
    local = r.state;
    afterLocalMove();
  }, 750);
}
function localScores(): ScoreRowLite[] {
  return computeScores(local!).sort((a, b) => b.score - a.score);
}

// ---------- 렌더: 메뉴 ----------
function renderMenu() {
  mode = "menu";
  app.innerHTML = `
    <div class="overlay"><div class="card">
      <h1>렉시오 <span style="color:var(--gold)">LEXIO</span></h1>
      <p class="sub">마작패로 즐기는 클라이밍 카드게임</p>
      <button class="btn" id="local" style="margin-bottom:10px">봇과 연습 (로컬)</button>
      <button class="btn ghost" id="online">친구와 온라인 대전</button>
      <p class="sub" style="margin-top:16px">숫자 3&lt;4&lt;…&lt;15&lt;1&lt;2 · 무늬 ☁&lt;★&lt;☾&lt;☀</p>
    </div></div>`;
  app.querySelector("#local")!.addEventListener("click", renderLocalSetup);
  app.querySelector("#online")!.addEventListener("click", renderOnlineSetup);
}

function renderLocalSetup() {
  app.innerHTML = `
    <div class="overlay"><div class="card">
      <h1>봇과 연습</h1>
      <p class="sub">인원 수를 고르세요</p>
      <div class="seg" id="seg">
        ${[3, 4, 5].map((n) => `<button data-n="${n}" class="${n === numPlayers ? "on" : ""}">${n}인</button>`).join("")}
      </div>
      <button class="btn" id="start">시작</button>
      <button class="btn ghost" id="back" style="margin-top:10px">뒤로</button>
    </div></div>`;
  app.querySelector("#seg")!.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("[data-n]") as HTMLElement | null;
    if (!b) return;
    numPlayers = Number(b.dataset.n);
    renderLocalSetup();
  });
  app.querySelector("#start")!.addEventListener("click", startLocal);
  app.querySelector("#back")!.addEventListener("click", renderMenu);
}

function startLocal() {
  mode = "local";
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    id: `p${i}`,
    name: i === HUMAN ? "나" : `봇${i}`,
    isBot: i !== HUMAN,
  }));
  local = deal({ players });
  selected = new Set();
  message = "";
  renderGame();
  scheduleBot();
}

// ---------- 렌더: 온라인 로비 ----------
function renderOnlineSetup() {
  app.innerHTML = `
    <div class="overlay"><div class="card">
      <h1>온라인 대전</h1>
      <p class="sub">같은 방 코드를 입력하면 함께 플레이</p>
      <label style="font-size:13px">닉네임</label>
      <input id="name" value="${netName}" maxlength="10" class="field" />
      <label style="font-size:13px">방 코드</label>
      <input id="room" value="${netRoom}" maxlength="8" class="field" />
      <label style="font-size:13px">서버 주소</label>
      <input id="server" value="${netServer}" class="field" placeholder="ws://192.168.0.x:3001" />
      <button class="btn" id="join">접속</button>
      <button class="btn ghost" id="back" style="margin-top:10px">뒤로</button>
      <p class="sub" id="neterr" style="margin-top:12px;color:#ef8a7a"></p>
    </div></div>`;
  app.querySelector("#back")!.addEventListener("click", () => {
    net.close();
    renderMenu();
  });
  app.querySelector("#join")!.addEventListener("click", () => {
    netName = (app.querySelector("#name") as HTMLInputElement).value || "익명";
    netRoom = ((app.querySelector("#room") as HTMLInputElement).value || "ROOM1").toUpperCase();
    netServer = (app.querySelector("#server") as HTMLInputElement).value.trim() || defaultServerUrl();
    localStorage.setItem("idox.name", netName);
    localStorage.setItem("idox.room", netRoom);
    localStorage.setItem("idox.server", netServer);
    connectOnline();
  });
}

function connectOnline() {
  mode = "online";
  lobby = null;
  view = null;
  net.onOpen = () => net.join(netRoom, netName);
  net.onClose = () => {
    const err = app.querySelector("#neterr");
    if (err) err.textContent = "서버 연결이 끊겼습니다";
  };
  net.onMessage = handleServer;
  net.connect(netServer);
}

function handleServer(m: ServerMsg) {
  switch (m.t) {
    case "lobby":
      lobby = m;
      view = null;
      renderWaiting();
      break;
    case "state":
      view = m;
      selected.clear();
      message = "";
      renderGame();
      break;
    case "ended":
      setTimeout(() => renderEnd(m.scores), 400);
      break;
    case "error": {
      message = m.msg;
      const err = app.querySelector("#neterr");
      if (err) err.textContent = m.msg;
      else renderGame();
      break;
    }
  }
}

function renderWaiting() {
  if (!lobby) return;
  const isHost = lobby.you === lobby.host;
  const list = lobby.players
    .map((p, i) => `<div class="score-row"><span>${p.isBot ? "🤖 " : "👤 "}${p.name}${i === lobby!.you ? " (나)" : ""}${i === lobby!.host ? " · 방장" : ""}</span></div>`)
    .join("");
  app.innerHTML = `
    <div class="overlay"><div class="card">
      <h1>대기실 · ${lobby.room}</h1>
      <p class="sub">${lobby.players.length}명 · 3~5명이면 시작 가능</p>
      ${list}
      ${
        isHost
          ? `<div class="seg" style="margin-top:14px">
               <button id="addbot">봇 추가</button>
               <button id="rmbot">봇 제거</button>
             </div>
             <button class="btn" id="start" ${lobby.players.length >= 3 ? "" : "disabled"}>게임 시작</button>`
          : `<p class="sub" style="margin-top:14px">방장이 시작하기를 기다리는 중…</p>`
      }
      <button class="btn ghost" id="leave" style="margin-top:10px">나가기</button>
    </div></div>`;
  if (isHost) {
    app.querySelector("#addbot")!.addEventListener("click", () => net.addBot());
    app.querySelector("#rmbot")!.addEventListener("click", () => net.removeBot());
    app.querySelector("#start")!.addEventListener("click", () => net.start());
  }
  app.querySelector("#leave")!.addEventListener("click", () => {
    net.close();
    renderMenu();
  });
}

// ---------- 렌더: 게임판 (로컬/온라인 공용) ----------
function renderGame() {
  const board = mode === "local" ? (local ? localBoard() : null) : view ? onlineBoard() : null;
  if (!board) return;
  const { canPlay, hint } = evalSelection(board);

  const opps = board.players
    .filter((p) => !p.isMe)
    .map((p) => {
      const backs = Array.from({ length: p.handCount }, () => `<span class="tile-back"></span>`).join("");
      const st = p.finished ? "완주 🎉" : p.passed ? "패스" : "";
      return `<div class="opp ${p.active ? "active" : ""}">
        <div class="name">${p.name}</div>
        <div class="backs">${backs}</div>
        <div class="status">${st} ${p.handCount}장</div>
      </div>`;
    })
    .join("");

  const pile = board.lastPlayTiles
    ? board.lastPlayTiles.map((t) => tileHTML(t, { small: true })).join("")
    : `<span class="pile-empty">— 선이 자유롭게 냅니다 —</span>`;

  const activeName = board.players.find((p) => p.active)?.name ?? "";
  const banner = board.phase !== "playing" ? "" : board.myTurn ? "당신 차례입니다" : `${activeName}(이)가 두는 중…`;

  const hand = board.myHand
    .map((t) => tileHTML(t, { selected: selected.has(tileId(t)), disabled: !board.myTurn }))
    .join("");

  app.innerHTML = `
    <div class="opponents">${opps}</div>
    <div class="table">
      <div class="table-label">테이블</div>
      <div class="pile">${pile}</div>
      <div class="turn-banner">${banner}</div>
    </div>
    <div class="hand-area">
      <div class="me-header">
        <span>내 손패 · ${board.myHand.length}장</span>
        <span class="hint">${message || hint}</span>
      </div>
      <div class="hand" id="hand">${hand}</div>
      <div class="actions">
        <button class="btn ghost" id="pass" ${board.myTurn && board.lastPlayCombo ? "" : "disabled"}>패스</button>
        <button class="btn" id="play" ${board.myTurn && canPlay ? "" : "disabled"}>내기</button>
      </div>
    </div>`;

  if (board.myTurn) {
    app.querySelector("#hand")!.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest("[data-id]") as HTMLElement | null;
      if (!el) return;
      const id = el.dataset.id!;
      selected.has(id) ? selected.delete(id) : selected.add(id);
      message = "";
      renderGame();
    });
    app.querySelector("#play")!.addEventListener("click", () => doPlay(selectedTiles(board)));
    app.querySelector("#pass")!.addEventListener("click", doPass);
  }
}

// ---------- 렌더: 종료 ----------
function renderEnd(rows: ScoreRowLite[]) {
  const mySeat = mode === "local" ? HUMAN : view?.seat ?? -1;
  const list = rows
    .map((r) => {
      const sign = r.score > 0 ? "plus" : r.score < 0 ? "minus" : "";
      const win = r.tilesLeft === 0;
      const you = r.playerIndex === mySeat ? " (나)" : "";
      return `<div class="score-row ${win ? "win" : ""}">
        <span>${win ? "🏆 " : ""}${r.name}${you} · ${r.tilesLeft}장</span>
        <span class="pts ${sign}">${r.score > 0 ? "+" : ""}${r.score}</span>
      </div>`;
    })
    .join("");
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="card">
    <h1>라운드 종료</h1>
    <p class="sub">타일이 적을수록 상위 · 2 보유 시 2배 페널티</p>
    ${list}
    <button class="btn" id="again" style="margin-top:16px">메뉴로</button>
  </div>`;
  app.appendChild(overlay);
  overlay.querySelector("#again")!.addEventListener("click", () => {
    net.close();
    renderMenu();
  });
}

renderMenu();
