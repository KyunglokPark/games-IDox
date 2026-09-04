// 렉시오 게임 상태 및 진행 로직 (순수 함수형 리듀서 스타일)
import { Combo, Tile } from "./types.ts";
import { buildDeck, ruleForPlayers, sortByStrength, tileId } from "./tiles.ts";
import { beats, evaluate } from "./combos.ts";
import { mulberry32, shuffle } from "./rng.ts";

export interface Player {
  id: string;
  name: string;
  isBot: boolean;
  hand: Tile[];
}

export interface LastPlay {
  playerIndex: number;
  combo: Combo;
}

export type Phase = "playing" | "ended";

export interface GameState {
  players: Player[];
  turn: number; // 현재 차례 플레이어 인덱스
  lastPlay: LastPlay | null; // 받아쳐야 할 조합 (null = 선이 자유롭게 냄)
  passed: boolean[]; // 이번 리드 이후 패스한 플레이어
  finishedOrder: number[]; // 손패를 먼저 턴 순서
  phase: Phase;
  log: string[];
}

export interface DealOptions {
  players: { id: string; name: string; isBot: boolean }[];
  seed?: number;
}

/** 새 게임 시작: 덱 셔플 후 분배, 구름3 보유자를 선으로 지정 */
export function deal(opts: DealOptions): GameState {
  const n = opts.players.length;
  const { perPlayer } = ruleForPlayers(n);
  const seed = opts.seed ?? (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const rand = mulberry32(seed);
  const deck = shuffle(buildDeck(n), rand);

  const players: Player[] = opts.players.map((p, i) => ({
    ...p,
    hand: sortByStrength(deck.slice(i * perPlayer, (i + 1) * perPlayer)),
  }));

  // 선: 구름3(가장 약한 타일) 보유자
  const cloudThreeId = tileId({ num: 3, suit: 0 });
  let starter = players.findIndex((p) => p.hand.some((t) => tileId(t) === cloudThreeId));
  if (starter < 0) starter = 0; // 안전장치

  return {
    players,
    turn: starter,
    lastPlay: null,
    passed: new Array(n).fill(false),
    finishedOrder: [],
    phase: "playing",
    log: [`${players[starter].name}(이)가 선입니다 (구름3 보유)`],
  };
}

/** 다음(아직 손패 있는) 플레이어로 이동 */
function nextActive(state: GameState, from: number): number {
  const n = state.players.length;
  let i = from;
  for (let step = 0; step < n; step++) {
    i = (i + 1) % n;
    if (state.players[i].hand.length > 0) return i;
  }
  return from;
}

export interface MoveResult {
  ok: boolean;
  error?: string;
  state: GameState;
}

/** 플레이어가 손패에 해당 타일들을 모두 갖고 있는지 */
function handHasAll(hand: Tile[], tiles: Tile[]): boolean {
  const pool = new Map<string, number>();
  for (const t of hand) pool.set(tileId(t), (pool.get(tileId(t)) ?? 0) + 1);
  for (const t of tiles) {
    const id = tileId(t);
    const c = pool.get(id) ?? 0;
    if (c <= 0) return false;
    pool.set(id, c - 1);
  }
  return true;
}

function removeTiles(hand: Tile[], tiles: Tile[]): Tile[] {
  const remove = new Set(tiles.map(tileId));
  const counts = new Map<string, number>();
  for (const t of tiles) counts.set(tileId(t), (counts.get(tileId(t)) ?? 0) + 1);
  const out: Tile[] = [];
  for (const t of hand) {
    const id = tileId(t);
    if (remove.has(id) && (counts.get(id) ?? 0) > 0) {
      counts.set(id, counts.get(id)! - 1);
      continue;
    }
    out.push(t);
  }
  return out;
}

/** 타일 조합 내기. 규칙 위반 시 ok:false 로 상태 변경 없이 반환 */
export function play(state: GameState, playerIndex: number, tiles: Tile[]): MoveResult {
  if (state.phase !== "playing") return fail(state, "이미 종료된 게임입니다");
  if (playerIndex !== state.turn) return fail(state, "당신의 차례가 아닙니다");
  if (tiles.length === 0) return fail(state, "낼 타일을 선택하세요");

  const player = state.players[playerIndex];
  if (!handHasAll(player.hand, tiles)) return fail(state, "손패에 없는 타일입니다");

  const combo = evaluate(tiles);
  if (!combo) return fail(state, "유효하지 않은 조합입니다");

  if (state.lastPlay) {
    if (combo.count !== state.lastPlay.combo.count) {
      return fail(state, `직전 조합과 장수가 달라요 (${state.lastPlay.combo.count}장 필요)`);
    }
    if (!beats(combo, state.lastPlay.combo)) {
      return fail(state, "직전 조합보다 약합니다");
    }
  }

  // 적용
  const players = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hand: removeTiles(p.hand, tiles) } : p,
  );
  const log = [...state.log, `${player.name}: ${describeCombo(combo)}`];
  const finishedOrder = [...state.finishedOrder];

  const emptied = players[playerIndex].hand.length === 0;
  if (emptied) {
    finishedOrder.push(playerIndex);
    log.push(`🎉 ${player.name}(이)가 손패를 모두 털었습니다! 라운드 종료`);
  }

  const next: GameState = {
    ...state,
    players,
    lastPlay: { playerIndex, combo },
    passed: new Array(state.players.length).fill(false),
    finishedOrder,
    log,
    turn: emptied ? state.turn : -1, // 아래에서 결정
    phase: emptied ? "ended" : "playing",
  };

  if (!emptied) next.turn = nextActive(next, playerIndex);
  return { ok: true, state: next };
}

/** 패스. 선(lastPlay 없음)일 때는 패스 불가. */
export function pass(state: GameState, playerIndex: number): MoveResult {
  if (state.phase !== "playing") return fail(state, "이미 종료된 게임입니다");
  if (playerIndex !== state.turn) return fail(state, "당신의 차례가 아닙니다");
  if (!state.lastPlay) return fail(state, "선은 패스할 수 없습니다");

  const passed = [...state.passed];
  passed[playerIndex] = true;
  const log = [...state.log, `${state.players[playerIndex].name}: 패스`];

  // 마지막으로 낸 사람을 제외한 모든 활성 플레이어가 패스하면 그 사람이 새 선
  const leader = state.lastPlay.playerIndex;
  const everyoneElsePassed = state.players.every(
    (p, i) => i === leader || p.hand.length === 0 || passed[i],
  );

  if (everyoneElsePassed) {
    return {
      ok: true,
      state: {
        ...state,
        passed: new Array(state.players.length).fill(false),
        lastPlay: null,
        turn: leader,
        log: [...log, `${state.players[leader].name}(이)가 새 선입니다`],
      },
    };
  }

  return { ok: true, state: { ...state, passed, turn: nextActive(state, playerIndex), log } };
}

function fail(state: GameState, error: string): MoveResult {
  return { ok: false, error, state };
}

function describeCombo(c: Combo): string {
  const tiles = c.tiles.map((t) => `${["구름", "별", "달", "해"][t.suit]}${t.num}`).join(" ");
  return `[${c.type}] ${tiles}`;
}

// ---------- 점수 ----------

export interface ScoreRow {
  playerIndex: number;
  name: string;
  tilesLeft: number;
  effective: number; // 2 페널티 적용 후
  score: number;
}

/**
 * 라운드 점수 계산 (제로섬).
 * 2 타일 보유 시 남은 타일수를 2배로 간주.
 * score_i = Σ_{j≠i} eff_j - (n-1) * eff_i
 */
export function computeScores(state: GameState): ScoreRow[] {
  const n = state.players.length;
  const eff = state.players.map((p) => {
    const left = p.hand.length;
    const hasTwo = p.hand.some((t) => t.num === 2);
    return hasTwo ? left * 2 : left;
  });
  const total = eff.reduce((a, b) => a + b, 0);

  return state.players.map((p, i) => ({
    playerIndex: i,
    name: p.name,
    tilesLeft: p.hand.length,
    effective: eff[i],
    score: total - eff[i] - (n - 1) * eff[i],
  }));
}
