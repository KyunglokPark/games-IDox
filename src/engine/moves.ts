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

/**
 * 간단한 봇: 반환 null = 패스.
 * - 선일 때: 가장 약한 싱글부터 흘려보낸다.
 * - 받아칠 때: 오버킬 최소화(가장 약하게 이기는 수), 없으면 패스.
 */
export function botMove(state: GameState, playerIndex: number): Combo | null {
  const hand = state.players[playerIndex].hand;

  if (!state.lastPlay) {
    // 선: 가장 낮은 싱글 (없으면 가장 낮은 조합)
    const singles = allCombos(hand, 1).sort(keyAsc);
    if (singles.length) return singles[0];
    return allCombos(hand).sort(keyAsc)[0] ?? null;
  }

  const options = legalMoves(state, playerIndex).sort(keyAsc);
  return options[0] ?? null;
}
