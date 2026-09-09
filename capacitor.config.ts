import type { CapacitorConfig } from "@capacitor/cli";

// IDox 안드로이드 앱(Capacitor) 설정. webDir=dist(빌드 결과)를 앱에 번들.
const config: CapacitorConfig = {
  appId: "com.idoit.idox",
  appName: "IDox",
  webDir: "dist",
  android: {
    // 기본은 웹의 화면 방향 로직(폼=세로/게임=가로)에 맡김
    backgroundColor: "#1f3d2b",
  },
};

export default config;
