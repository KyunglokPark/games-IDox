// 합법 수 열거 (봇 및 UI 힌트용)
import { Combo, Tile } from "./types.ts";
import { evaluate, beats } from "./combos.ts";
import { GameState } from "./game.ts";

/** k개 조합 열거 */
function combinations<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = arr.length;
  if (k > n || k <= 0) return out;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.map((i) => arr[i]));
    let p = k - 1;
    while (p >= 0 && idx[p] === n - k + p) p--;
    if (p < 0) break;
    idx[p]++;
    for (let j = p + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

/** 손패에서 만들 수 있는 모든 유효 조합 (지정 장수 또는 전체) */
export function allCombos(hand: Tile[], count?: number): Combo[] {
  const sizes = count ? [count] : [1, 2, 3, 5];
  const out: Combo[] = [];
  for (const k of sizes) {
    for (const group of combinations(hand, k)) {
      const c = evaluate(group);
      if (c) out.push(c);
    }
  }
  return out;
}

/** 현재 상태에서 해당 플레이어의 합법 수(낼 수 있는 타일 묶음) 목록 */
export function legalMoves(state: GameState, playerIndex: number): Combo[] {
  const hand = state.players[playerIndex].hand;
  if (!state.lastPlay) return allCombos(hand); // 선: 아무 조합
  const need = state.lastPlay.combo;
  return allCombos(hand, need.count).filter((c) => beats(c, need));
}

/** key 사전식 오름차순 정렬용 비교 */
function keyAsc(a: Combo, b: Combo): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.key.length, b.key.length);
  for (let i = 0; i < len; i++) {
    const d = (a.key[i] ?? -1) - (b.key[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/** 봇 전략 파라미터 (시뮬레이션으로 튜닝) */
export interface BotParams {
  leadOrder: number[]; // 선일 때 시도할 조합 장수 우선순위 (같은 장수 내 최저부터)
  blockEndgame: boolean; // 막판(상대 소수) 방어: 높게 받아쳐 상대가 못 나가게
  endgameTiles: number; // 상대가 이 장수 이하면 막판
}
// 시뮬 검증(수만 판): 리드 5→3→2→1, 응수 최소 오버킬(강한 패 자연 보존). 막판 방어는 오히려 손해라 끔.
export const SMART: BotParams = { leadOrder: [5, 3, 2, 1], blockEndgame: false, endgameTiles: 2 };

/**
 * 전략형 봇.
 * - 리드: leadOrder대로 낮은 조합부터 흘려 손패를 빨리 줄임(다장수 우선).
 * - 응수: 최소 오버킬(가장 낮게 이김) → 2 등 강한 패는 자연히 보존, 필요할 때만 나감.
 * - 막판(상대 소수): 최대한 높게 받아쳐 상대가 못 나가게 방어.
 * - 이번에 다 털 수 있으면 무조건 승리.
 */
export function botMove(state: GameState, idx: number, P: BotParams = SMART): Combo | null {
  const hand = state.players[idx].hand;
  const others = state.players.filter((p, i) => i !== idx && p.hand.length > 0);
  const minOpp = others.length ? Math.min(...others.map((p) => p.hand.length)) : 99;

  if (!state.lastPlay) return chooseLead(hand, P);

  const need = state.lastPlay.combo;
  const opts = legalMoves(state, idx).sort(keyAsc);
  if (!opts.length) return null; // 패스

  if (need.count === hand.length) return opts[0]; // 내면 승리
  if (P.blockEndgame && minOpp <= P.endgameTiles) return opts[opts.length - 1]; // 막판: 높게 막기
  return opts[0]; // 최소 오버킬
}

function chooseLead(hand: Tile[], P: BotParams): Combo | null {
  const all = allCombos(hand);
  if (!all.length) return null;
  const win = all.filter((c) => c.count === hand.length).sort(keyAsc)[0];
  if (win) return win; // 다 털어서 승리
  for (const cnt of P.leadOrder) {
    const c = all.filter((x) => x.count === cnt).sort(keyAsc)[0];
    if (c) return c;
  }
  return all.sort(keyAsc)[0];
}

/** 비교용 단순 봇: 리드=최저 싱글, 응수=최소 오버킬 */
export function botMoveBaseline(state: GameState, idx: number): Combo | null {
  const hand = state.players[idx].hand;
  if (!state.lastPlay) {
    return allCombos(hand, 1).sort(keyAsc)[0] ?? allCombos(hand).sort(keyAsc)[0] ?? null;
  }
  return legalMoves(state, idx).sort(keyAsc)[0] ?? null;
}
