// 구글 플레이 인앱 결제 얇은 래퍼 (cordova-plugin-purchase / CdvPurchase).
// 네이티브 앱에서만 window.CdvPurchase 가 주입됨 → 브라우저/개발에선 available=false.
export interface Pack {
  id: string; // Play Console 상품 ID (서버 COIN_PACKS 와 일치해야 함)
  coins: number;
  price: string; // 표시용(실제 청구가는 Play Console 설정값)
}

export const PACKS: Pack[] = [
  { id: "coins_100", coins: 100, price: "₩2,000" },
  { id: "coins_1000", coins: 1000, price: "₩10,000" },
  { id: "coins_5000", coins: 5000, price: "₩30,000" },
];

// CdvPurchase 전역(네이티브 앱에서 플러그인이 주입)
type AnyStore = any;
let store: AnyStore | null = null;

export function billingAvailable(): boolean {
  return typeof (window as any).CdvPurchase !== "undefined";
}

// 앱 시작 시 1회 호출. 결제 승인 시 onApproved(productId) 콜백(→ 서버에 지급 요청).
export function initBilling(onApproved: (productId: string) => void) {
  if (store || !billingAvailable()) return;
  try {
    const CdvPurchase = (window as any).CdvPurchase;
    const { ProductType, Platform } = CdvPurchase;
    store = CdvPurchase.store;
    store.register(
      PACKS.map((p) => ({ id: p.id, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY })),
    );
    store
      .when()
      .approved((tx: any) => {
        for (const p of tx.products) onApproved(p.id);
        tx.finish(); // 소비성 상품: 즉시 소비하여 재구매 가능하게
      });
    store.initialize([Platform.GOOGLE_PLAY]);
  } catch (e) {
    console.error("[billing] init 실패:", e);
  }
}

// 구매 시작 (결제 다이얼로그 표시)
export function buy(productId: string) {
  if (!store) return;
  const product = store.get(productId);
  const offer = product?.getOffer?.();
  if (offer) offer.order();
}
