import {
  Combo,
  ComboType,
  GameState,
  Tile,
  allCombos,
  botMove,
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
  coin?: number;
}
interface Board {
  players: BoardPlayer[];
  myHand: Tile[];
  mySeat: number;
  phase: "playing" | "ended";
  lastPlayTiles: Tile[] | null;
  lastPlayCombo: Combo | null;
  lastPlayName: string | null;
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
const START_COIN = 100;
let coins: number[] = []; // 좌석별 코인 (로컬 전용)
let localPlayers: { id: string; name: string; isBot: boolean }[] = [];

// online
const net = new Net();
let lobby: LobbyMsg | null = null;
let view: StateMsg | null = null;
let netName = localStorage.getItem("idox.name") || "나";
let netRoom = localStorage.getItem("idox.room") || "ROOM1";
let netPin = localStorage.getItem("idox.pin") || "";

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

// PAIR 버튼: 낼 수 있는 조합을 강한 순으로 순환 선택 (5장이면 풀하우스>플러시>스트레이트)
function playableCombos(board: Board): Combo[] {
  const need = board.lastPlayCombo;
  const list = need
    ? allCombos(board.myHand, need.count).filter((c) => betterThan(c, need))
    : allCombos(board.myHand);
  list.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count; // 장수 많은 것 먼저
    if (a.category !== b.category) return b.category - a.category; // 족보 높은 것 먼저
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (b.key[i] ?? -1) - (a.key[i] ?? -1);
      if (d !== 0) return d; // 같은 족보면 높은 것 먼저
    }
    return 0;
  });
  return list;
}

function cycleCombo(board: Board) {
  const cands = playableCombos(board);
  if (!cands.length) {
    message = "낼 수 있는 조합이 없어요";
    renderGame();
    return;
  }
  const sig = (ids: string[]) => [...ids].sort().join(",");
  const cur = sig([...selected]);
  let idx = cands.findIndex((c) => sig(c.tiles.map(tileId)) === cur);
  idx = idx < 0 ? 0 : (idx + 1) % cands.length;
  const combo = cands[idx];
  selected = new Set(combo.tiles.map(tileId));
  message = `${COMBO_KR[combo.type]} · ${idx + 1}/${cands.length}`;
  renderGame();
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
      coin: coins[i],
    })),
    myHand: s.players[HUMAN].hand,
    mySeat: HUMAN,
    phase: s.phase,
    lastPlayTiles: s.lastPlay?.combo.tiles ?? null,
    lastPlayCombo: s.lastPlay?.combo ?? null,
    lastPlayName: s.lastPlay ? s.players[s.lastPlay.playerIndex].name : null,
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
      coin: p.coins,
    })),
    myHand: v.hand,
    mySeat: v.seat,
    phase: v.phase,
    lastPlayTiles: v.lastPlay?.tiles ?? null,
    lastPlayCombo: v.lastPlay ? evaluate(v.lastPlay.tiles) : null,
    lastPlayName: v.lastPlay ? v.players[v.lastPlay.seat]?.name ?? null : null,
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

// 승자 독식 정산: 0장(승자)이 판돈 전부 획득, 나머지는 각자 남은 타일수만큼 잃음(2 보유 시 2배)
function settle(s: GameState): number[] {
  const eff = s.players.map((p) => {
    const left = p.hand.length;
    return p.hand.some((t) => t.num === 2) ? left * 2 : left;
  });
  const pot = eff.reduce((a, b) => a + b, 0);
  return eff.map((e) => (e === 0 ? pot : -e));
}

function afterLocalMove() {
  renderGame();
  if (!local) return;
  if (local.phase === "ended") {
    const deltas = settle(local); // 좌석 순서 정산액
    deltas.forEach((d, i) => (coins[i] += d)); // 코인 반영
    const rows: ScoreRowLite[] = local.players
      .map((p, i) => ({ playerIndex: i, name: p.name, tilesLeft: p.hand.length, score: deltas[i] }))
      .sort((a, b) => b.score - a.score);
    return void setTimeout(() => renderEndLocal(rows), 500);
  }
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

const NICKNAMES = [
  "초코곰", "왕감자", "라면요정", "구름토끼", "번개손", "달빛여우",
  "코인부자", "졸린판다", "행운의별", "노랑나비", "빨강망토", "치즈냥",
  "밤톨이", "럭키세븐", "무적타일", "핑크솜사탕", "은하수", "포카드킹",
];
function pickNames(n: number): string[] {
  const pool = [...NICKNAMES];
  return Array.from({ length: n }, () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
}

function startLocal() {
  mode = "local";
  const names = pickNames(numPlayers - 1);
  localPlayers = Array.from({ length: numPlayers }, (_, i) => ({
    id: `p${i}`,
    name: i === HUMAN ? "나" : names[i - 1],
    isBot: i !== HUMAN,
  }));
  coins = localPlayers.map(() => START_COIN); // 각자 100코인
  dealLocal();
}

// 같은 플레이어로 새 라운드 (코인은 유지)
function dealLocal() {
  local = deal({ players: localPlayers });
  selected = new Set();
  message = "";
  renderGame();
  scheduleBot();
}

// 라운드 종료 후 "시작": 파산자(코인≤0)는 제외하고 남은 사람끼리 계속.
// 단 3인 미만이 되거나 '나'가 파산하면 → 우승자 발표 후 전체 리셋(처음부터).
function continueLocal() {
  const humanOut = coins[HUMAN] <= 0;
  const survivors = coins.map((_, i) => i).filter((i) => coins[i] > 0);
  if (humanOut || survivors.length < 3) {
    endMatchAndReset();
    return;
  }
  localPlayers = survivors.map((i) => localPlayers[i]);
  coins = survivors.map((i) => coins[i]);
  dealLocal();
}

// 최종 우승자(코인 최다) 발표 후, 원래 인원·전원 100코인으로 처음부터
function endMatchAndReset() {
  let champ = 0;
  coins.forEach((c, i) => {
    if (c > coins[champ]) champ = i;
  });
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="card" style="text-align:center">
    <h1>🏆 최종 우승</h1>
    <p class="sub">3인 미만 — 전체 코인을 리셋하고 처음부터 시작합니다</p>
    <div class="score-row win" style="justify-content:center;font-size:20px;margin:12px 0">
      ${localPlayers[champ].name} · ${coins[champ]}🪙
    </div>
    <button class="btn" id="newgame" style="margin-top:8px">처음부터 새 게임</button>
    <button class="btn ghost" id="menu" style="margin-top:10px">메뉴로</button>
  </div>`;
  app.appendChild(overlay);
  overlay.querySelector("#newgame")!.addEventListener("click", () => startLocal());
  overlay.querySelector("#menu")!.addEventListener("click", () => renderMenu());
}

// ---------- 렌더: 온라인 로비 ----------
function renderOnlineSetup() {
  app.innerHTML = `
    <div class="overlay"><div class="card">
      <h1>온라인 대전</h1>
      <p class="sub">같은 방 코드를 입력하면 함께 플레이</p>
      <label style="font-size:13px">닉네임</label>
      <input id="name" value="${netName}" maxlength="10" class="field" />
      <label style="font-size:13px">PIN (4자리 숫자)</label>
      <input id="pin" value="${netPin}" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="예: 1234" class="field" />
      <label style="font-size:13px">방 코드</label>
      <input id="room" value="${netRoom}" maxlength="8" class="field" />
      <button class="btn" id="join">접속</button>
      <button class="btn ghost" id="back" style="margin-top:10px">뒤로</button>
      <p class="sub" id="neterr" style="margin-top:12px;color:#ef8a7a"></p>
    </div></div>`;
  app.querySelector("#back")!.addEventListener("click", () => {
    net.close();
    renderMenu();
  });
  app.querySelector("#join")!.addEventListener("click", () => {
    netName = (app.querySelector("#name") as HTMLInputElement).value.trim() || "익명";
    netPin = (app.querySelector("#pin") as HTMLInputElement).value.trim();
    netRoom = ((app.querySelector("#room") as HTMLInputElement).value || "ROOM1").toUpperCase();
    if (!/^\d{4}$/.test(netPin)) {
      const err = app.querySelector("#neterr");
      if (err) err.textContent = "PIN은 4자리 숫자로 입력하세요";
      return;
    }
    localStorage.setItem("idox.name", netName);
    localStorage.setItem("idox.pin", netPin);
    localStorage.setItem("idox.room", netRoom);
    connectOnline();
  });
}

function connectOnline() {
  mode = "online";
  lobby = null;
  view = null;
  net.onOpen = () => net.join(netRoom, netName, netPin);
  net.onClose = () => {
    const err = app.querySelector("#neterr");
    if (err) err.textContent = "서버 연결이 끊겼습니다";
  };
  net.onMessage = handleServer;
  net.connect(defaultServerUrl());
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
      setTimeout(() => renderEndOnline(m.scores), 400);
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

// 상대 인원수별 좌석 위치(좌·상·우 분산)
function seatSlots(n: number): string[] {
  switch (n) {
    case 1:
      return ["top"];
    case 2:
      return ["left", "right"];
    case 3:
      return ["left", "top", "right"];
    case 4:
      return ["left", "leftUpper", "rightUpper", "right"];
    default:
      return Array.from({ length: n }, () => "top");
  }
}

// 테이블에 깔린 패 렌더. 풀하우스는 트리플(좌)·페어(우)로 분리해 보여줌.
function renderPile(board: Board): string {
  const tiles = board.lastPlayTiles;
  if (!tiles) return `<span class="pile-empty">— 선이 자유롭게 냅니다 —</span>`;
  if (board.lastPlayCombo?.type === ComboType.FullHouse) {
    const groups = new Map<number, Tile[]>();
    for (const t of tiles) {
      const arr = groups.get(t.num) ?? [];
      arr.push(t);
      groups.set(t.num, arr);
    }
    const g = [...groups.values()];
    const triple = g.find((x) => x.length === 3) ?? [];
    const pair = g.find((x) => x.length === 2) ?? [];
    const draw = (arr: Tile[]) => arr.map((t) => tileHTML(t, { small: true })).join("");
    return `${draw(triple)}<span class="pile-sep"></span>${draw(pair)}`;
  }
  return tiles.map((t) => tileHTML(t, { small: true })).join("");
}

// ---------- 렌더: 게임판 (로컬/온라인 공용) ----------
function renderGame() {
  const board = mode === "local" ? (local ? localBoard() : null) : view ? onlineBoard() : null;
  if (!board) return;
  const { canPlay, hint } = evalSelection(board);

  // 상대를 내 다음 좌석부터 시계방향으로 나열 후, 좌·상·우 슬롯에 분산 배치
  const order: BoardPlayer[] = [];
  for (let k = 1; k < board.players.length; k++) {
    order.push(board.players[(board.mySeat + k) % board.players.length]);
  }
  const slots = seatSlots(order.length);
  const opps = order
    .map((p, i) => {
      const backs = Array.from({ length: p.handCount }, () => `<span class="tile-back"></span>`).join("");
      const st = p.finished ? "완주 🎉" : p.passed ? "패스" : "";
      const coin = p.coin != null ? ` · ${p.coin}🪙` : "";
      return `<div class="seat pos-${slots[i]} ${p.active ? "active" : ""}">
        <div class="name">${p.name}${coin}</div>
        <div class="backs">${backs}</div>
        <div class="status">${st} ${p.handCount}장</div>
      </div>`;
    })
    .join("");

  const pile = renderPile(board);

  const activeName = board.players.find((p) => p.active)?.name ?? "";
  const banner = board.phase !== "playing" ? "" : board.myTurn ? "당신 차례입니다" : `${activeName}(이)가 두는 중…`;

  const hand = board.myHand
    .map((t) => tileHTML(t, { selected: selected.has(tileId(t)), disabled: !board.myTurn }))
    .join("");

  app.innerHTML = `
    <div class="play">
      <button class="exit-btn" id="exit" title="나가기">🚪</button>
      <div class="suit-legend"><b class="s3">☀</b>＞<b class="s2">☾</b>＞<b class="s1">★</b>＞<b class="s0">☁</b></div>
      ${opps}
      <div class="table">
        <div class="table-label">${board.lastPlayName ? `${board.lastPlayName} 냄` : ""}</div>
        <div class="pile">${pile}</div>
        <div class="turn-banner">${banner}</div>
      </div>
    </div>
    <div class="hand-area">
      <div class="me-header">
        <span>내 손패 · ${board.myHand.length}장${(() => {
          const c = board.players.find((p) => p.isMe)?.coin;
          return c != null ? ` · ${c}🪙` : "";
        })()}</span>
        <span class="hint">${message || hint}</span>
      </div>
      <div class="hand" id="hand">${hand}</div>
      <div class="actions">
        <button class="btn ghost" id="pass" ${board.myTurn && board.lastPlayCombo ? "" : "disabled"}>패스</button>
        <button class="btn" id="play" ${board.myTurn && canPlay ? "" : "disabled"}>내기</button>
        <div class="action-side">
          <button class="btn mini" id="sort" ${board.myTurn ? "" : "disabled"}>1234</button>
          <button class="btn mini" id="combo" ${board.myTurn ? "" : "disabled"}>PAIR</button>
        </div>
      </div>
    </div>`;

  app.querySelector("#exit")?.addEventListener("click", confirmExit);

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
    app.querySelector("#sort")!.addEventListener("click", () => {
      selected.clear();
      message = "";
      renderGame();
    });
    app.querySelector("#combo")!.addEventListener("click", () => cycleCombo(board));
  }
}

// 나가기 확인
function confirmExit() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="card" style="text-align:center">
    <h1 style="font-size:20px">포기하고 나가시겠습니까?</h1>
    <div class="seg" style="margin-top:18px">
      <button id="yes" class="on">예</button>
      <button id="no">아니오</button>
    </div>
  </div>`;
  app.appendChild(overlay);
  overlay.querySelector("#yes")!.addEventListener("click", () => {
    net.close();
    renderMenu();
  });
  overlay.querySelector("#no")!.addEventListener("click", () => overlay.remove());
}

// ---------- 렌더: 종료 (온라인, 코인 정산) ----------
function renderEndOnline(
  rows: { playerIndex: number; name: string; tilesLeft: number; score: number; coins: number }[],
) {
  const mySeat = view?.seat ?? -1;
  const list = rows
    .map((r) => {
      const sign = r.score > 0 ? "plus" : r.score < 0 ? "minus" : "";
      const win = r.tilesLeft === 0;
      const you = r.playerIndex === mySeat ? " (나)" : "";
      return `<div class="score-row ${win ? "win" : ""}">
        <span>${win ? "🏆 " : ""}${r.name}${you} · ${r.tilesLeft}장</span>
        <span class="pts ${sign}">${r.score > 0 ? "+" : ""}${r.score} → ${r.coins}🪙</span>
      </div>`;
    })
    .join("");
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  const isHost = !!lobby && lobby.you === lobby.host;
  overlay.innerHTML = `<div class="card">
    <h1>라운드 종료</h1>
    <p class="sub">정산 완료 · 코인은 계정에 저장됩니다</p>
    ${list}
    ${
      isHost
        ? `<button class="btn" id="again" style="margin-top:16px">시작 (다음 판)</button>`
        : `<p class="sub" style="margin-top:14px">방장이 다음 판을 시작하길 기다리는 중…</p>`
    }
    <button class="btn ghost" id="menu" style="margin-top:10px">나가기</button>
  </div>`;
  app.appendChild(overlay);
  if (isHost) {
    overlay.querySelector("#again")!.addEventListener("click", () => {
      overlay.remove();
      net.restart(); // 방장: 같은 인원·코인으로 새 판 바로 시작
    });
  }
  overlay.querySelector("#menu")!.addEventListener("click", () => {
    net.close();
    renderMenu();
  });
}

// ---------- 렌더: 종료 (로컬, 코인 정산 + 연속 플레이) ----------
function renderEndLocal(rows: ScoreRowLite[]) {
  const bankrupt = coins.some((c) => c <= 0);
  const list = rows
    .map((r) => {
      const sign = r.score > 0 ? "plus" : r.score < 0 ? "minus" : "";
      const win = r.tilesLeft === 0;
      const you = r.playerIndex === HUMAN ? " (나)" : "";
      const coin = coins[r.playerIndex];
      const broke = coin <= 0 ? " 💥" : "";
      const two = local?.players[r.playerIndex].hand.some((t) => t.num === 2);
      return `<div class="score-row ${win ? "win" : ""}">
        <span>${win ? "🏆 " : ""}${r.name}${you} · ${r.tilesLeft}장${two ? ` <span style="color:#ef8a7a">🔴2보유 ×2</span>` : ""}</span>
        <span class="pts ${sign}">${r.score > 0 ? "+" : ""}${r.score} → ${coin}🪙${broke}</span>
      </div>`;
    })
    .join("");
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="card">
    <h1>라운드 종료</h1>
    <p class="sub">정산 완료 · 타일 적을수록 상위 · 2 보유 시 2배</p>
    ${list}
    ${bankrupt ? `<p class="sub" style="color:#ef8a7a;margin-top:12px">💥 파산자는 다음 판부터 제외됩니다 (남은 인원 3인 미만이면 우승자 발표 후 전체 리셋)</p>` : ""}
    <button class="btn" id="again" style="margin-top:16px">시작 (계속)</button>
    <button class="btn ghost" id="menu" style="margin-top:10px">메뉴로</button>
  </div>`;
  app.appendChild(overlay);
  overlay.querySelector("#again")!.addEventListener("click", () => continueLocal());
  overlay.querySelector("#menu")!.addEventListener("click", () => renderMenu());
}

// 가로(랜드스케이프) 기준 캔버스. 세로 화면(폰)은 90도 회전해 항상 가로로 보이게.
const BASE_W = 820;
const BASE_H = 460;
function fitScale() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vh > vw) {
    // 세로 화면 → 90도 회전해서 가로로 채움
    const s = Math.min(vh / BASE_W, vw / BASE_H);
    app.style.transform = `translate(-50%, -50%) rotate(90deg) scale(${s})`;
  } else {
    const s = Math.min(vw / BASE_W, vh / BASE_H);
    app.style.transform = `translate(-50%, -50%) rotate(0deg) scale(${s})`;
  }
}
window.addEventListener("resize", fitScale);
window.addEventListener("orientationchange", fitScale);
fitScale();

renderMenu();
