# IDox 구글 플레이 출시 가이드 (Capacitor)

웹앱을 **Capacitor**로 감싸 안드로이드 앱(AAB)으로 만들어 구글 플레이에 올립니다.
웹 자산(`dist/`)을 앱에 **번들**하므로 오프라인에서도 화면이 뜨고, 온라인 대전은 서버(`wss://lexio-server.onrender.com`)에 접속합니다.

> ⚠️ 이 저장소가 실행되는 환경엔 Android SDK가 없어 **AAB는 여기서 못 만듭니다.**
> 아래는 **본인 PC(Android Studio)**에서 하는 절차입니다.

## 0. 준비물 (1회)
- **Android Studio** 설치 (JDK 포함)
- **Google Play 개발자 계정** — [play.google.com/console](https://play.google.com/console) 가입 (**$25 1회 등록비**)
- **앱 아이콘** `resources/icon.png` (1024×1024 PNG 1장) — 원하는 로고

## 1. Capacitor 설치 & 안드로이드 프로젝트 생성 (1회)
```bash
cd /mnt/d/Source/IDOIT/Games/IDox
npm install                       # capacitor 포함 설치

# 웹 빌드 (서버 주소 주입!) — 온라인 대전이 배포 서버에 붙게
VITE_SERVER_URL="wss://lexio-server.onrender.com" npm run build

npx cap add android               # android/ 프로젝트 생성
npx cap sync android              # dist → 앱에 복사
```

## 2. 앱 아이콘 (권장)
```bash
mkdir -p resources && cp <내로고 1024x1024>.png resources/icon.png
npm install -D @capacitor/assets
npx @capacitor/assets generate --android   # 아이콘/스플래시 자동 생성
```

## 3. AAB 빌드 (Android Studio)
```bash
npx cap open android              # Android Studio 로 android/ 열기
```
Android Studio에서:
1. 상단 메뉴 **Build → Generate Signed Bundle / APK → Android App Bundle**
2. **키스토어 생성**(최초 1회): Create new… → 파일·비밀번호·별칭 입력 → **이 키스토어 파일과 비밀번호는 절대 잃어버리지 마세요** (분실 시 앱 업데이트 불가)
3. **release** 선택 → Finish → `android/app/release/app-release.aab` 생성

## 4. 구글 플레이 콘솔 업로드
1. [Play Console](https://play.google.com/console) → **앱 만들기** (이름 `IDox`, 게임, 무료)
2. 좌측 **프로덕션 → 새 버전 만들기** → 위 **`.aab`** 업로드
3. **스토어 등록정보**: 짧은 설명, 자세한 설명, 스크린샷(폰 최소 2장), 아이콘(512×512), 그래픽 이미지(1024×500)
4. **콘텐츠 등급** 설문, **개인정보처리방침** URL(간단한 페이지 필요), **데이터 보안** 설문
5. 검토 제출 → 승인(보통 며칠) 후 게시

## 앱 업데이트할 때
```bash
VITE_SERVER_URL="wss://lexio-server.onrender.com" npm run build
npx cap sync android
```
→ Android Studio에서 `android/app/build.gradle` 의 **versionCode 를 +1**, versionName 갱신 → 다시 Signed Bundle 생성 → Play Console에 새 버전 업로드.

## 메모
- **appId**: `com.idoit.idox` (`capacitor.config.ts`). **최초 출시 후엔 변경 불가**하니 지금 바꾸려면 출시 전에.
- 서버가 필요한 건 **온라인 대전**뿐. **봇과 연습**은 앱 단독으로 동작.
- `android/`, `resources/` 는 빌드 산출물/자산이라 `.gitignore`에 추가하는 걸 권장(선택).

---

# 코인 인앱 결제 (구글 플레이 결제)

코인 상점은 **구글 플레이 인앱 결제(cordova-plugin-purchase)**로 동작합니다.
결제가 승인되면 앱이 서버에 `buyCoins`를 보내고, **서버가 상품ID→코인**으로 지급(온라인 계정 잔액에 저장)합니다.

## 상품 (Play Console에 등록해야 함)
상점 상품ID는 코드(`src/billing.ts`)·서버(`server/index.ts` `COIN_PACKS`)와 **정확히 일치**해야 합니다:

| 상품 ID | 지급 코인 | 가격(설정 예) |
|---|---|---|
| `coins_100` | 100 | ₩2,000 |
| `coins_1000` | 1,000 | ₩10,000 |
| `coins_5000` | 5,000 | ₩30,000 |

## 1. 플러그인 반영 (1회, AAB 다시 빌드 전에)
```bash
cd /mnt/d/Source/IDOIT/Games/IDox
npm install                       # cordova-plugin-purchase 설치됨
VITE_SERVER_URL="wss://lexio-server.onrender.com" npm run build
npx cap sync android              # 결제 플러그인을 android/ 에 반영
```
→ 이후 Android Studio에서 다시 **Signed Bundle(AAB)** 생성.

## 2. Play Console에서 상품 등록
1. 앱 선택 → **수익 창출 → 상품 → 인앱 상품**
2. **상품 만들기** → 위 표의 **상품 ID 3개**를 각각 생성(유형: 관리 상품/소비성)
3. 각 상품에 이름·가격(₩2,000 / ₩10,000 / ₩30,000) 설정 → **활성화**
4. (인앱 상품을 쓰려면 앱이 최소 **내부 테스트 트랙**에 한 번 업로드되어 있어야 합니다)

## 3. 테스트 (실제 청구 없이)
1. Play Console → **설정 → 라이선스 테스트** 에 본인 구글 계정 추가
2. 앱을 **내부 테스트 트랙**에 올리고, 그 계정으로 설치
3. 상점에서 구매 → 테스트 결제(실제 청구 안 됨)로 코인 충전 확인

## 4. (권장) 서버 영수증 검증
현재 서버는 클라이언트의 `buyCoins`를 신뢰해 코인을 지급합니다(친구용으로는 충분).
악용을 막으려면 **구매 토큰을 구글 Play Developer API로 검증** 후 지급하도록 강화하세요:
- Google Cloud에서 **서비스 계정** 생성 → Play Console에 권한 부여
- 앱이 `buyCoins`에 `purchaseToken`을 함께 전송 → 서버가 `purchases.products.get`로 검증 → 통과 시에만 지급
- (연동 지점: `server/index.ts` 의 `buyCoins` 핸들러)

## 메모
- 결제는 **설치된 앱**에서만 동작합니다. 브라우저/개발 화면에선 상점 버튼이 비활성(“앱에서만 구매 가능”)으로 보입니다.
- 구매 코인은 **온라인 로그인 계정(닉네임)** 잔액에 저장됩니다(Upstash). 봇 연습 모드의 코인과는 별개입니다.
