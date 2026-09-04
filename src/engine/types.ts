// 렉시오 규칙 엔진 - 핵심 타입 정의
// 클라이언트/서버가 공유하는 순수 로직 (DOM/네트워크 의존 없음)

/** 무늬. 값이 클수록 강함: 구름(0) < 별(1) < 달(2) < 해(3) */
export enum Suit {
  Cloud = 0, // 구름
  Star = 1, // 별
  Moon = 2, // 달
  Sun = 3, // 해
}

export const SUIT_NAMES: Record<Suit, string> = {
  [Suit.Cloud]: "구름",
  [Suit.Star]: "별",
  [Suit.Moon]: "달",
  [Suit.Sun]: "해",
};

/** 타일 하나. num 은 1~15 의 face 값. */
export interface Tile {
  num: number; // 1~15
  suit: Suit;
}

/** 조합 종류. 5장 조합은 category 순서로 우열을 비교한다. */
export enum ComboType {
  Single = "single",
  Pair = "pair",
  Triple = "triple",
  Straight = "straight",
  Flush = "flush",
  FullHouse = "fullhouse",
  FourKind = "fourkind",
  StraightFlush = "straightflush",
}

/**
 * 평가된 조합.
 * - count: 타일 장수 (1/2/3/5). 서로 다른 장수의 조합은 비교 불가.
 * - category: 5장 조합의 족보 순위(스트레이트0 < 플러시1 < 풀하우스2 < 포카드3 < 스플4).
 *             1/2/3장 조합은 각 장수 내에서 유일하므로 0.
 * - key: 같은 category 내에서 우열을 가리는 사전식 비교 배열.
 */
export interface Combo {
  type: ComboType;
  count: number;
  category: number;
  key: number[];
  tiles: Tile[];
}
