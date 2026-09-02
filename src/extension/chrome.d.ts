// minimal ambient types สำหรับ chrome.devtools API ที่ extension ใช้
// (เขียนเองแทนการติดตั้ง @types/chrome เพื่อให้โปรเจกต์ไม่มี dependency เกินจำเป็น)

interface ChromeDevToolsPanels {
  create(title: string, iconPath: string | null, pagePath: string, callback?: (panel: unknown) => void): void;
}

interface ChromeDevToolsInspectedWindow {
  eval(expression: string, callback: (result: unknown, isException: boolean) => void): void;
}

interface ChromeDevToolsNetwork {
  onNavigated: {
    addListener(callback: (url: string) => void): void;
  };
}

declare const chrome: {
  devtools: {
    panels: ChromeDevToolsPanels;
    inspectedWindow: ChromeDevToolsInspectedWindow;
    network: ChromeDevToolsNetwork;
  };
};
