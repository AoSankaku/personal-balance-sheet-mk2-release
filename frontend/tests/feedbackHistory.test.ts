import { afterEach, describe, expect, test } from "bun:test";
import {
  clearFeedback,
  getFeedbackSnapshot,
  getFeedbackHistorySnapshot,
  showFeedback,
} from "../src/lib/feedback";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

function browser() {
  let timeout: (() => void) | undefined;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    location: { pathname: "/input", search: "" },
    setTimeout: (callback: () => void) => { timeout = callback; return 1; },
    clearTimeout: () => {},
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    title: "入力 | Balance Sheet",
    querySelectorAll: () => [{ textContent: "まとめて入力" }],
  } });
  return { expire: () => timeout?.() };
}

afterEach(() => {
  clearFeedback();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("bottom feedback history integration", () => {
  test("keeps the exact warning and originating screen after the transient notification expires", () => {
    const page = browser();
    showFeedback({ message: "仕訳は保存されましたが、カード明細の完了処理に失敗しました。", color: "yellow" });
    expect(getFeedbackSnapshot()?.message).toContain("仕訳は保存");
    page.expire();
    expect(getFeedbackSnapshot()).toBeNull();
    expect(getFeedbackHistorySnapshot()[0]).toMatchObject({
      message: "仕訳は保存されましたが、カード明細の完了処理に失敗しました。",
      color: "yellow", path: "/input", screen: "入力 | Balance Sheet / まとめて入力",
    });
  });

  test("records explicit action and error details, and dismissal retains history", () => {
    browser();
    showFeedback({
      message: "Card statement completion failed", color: "yellow",
      context: { path: "/input", screen: "Input / Bulk entry", action: "Complete Card A / 2026-08", details: "statement_not_ready" },
    });
    clearFeedback();
    expect(getFeedbackHistorySnapshot()[0]).toMatchObject({
      action: "Complete Card A / 2026-08", details: "statement_not_ready",
      path: "/input", screen: "Input / Bulk entry",
    });
  });

  test("records rapid notifications separately and evicts everything beyond the most recent 50", () => {
    browser();
    for (let index = 0; index < 55; index++) showFeedback({ message: `notice-${index}` });
    const history = getFeedbackHistorySnapshot();
    expect(history).toHaveLength(50);
    expect(history[0]?.message).toBe("notice-54");
    expect(history.at(-1)?.message).toBe("notice-5");
  });
});
