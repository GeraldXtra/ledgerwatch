import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { APP_RETURN_BASE, appReturnLink, parseSignInHash, signInHashOf, wantsAppReturn } from "../signInReturn";
import { inNativeApp, onAppUrlOpen } from "../../api/nativeApp";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeApp({ launchUrl } = {}) {
  const listeners = [];
  const App = {
    addListener: (name, fn) => {
      listeners.push({ name, fn });
      return Promise.resolve({ remove: () => listeners.splice(listeners.indexOf(fn), 1) });
    },
    getLaunchUrl: () => Promise.resolve(launchUrl ? { url: launchUrl } : undefined),
  };
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { App } } });
  return {
    fire: (url) => listeners.filter((l) => l.name === "appUrlOpen").forEach((l) => l.fn({ url })),
  };
}

describe("LW-166 — the sign-in return the Android app receives", () => {
  it("reads the token, challenge, error and nonce from a sign-in hash, and nothing from anything else", () => {
    expect(parseSignInHash("#token=abc&n=xyz")).toMatchObject({ token: "abc", nonce: "xyz", challenge: "", error: "" });
    expect(parseSignInHash("challenge=c1&n=xyz")).toMatchObject({ challenge: "c1", nonce: "xyz" });
    expect(parseSignInHash("error=Google+sign+in+was+cancelled.")).toMatchObject({ error: "Google sign in was cancelled." });
    expect(parseSignInHash("view=debts")).toBeNull();
    expect(parseSignInHash("")).toBeNull();
  });

  it("the app link carries the whole hash on the scheme the Android project claims", () => {
    expect(signInHashOf("co.useledgerwatch.app://login#token=abc&n=1")).toBe("token=abc&n=1");
    expect(signInHashOf("co.useledgerwatch.app://login")).toBe("");
    expect(appReturnLink("token=abc&n=1")).toBe(`${APP_RETURN_BASE}#token=abc&n=1`);
    expect(appReturnLink("#token=abc")).toBe(`${APP_RETURN_BASE}#token=abc`);
    const manifest = fs.readFileSync(
      fileURLToPath(new URL("../../../../mobile/android/app/src/main/AndroidManifest.xml", import.meta.url)),
      "utf8"
    );
    const [scheme, host] = APP_RETURN_BASE.split("://");
    expect(manifest).toContain(`android:scheme="${scheme}"`);
    expect(manifest).toContain(`android:host="${host}"`);
    expect(manifest).toContain("android.intent.category.BROWSABLE");
  });

  it("only a page asked to return to the app offers the link", () => {
    expect(wantsAppReturn("?return=app")).toBe(true);
    expect(wantsAppReturn("?view=debts&return=app")).toBe(true);
    expect(wantsAppReturn("?return=web")).toBe(false);
    expect(wantsAppReturn("")).toBe(false);
  });

  it("outside the app nothing is native and no listener is attached", () => {
    vi.stubGlobal("window", {});
    expect(inNativeApp()).toBe(false);
    const handler = vi.fn();
    const stop = onAppUrlOpen(handler);
    expect(typeof stop).toBe("function");
    expect(handler).not.toHaveBeenCalled();
  });

  it("inside the app the launch address and later opens reach the handler, each address once", async () => {
    const shell = fakeApp({ launchUrl: "co.useledgerwatch.app://login#token=first&n=1" });
    expect(inNativeApp()).toBe(true);
    const handler = vi.fn();
    const stop = onAppUrlOpen(handler);
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith("co.useledgerwatch.app://login#token=first&n=1");
    shell.fire("co.useledgerwatch.app://login#token=first&n=1");
    shell.fire("co.useledgerwatch.app://login#token=second&n=2");
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith("co.useledgerwatch.app://login#token=second&n=2");
    stop();
    shell.fire("co.useledgerwatch.app://login#token=third&n=3");
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
