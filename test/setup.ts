// Test environment setup for Browsy CDP plugin.
// The `ws` module is mocked per-test via vi.mock, so no global WebSocket
// override is needed here. Kept as a vitest setup file for future use.
import { vi } from 'vitest';

// Silence the connection log lines during tests, but keep errors visible.
beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});