import { describe, it, expect, vi } from "vitest";
import { emulateDevice, setGeolocation, setDeviceOrientation } from "../src/core/mobile.js";

function makeMobileSession() {
  const conn = {
    send: vi.fn(async (method: string, params?: any) => {
      if (method === "Emulation.setDeviceMetricsOverride") return {};
      if (method === "Emulation.setUserAgentOverride") return {};
      if (method === "Emulation.setTouchEmulationEnabled") return {};
      if (method === "Emulation.setGeolocationOverride") return {};
      if (method === "Emulation.setDeviceOrientationOverride") return {};
      return {};
    }),
    close: vi.fn(async () => {}),
    isConnected: () => true,
    getTargetId: () => "t1",
  };

  const session: any = {
    browserUrl: "ws://localhost:9222",
    targetId: "t1",
    page: vi.fn(async () => conn),
  };
  return { session, conn };
}

describe("emulateDevice", () => {
  it("sets device metrics, user agent, and touch emulation", async () => {
    const { session, conn } = makeMobileSession();
    const result = await emulateDevice(session, {
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      mobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(result).toBeUndefined();
    expect(conn.send).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 3,
      mobile: true,
      fitViewport: false,
    });
    expect(conn.send).toHaveBeenCalledWith("Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(conn.send).toHaveBeenCalledWith("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      configuration: 'mobile',
    });
  });
});

describe("setGeolocation", () => {
  it("sets geolocation override", async () => {
    const { session, conn } = makeMobileSession();
    await setGeolocation(session, 52.52, 13.405, 10);
    expect(conn.send).toHaveBeenCalledWith("Emulation.setGeolocationOverride", {
      latitude: 52.52,
      longitude: 13.405,
      accuracy: 10,
    });
  });
});

describe("setDeviceOrientation", () => {
  it("sets device orientation override", async () => {
    const { session, conn } = makeMobileSession();
    await setDeviceOrientation(session, 0, 45, 0);
    expect(conn.send).toHaveBeenCalledWith("Emulation.setDeviceOrientationOverride", {
      alpha: 0,
      beta: 45,
      gamma: 0,
    });
  });
});
