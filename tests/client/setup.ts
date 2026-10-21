import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { queryClient } from "@/lib/session";
import { installFetchMock } from "./fetch-mock";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => undefined;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => undefined;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

function storageWorks(storage: Storage | undefined): storage is Storage {
  if (!storage || typeof storage.clear !== "function" || typeof storage.setItem !== "function") return false;
  try {
    storage.setItem("__friendform", "1");
    storage.removeItem("__friendform");
    return true;
  } catch {
    return false;
  }
}

function installStorage(name: "localStorage" | "sessionStorage"): Storage {
  const current = window[name];
  if (storageWorks(current)) return current;
  const storage = memoryStorage();
  Object.defineProperty(window, name, { configurable: true, value: storage });
  Object.defineProperty(globalThis, name, { configurable: true, value: storage });
  return storage;
}

beforeEach(() => {
  installFetchMock();
  queryClient.clear();
  installStorage("localStorage").clear();
  installStorage("sessionStorage").clear();
  document.documentElement.classList.remove("dark");
  window.history.pushState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
