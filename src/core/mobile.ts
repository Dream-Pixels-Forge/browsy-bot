// Mobile emulation — device metrics, user agent, touch, geolocation,
// and device orientation over CDP.
//
// All changes apply to the session's page connection. Device metric
// overrides may require a page reload to fully apply CSS media queries.

import type { CDPConnection } from './connection.js';
import { Emulation } from './types.js';
import type { Session } from './session.js';

type Conn = CDPConnection;

/** Preset device profiles for common mobile form factors. */
export interface DeviceProfile {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent: string;
}

/** Built-in device presets. */
export const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  iPhone15: {
    name: 'iPhone 15',
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  iPhone15ProMax: {
    name: 'iPhone 15 Pro Max',
    width: 430,
    height: 932,
    deviceScaleFactor: 3,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  iPadAir: {
    name: 'iPad Air',
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  Pixel8: {
    name: 'Pixel 8',
    width: 393,
    height: 873,
    deviceScaleFactor: 3.5,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP3A.240705.002) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
  GalaxyS24: {
    name: 'Galaxy S24',
    width: 360,
    height: 800,
    deviceScaleFactor: 3.5,
    mobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
};

async function page(session: Session): Promise<Conn> {
  return session.page();
}

/**
 * Emulate a mobile device: set device metrics (width/height/scale/mobile),
 * user agent, and touch emulation. Pass a DeviceProfile or a partial
 * override; missing fields fall back to sensible defaults.
 */
export async function emulateDevice(
  session: Session,
  device: Partial<DeviceProfile> & { width: number; height: number },
): Promise<void> {
  const conn = await page(session);
  const deviceScaleFactor = device.deviceScaleFactor ?? 2;
  const mobile = device.mobile ?? true;
  const fitViewport = false;

  await conn.send<Emulation.SetDeviceMetricsOverrideParams>(
    'Emulation.setDeviceMetricsOverride',
    {
      width: device.width,
      height: device.height,
      deviceScaleFactor,
      mobile,
      fitViewport,
    },
  );

  if (device.userAgent) {
    await conn.send<Emulation.SetUserAgentOverrideParams>(
      'Emulation.setUserAgentOverride',
      { userAgent: device.userAgent },
    );
  }

  await conn.send<Emulation.SetTouchEmulationEnabledParams>(
    'Emulation.setTouchEmulationEnabled',
    { enabled: mobile, configuration: mobile ? 'mobile' : 'desktop' },
  );
}

/**
 * Override the geolocation reported to the page.
 * accuracy defaults to 10 meters.
 */
export async function setGeolocation(
  session: Session,
  latitude: number,
  longitude: number,
  accuracy = 10,
): Promise<void> {
  const conn = await page(session);
  await conn.send<Emulation.SetGeolocationOverrideParams>(
    'Emulation.setGeolocationOverride',
    { latitude, longitude, accuracy },
  );
}

/**
 * Override the device orientation reported to the page.
 * alpha/beta/gamma are in degrees.
 */
export async function setDeviceOrientation(
  session: Session,
  alpha: number,
  beta: number,
  gamma: number,
): Promise<void> {
  const conn = await page(session);
  await conn.send<Emulation.SetDeviceOrientationOverrideParams>(
    'Emulation.setDeviceOrientationOverride',
    { alpha, beta, gamma },
  );
}
