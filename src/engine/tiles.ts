// 타일 순위/식별 유틸
import { Suit, Tile, SUIT_NAMES } from "./types.ts";

/**
 * 숫자 강함 순위: 3 < 4 < ... < 15 < 1 < 2
 * 3 -> 0, 4 -> 1, ..., 15 -> 12, 1 -> 13, 2 -> 14
 */
export function numRank(num: number): number {
  if (num === 1) return 13;
  if (num === 2) return 14;
  return num - 3; // 3..15 -> 0..12
}

/** 타일 전체 강함(싱글 비교용): 숫자순위 우선, 같으면 무늬순위. 0~59 */
export function tileStrength(t: Tile): number {
  return numRank(t.num) * 4 + t.suit;
}

/** 고유 식별자 "num-suit" (예: 3-0) */
export function tileId(t: Tile): string {
  return `${t.num}-${t.suit}`;
}

export function tileFromId(id: string): Tile {
  const [num, suit] = id.split("-").map(Number);
  return { num, suit: suit as Suit };
}

export function tileLabel(t: Tile): string {
  return `${SUIT_NAMES[t.suit]}${t.num}`;
}

/** 강함 오름차순 정렬 (원본 불변) */
export function sortByStrength(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => tileStrength(a) - tileStrength(b));
}

/**
 * 인원별 사용 규칙.
 * 3인: 1~9(각 무늬) → 36장, 12장씩
 * 4인: 1~13 → 52장, 13장씩
 * 5인: 1~15 → 60장, 12장씩
 */
export function ruleForPlayers(n: number): { maxNum: number; perPlayer: number } {
  switch (n) {
    case 3:
      return { maxNum: 9, perPlayer: 12 };
    case 4:
      return { maxNum: 13, perPlayer: 13 };
    case 5:
      return { maxNum: 15, perPlayer: 12 };
    default:
      throw new Error(`지원하지 않는 인원수: ${n} (3~5인만 가능)`);
  }
}

/** 해당 인원수에서 사용하는 전체 타일 덱 생성 */
export function buildDeck(numPlayers: number): Tile[] {
  const { maxNum } = ruleForPlayers(numPlayers);
  const deck: Tile[] = [];
  for (let num = 1; num <= maxNum; num++) {
    for (const suit of [Suit.Cloud, Suit.Star, Suit.Moon, Suit.Sun]) {
      deck.push({ num, suit });
    }
  }
  return deck;
}
