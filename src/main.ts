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
import { Net, ServerMsg, StateMsg, LobbyMsg, RoomInfo, defaultServerUrl } from "./net.ts";
import { PACKS, initBilling, buy as buyPack, billingAvailable } from "./billing.ts";

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
  turnDeadline: number; // 현재 턴 마감 epoch ms (0 = 없음)
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

// 턴 타이머
const TURN_MS = 30000;
let localDeadline = 0; // 로컬 내 턴 마감
let localTurnTimer: number | null = null;
let turnDeadlineMs = 0; // 표시용(현재 턴 마감)
let activeIsMe = false;

// online
const net = new Net();
let lobby: LobbyMsg | null = null;
let view: StateMsg | null = null;
let myCoins = 0;
let netName = localStorage.getItem("idox.name") || "나";
let netPin = localStorage.getItem("idox.pin") || "";
let storeOpen = false; // 코인 상점 화면 표시 중
let bonusNote = ""; // 로그인 시 매일 지원 코인 알림
let storeNote = ""; // 상점 구매 결과 알림
let roomsView = false; // 온라인 대전(방 목록) 흐름 진행 중 (홈과 구분)

// ---------- 타일/선택 유틸 ----------
function tileHTML(t: Tile, opts: { small?: boolean; selected?: boolean; disabled?: boolean } = {}) {
  const cls = ["tile", `s${t.suit}`, t.num === 2 ? "two" : "", opts.small ? "small" : "", opts.selected ? "selected" : "", opts.disabled ? "disabled" : ""]
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
    if (a.count !== b.count) return a.count - b.count; // 장수 적은(작은) 것 먼저
    if (a.category !== b.category) return a.category - b.category; // 족보 낮은 것 먼저
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (a.key[i] ?? -1) - (b.key[i] ?? -1);
      if (d !== 0) return d; // 같은 족보면 낮은 것 먼저
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
    turnDeadline: s.turn === HUMAN && s.phase === "playing" ? localDeadline : 0,
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
    turnDeadline: v.turnDeadline ?? 0,
  };
}

// ---------- 액션 디스패치 ----------
function doPlay(tiles: Tile[]) {
  clearLocalTimer();
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
  clearLocalTimer();
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

function clearLocalTimer() {
  if (localTurnTimer !== null) {
    clearTimeout(localTurnTimer);
    localTurnTimer = null;
  }
}
function onLocalTimeout() {
  localTurnTimer = null;
  if (mode !== "local" || !local || local.phase !== "playing" || local.turn !== HUMAN) return;
  if (local.lastPlay) doPass();
  else doPlay([local.players[HUMAN].hand[0]]); // 선이면 최저 싱글 자동
}

// 타이머 표시 갱신 (별도 인터벌에서 호출)
function updateTimers() {
  if (!document.getElementById("hand")) return; // 게임 화면 아닐 때 무시
  const myT = document.getElementById("my-timer");
  const seatT = app.querySelector(".seat.active .seat-timer") as HTMLElement | null;
  if (!turnDeadlineMs) {
    if (myT) myT.textContent = "";
    if (seatT) seatT.textContent = "";
    return;
  }
  const rem = Math.max(0, Math.ceil((turnDeadlineMs - Date.now()) / 1000));
  if (activeIsMe) {
    if (myT) {
      myT.textContent = `⏱ ${rem}`;
      myT.classList.toggle("urgent", rem <= 5);
    }
    if (seatT) seatT.textContent = "";
  } else {
    if (seatT) seatT.textContent = String(rem);
    if (myT) myT.textContent = "";
  }
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

// ---------- 렌더: 메뉴 (루미큐브 스타일 가로 홈) ----------
// 카드 장식용 미니 타일
function dtile(suit: number, num: number, cls = ""): string {
  const two = num === 2 ? "two" : "";
  return `<div class="tile s${suit} dtile ${two} ${cls}"><span class="num">${num}</span><span class="suit">${SUIT_SYMBOL[suit]}</span></div>`;
}
function artPractice(): string {
  return `<div class="fan">${dtile(0, 3, "f1")}${dtile(2, 7, "f2")}${dtile(3, 9, "f3")}<span class="art-emoji">🤖</span></div>`;
}
function artPlay(): string {
  return `<div class="fan">${dtile(3, 2, "f1")}${dtile(1, 10, "f2")}${dtile(2, 5, "f3")}<span class="art-emoji">🌐</span></div>`;
}
function artHowto(): string {
  return `<div class="fan">${dtile(2, 7, "f2")}<span class="art-q">?</span></div>`;
}

function renderMenu() {
  mode = "menu";
  const initial = (netName[0] || "?").toUpperCase();
  app.innerHTML = `
    <div class="home">
      <header class="home-top">
        <div class="player-chip">
          <span class="avatar">${initial}</span>
          <span class="pname">${netName}</span>
        </div>
        <span class="coin-pill">🪙 ${myCoins}</span>
      </header>
      ${bonusNote ? `<div class="home-note">${bonusNote}</div>` : ""}
      <div class="home-cards">
        <button class="home-card c-practice" id="local">
          <div class="card-art">${artPractice()}</div>
          <div class="card-name">Practice</div>
          <div class="card-desc">봇과 연습</div>
        </button>
        <button class="home-card c-play featured" id="online">
          <div class="card-art">${artPlay()}</div>
          <div class="card-name">Play Now</div>
          <div class="card-desc">온라인 대전</div>
        </button>
        <button class="home-card c-howto" id="tutorial">
          <div class="card-art">${artHowto()}</div>
          <div class="card-name">How to play</div>
          <div class="card-desc">게임 방법</div>
        </button>
      </div>
      <footer class="home-foot"><span class="foot-logo">IDox</span></footer>
    </div>`;
  bonusNote = ""; // 한 번 보여주면 지움
  app.querySelector("#local")!.addEventListener("click", renderLocalSetup);
  app.querySelector("#online")!.addEventListener("click", goPlayNow);
  app.querySelector("#tutorial")!.addEventListener("click", renderTutorial);
}

// Play Now: 이미 로그인된 세션으로 방 목록으로. 연결이 끊겼으면 재접속+재로그인.
function goPlayNow() {
  mode = "online";
  roomsView = true;
  if (net.isOpen()) net.listRooms();
  else connectOnline();
}


// ---------- 튜토리얼 ----------
function renderTutorial() {
  app.innerHTML = `
    <div class="scene"><div class="panel">
      <h1>How to play</h1>
      <div class="tut">
        <h3>🎯 목표</h3>
        <p>손패를 가장 먼저 다 내려놓으면 승리! 남은 타일은 벌점(코인 차감)입니다.</p>

        <h3>🔢 숫자 세기</h3>
        <p>약함 &nbsp;<b>3 &lt; 4 &lt; … &lt; 15 &lt; 1 &lt; 2</b>&nbsp; 강함 &nbsp;(2가 최강)</p>

        <h3>🎨 무늬 세기</h3>
        <p>약함 &nbsp;<b class="s0">☁구름</b> &lt; <b class="s1">★별</b> &lt; <b class="s2">☾달</b> &lt; <b class="s3">☀해</b>&nbsp; 강함<br>숫자가 같으면 무늬로 우열을 가림</p>

        <h3>🀄 낼 수 있는 조합</h3>
        <p>싱글(1장) · 페어(2장) · 트리플(3장) · 5장 조합</p>
        <p>5장 족보(약→강): 스트레이트 &lt; 플러시 &lt; 풀하우스 &lt; 포카드 &lt; 스트레이트플러시</p>

        <h3>🔄 진행</h3>
        <p>앞 사람과 <b>같은 장수</b>로 <b>더 높은</b> 조합을 내거나 <b>패스</b>. 모두 패스하면 마지막에 낸 사람이 새로 시작(선)합니다.</p>

        <h3>🪙 정산 (승자 독식)</h3>
        <p>승자가 판돈을 모두 가져가고, 나머지는 <b>남은 타일 수</b>만큼 잃습니다. 손패에 <b>2</b>가 있으면 <b>2배</b>로 잃어요!</p>

        <h3>⏱ 시간 · 도우미</h3>
        <p>턴당 <b>30초</b>, 넘기면 자동 패스. <b>PAIR</b> 버튼은 낼 수 있는 조합을 자동 선택(다시 누르면 다음 조합)해 줍니다. 타일을 다시 탭하면 선택이 해제됩니다.</p>
      </div>
      <button class="btn" id="back" style="margin-top:12px">닫기</button>
    </div></div>`;
  app.querySelector("#back")!.addEventListener("click", renderMenu);
}

function renderLocalSetup() {
  app.innerHTML = `
    <div class="scene"><div class="panel narrow">
      <h1>Practice</h1>
      <p class="sub">봇과 연습 · 인원 수를 고르세요</p>
      <div class="count-row" id="seg">
        ${[3, 4, 5]
          .map(
            (n) =>
              `<button class="count-opt ${n === numPlayers ? "on" : ""}" data-n="${n}"><span class="cnum">${n}</span><span class="clbl">${n}인 플레이</span></button>`,
          )
          .join("")}
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
function renderLogin() {
  mode = "menu";
  app.innerHTML = `
    <div class="scene"><div class="panel narrow">
      <h1 style="font-size:38px;letter-spacing:4px">IDox</h1>
      <p class="sub">닉네임과 PIN으로 로그인하세요<br>코인은 계정에 저장됩니다</p>
      <label>닉네임</label>
      <input id="name" value="${netName}" maxlength="10" class="field" />
      <label>PIN (4자리 숫자)</label>
      <input id="pin" value="${netPin}" maxlength="4" inputmode="numeric" pattern="[0-9]*" placeholder="예: 1234" class="field" />
      <button class="btn" id="join" style="margin-top:6px">로그인</button>
      <p class="sub" id="neterr" style="margin-top:12px;color:#ef8a7a"></p>
    </div></div>`;

  // PIN 마스킹: 방금 입력한 글자만 보이고 다음 글자로 넘어가면 ●로 (실제값은 dataset.real)
  const pinInput = app.querySelector("#pin") as HTMLInputElement;
  let realPin = netPin;
  const maskPin = () => {
    const n = realPin.length;
    pinInput.value = n === 0 ? "" : "●".repeat(n - 1) + realPin[n - 1];
    pinInput.dataset.real = realPin;
  };
  pinInput.addEventListener("input", () => {
    const v = pinInput.value;
    if (v.length > realPin.length) {
      realPin = (realPin + v.slice(realPin.length).replace(/\D/g, "")).slice(0, 4);
    } else {
      realPin = realPin.slice(0, v.length);
    }
    maskPin();
  });
  maskPin();

  app.querySelector("#join")!.addEventListener("click", () => {
    netName = (app.querySelector("#name") as HTMLInputElement).value.trim() || "익명";
    netPin = (app.querySelector("#pin") as HTMLInputElement).dataset.real || "";
    if (!/^\d{4}$/.test(netPin)) {
      const err = app.querySelector("#neterr");
      if (err) err.textContent = "PIN은 4자리 숫자로 입력하세요";
      return;
    }
    localStorage.setItem("idox.name", netName);
    localStorage.setItem("idox.pin", netPin);
    connectOnline();
  });
}

function connectOnline() {
  mode = "online";
  lobby = null;
  view = null;
  net.onOpen = () => net.login(netName, netPin);
  net.onClose = () => {
    const err = app.querySelector("#neterr");
    if (err) err.textContent = "서버 연결이 끊겼습니다";
  };
  net.onMessage = handleServer;
  net.connect(defaultServerUrl());
}

function handleServer(m: ServerMsg) {
  switch (m.t) {
    case "loggedin":
      myCoins = m.coins;
      if (m.bonus) bonusNote = `🎁 매일 지원 코인 +${m.bonus} 지급! (코인이 0이어서)`;
      if (storeOpen) {
        storeNote = "구매가 완료되었습니다. 코인이 충전되었어요!";
        renderStore();
      } else if (!roomsView) {
        renderMenu(); // 로그인 성공 → 홈으로 (Play Now 흐름이 아닐 때)
      }
      break;
    case "rooms":
      lobby = null;
      view = null;
      if (roomsView) renderRoomList(m.list); // 홈에선 로그인 직후 자동 rooms 무시
      break;
    case "lobby":
      lobby = m;
      view = null;
      renderWaiting();
      break;
    case "state":
      view = m;
      myCoins = m.players[m.seat]?.coins ?? myCoins; // 방 목록 복귀 시 최신 잔액 유지
      selected.clear();
      message = "";
      renderGame();
      break;
    case "ended": {
      const mine = m.scores.find((r) => r.playerIndex === (view?.seat ?? -1));
      if (mine) myCoins = mine.coins;
      setTimeout(() => renderEndOnline(m.scores), 400);
      break;
    }
    case "error": {
      message = m.msg;
      const err = app.querySelector("#neterr");
      if (err) err.textContent = m.msg;
      else renderGame();
      break;
    }
  }
}

// ---------- 방 목록 ----------
function renderRoomList(list: RoomInfo[]) {
  const rows = list
    .map((r) => {
      const status = r.started ? `<span style="color:#ef8a7a">게임중</span>` : `${r.players}/${r.max}명`;
      const dis = r.started || r.players >= r.max;
      return `<div class="score-row roomrow ${dis ? "dis" : ""}" data-code="${r.code}" data-locked="${r.locked}">
        <span>${r.locked ? "🔒 " : ""}${r.name}</span>
        <span>${status}</span>
      </div>`;
    })
    .join("");
  storeOpen = false;
  const note = bonusNote ? `<p class="sub" style="color:var(--gold);margin-top:2px">${bonusNote}</p>` : "";
  bonusNote = "";
  app.innerHTML = `
    <div class="scene"><div class="panel">
      <div class="panel-head">
        <h1>방 목록</h1>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="coin-pill">🪙 ${myCoins}</span>
          <button class="btn get-coins" id="store">＋ GET COINS</button>
        </span>
      </div>
      <p class="sub"><b style="color:#eaf2ff">${netName}</b>님, 방에 입장하거나 새로 만드세요</p>
      ${note}
      <div class="roomlist">${rows || `<p class="sub" style="padding:14px 0">열린 방이 없어요. 새로 만들어 보세요!</p>`}</div>
      <button class="btn" id="create" style="margin-top:12px">+ 새 방 만들기</button>
      <div class="seg" style="margin-top:8px">
        <button id="refresh">새로고침</button>
        <button id="back">나가기</button>
      </div>
      <p class="sub" id="neterr" style="margin-top:8px;color:#ef8a7a"></p>
    </div></div>`;
  app.querySelector("#store")!.addEventListener("click", () => renderStore());
  app.querySelectorAll(".roomrow:not(.dis)").forEach((el) => {
    el.addEventListener("click", () => {
      const code = (el as HTMLElement).dataset.code!;
      const locked = (el as HTMLElement).dataset.locked === "true";
      const pw = locked ? window.prompt("방 비밀번호를 입력하세요") ?? "" : "";
      if (locked && pw === "") return;
      net.joinRoom(code, pw);
    });
  });
  app.querySelector("#create")!.addEventListener("click", () => {
    const pw = window.prompt("방 비밀번호 (없으면 비워두고 확인)") ?? "";
    net.createRoom(pw);
  });
  app.querySelector("#refresh")!.addEventListener("click", () => net.listRooms());
  app.querySelector("#back")!.addEventListener("click", () => {
    roomsView = false;
    renderMenu(); // 홈으로 (연결 유지)
  });
}

// ---------- 코인 상점 (구글 플레이 인앱 결제) ----------
function renderStore() {
  storeOpen = true;
  const avail = billingAvailable();
  const note = storeNote ? `<p class="sub" style="color:var(--gold);margin-top:6px">${storeNote}</p>` : "";
  storeNote = "";
  const packs = PACKS.map(
    (p) => `
      <div class="score-row pack">
        <span><b style="color:var(--gold);font-size:17px">${p.coins}🪙</b></span>
        <span>${p.price} &nbsp;<button class="btn mini buy" data-id="${p.id}" ${avail ? "" : "disabled"}>구매</button></span>
      </div>`,
  ).join("");
  app.innerHTML = `
    <div class="scene"><div class="panel narrow">
      <div class="panel-head">
        <h1>코인 상점</h1>
        <span class="coin-pill">🪙 ${myCoins}</span>
      </div>
      <p class="sub">${netName}님의 코인을 충전하세요</p>
      ${note}
      <div class="roomlist">${packs}</div>
      ${
        avail
          ? `<p class="sub" style="margin-top:10px;font-size:12px">구글 플레이로 안전하게 결제됩니다.</p>`
          : `<p class="sub" style="margin-top:10px;color:#ef8a7a;font-size:12px">구매는 설치된 앱(구글 플레이)에서만 가능합니다.</p>`
      }
      <button class="btn ghost" id="back" style="margin-top:12px">방 목록으로</button>
    </div></div>`;
  app.querySelectorAll(".buy").forEach((el) =>
    el.addEventListener("click", () => {
      storeNote = "결제를 진행합니다…";
      buyPack((el as HTMLElement).dataset.id!);
      renderStore();
    }),
  );
  app.querySelector("#back")!.addEventListener("click", () => {
    storeOpen = false;
    net.listRooms();
  });
}

function renderWaiting() {
  if (!lobby) return;
  const isHost = lobby.you === lobby.host;
  const list = lobby.players
    .map((p, i) => `<div class="score-row"><span>${p.isBot ? "🤖 " : "👤 "}${p.name}${i === lobby!.you ? " (나)" : ""}${i === lobby!.host ? " · 방장" : ""}</span></div>`)
    .join("");
  app.innerHTML = `
    <div class="scene"><div class="panel">
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
      <button class="btn ghost" id="leave" style="margin-top:10px">방 나가기 (목록으로)</button>
    </div></div>`;
  if (isHost) {
    app.querySelector("#addbot")!.addEventListener("click", () => net.addBot());
    app.querySelector("#rmbot")!.addEventListener("click", () => net.removeBot());
    app.querySelector("#start")!.addEventListener("click", () => net.start());
  }
  app.querySelector("#leave")!.addEventListener("click", () => net.leaveRoom());
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
  return tiles.map((t) => tileHTML(t, { small: true })).join("");
}

// ---------- 렌더: 게임판 (로컬/온라인 공용) ----------
function renderGame() {
  const board = mode === "local" ? (local ? localBoard() : null) : view ? onlineBoard() : null;
  if (!board) return;

  // 로컬 내 턴 15초 타이머 arm/clear
  if (mode === "local") {
    if (board.myTurn && localTurnTimer === null) {
      localDeadline = Date.now() + TURN_MS;
      localTurnTimer = window.setTimeout(onLocalTimeout, TURN_MS);
      board.turnDeadline = localDeadline;
    } else if (!board.myTurn && localTurnTimer !== null) {
      clearLocalTimer();
      localDeadline = 0;
    }
  }
  turnDeadlineMs = board.turnDeadline;
  activeIsMe = board.myTurn;

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
        <div class="seat-timer"></div>
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
      <div class="hand-row">
        <div class="hand" id="hand">${hand}</div>
        <span class="my-timer" id="my-timer"></span>
      </div>
      <div class="actions">
        <button class="btn ghost" id="pass" ${board.myTurn && board.lastPlayCombo ? "" : "disabled"}>패스</button>
        <button class="btn" id="play" ${board.myTurn && canPlay ? "" : "disabled"}>내기</button>
        <div class="action-side">
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
    if (mode === "online") net.leaveRoom(); // 방만 떠나고 연결은 유지
    roomsView = false;
    renderMenu(); // 홈으로
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
    net.leaveRoom(); // 방만 떠나고 연결 유지
    roomsView = false;
    renderMenu(); // 홈으로
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

// 모든 화면을 가로 캔버스로 통일. 폰이 세로면 90도 회전해 항상 가로로 보이게.
const LAND_W = 820, LAND_H = 460;
function fitScale() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const portrait = vh > vw;
  app.style.width = LAND_W + "px";
  app.style.height = LAND_H + "px";
  if (portrait) {
    const s = Math.min(vh / LAND_W, vw / LAND_H);
    app.style.transform = `translate(-50%, -50%) rotate(90deg) scale(${s})`;
  } else {
    const s = Math.min(vw / LAND_W, vh / LAND_H);
    app.style.transform = `translate(-50%, -50%) rotate(0deg) scale(${s})`;
  }
}
window.addEventListener("resize", fitScale);
window.addEventListener("orientationchange", fitScale);
new MutationObserver(fitScale).observe(app, { childList: true }); // 화면 전환 시 방향 재계산
fitScale();

setInterval(updateTimers, 250); // 턴 카운트다운 갱신

initBilling((productId) => net.buyCoins(productId)); // 결제 승인 → 서버에 코인 지급 요청

// 시작: 로그인 화면부터 (로그인 성공 시 홈으로)
renderLogin();
