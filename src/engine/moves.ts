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
const isRed2 = (t: Tile) => t.num === 2 && t.suit === 3; // 해2 = 최강 싱글
const usesRed2 = (c: Combo) => c.tiles.some(isRed2);
const inPair = (hand: Tile[], t: Tile) => hand.filter((x) => x.num === t.num).length >= 2;

/**
 * 전략형 봇.
 * - 막판(상대 1~2장): 상대가 못 받는 조합(5장/트리플) 또는 높은 싱글로 선을 지켜 막음.
 * - 붉은2는 선 되찾기용으로 아껴 페어/플러시/조합에 쓰지 않음.
 * - 잡패 싱글부터 버리고 페어는 최대한 보류.
 * - 이번 턴에 다 털 수 있으면 승리 우선.
 */
export function botMove(state: GameState, playerIndex: number): Combo | null {
  const hand = state.players[playerIndex].hand;
  const others = state.players.filter((p, i) => i !== playerIndex && p.hand.length > 0);
  const danger = others.length > 0 && Math.min(...others.map((p) => p.hand.length)) <= 2;

  if (!state.lastPlay) return chooseLead(hand, danger);

  const need = state.lastPlay.combo;
  const options = legalMoves(state, playerIndex).sort(keyAsc);
  if (!options.length) return null; // 패스

  if (need.count === 1) {
    if (danger) return options[options.length - 1]; // 막판: 최고 싱글로 선 뺏어 막기
    // 평상시: 붉은2 아끼고, 페어 깨지 않는 싱글, 최소 오버킬
    const notRed2 = options.filter((c) => !usesRed2(c));
    const notPair = notRed2.filter((c) => !inPair(hand, c.tiles[0]));
    return notPair[0] ?? notRed2[0] ?? options[0];
  }
  return options[0]; // 페어/트리플/5장: 최소로 이기기
}

function chooseLead(hand: Tile[], danger: boolean): Combo | null {
  const all = allCombos(hand);
  if (!all.length) return null;

  // 이번에 손패를 다 털 수 있으면 승리
  const win = all.filter((c) => c.count === hand.length).sort(keyAsc)[0];
  if (win) return win;

  const byCount = (n: number) => all.filter((c) => c.count === n).sort(keyAsc);
  const fives = byCount(5), triples = byCount(3), pairs = byCount(2), singles = byCount(1);

  if (danger) {
    // 상대 1~2장: 상대가 못 받는 조합으로 선 유지
    if (fives.length) return fives[0];
    if (triples.length) return triples[0];
    return singles[singles.length - 1]; // 최고 싱글로 막기 (해2면 무적)
  }

  // 평상시: 붉은2 보존, 페어 보류. 5장 → 트리플 → 낮은 잡패 싱글 → 페어 → 최후
  const fivesNoRed2 = fives.filter((c) => !usesRed2(c));
  const singlesNoRed2 = singles.filter((c) => !usesRed2(c));
  const pairsNoRed2 = pairs.filter((c) => !usesRed2(c));
  return fivesNoRed2[0] ?? triples[0] ?? singlesNoRed2[0] ?? pairsNoRed2[0] ?? all.sort(keyAsc)[0];
}
