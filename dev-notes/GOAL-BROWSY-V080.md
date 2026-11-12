# GOAL-BROWSY-V080

## Goal: v0.8.0 — Mobile emulation & device simulation

### Objective
Give browsy-bot mobile device emulation (device metrics, user agent, touch,
geolocation, device orientation) over CDP for responsive UI testing.

### Context
browsy-bot drives desktop Chrome by default. Mobile testing requires device
metrics, user agent, touch support, geolocation, and device orientation —
all available via the CDP Emulation domain.

### Deliverables
- [ ] src/core/mobile.ts — emulateDevice, setGeolocation, setDeviceOrientation
- [ ] preset device profiles (iPhone, iPad, Pixel, Galaxy, iPad Pro)
- [ ] src/core/actions.ts — wire mobile into public surface
- [ ] src/mcp.ts — browsy_emulate_device, browsy_set_geolocation,
      browsy_set_device_orientation
- [ ] src/cli.ts — browsy emulate-device, browsy set-geolocation,
      browsy set-device-orientation
- [ ] Tests: test/mobile.test.ts, mobile tools in mcp.test.ts
- Done when: npm run typecheck && npm run build && npm test all green
