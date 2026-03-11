import { mock } from "bun:test";

// ---------------------------------------------------------------------------
// Mock PluginContext for unit testing
// ---------------------------------------------------------------------------
// Mirrors the PluginContext interface from @sharkord/plugin-sdk as used by
// server.ts.  Every method is a bun:test mock so tests can assert on calls.
// ---------------------------------------------------------------------------

export interface MockSettings {
  get: ReturnType<typeof mock>;
  set: ReturnType<typeof mock>;
}

export interface MockProducer {
  close: ReturnType<typeof mock>;
}

export interface MockPlainTransport {
  tuple: { localPort: number; localIp: string };
  produce: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

export interface MockRouter {
  createPlainTransport: ReturnType<typeof mock>;
}

export interface MockStream {
  remove: ReturnType<typeof mock>;
}

export interface MockPluginContext {
  path: string;
  log: ReturnType<typeof mock>;
  debug: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
  settings: {
    register: ReturnType<typeof mock>;
  };
  events: {
    on: ReturnType<typeof mock>;
  };
  commands: {
    register: ReturnType<typeof mock>;
  };
  ui: {
    enable: ReturnType<typeof mock>;
  };
  actions: {
    voice: {
      getRouter: ReturnType<typeof mock>;
      getListenInfo: ReturnType<typeof mock>;
      createStream: ReturnType<typeof mock>;
    };
  };
}

/**
 * Creates a fresh MockPluginContext with sensible defaults.
 *
 * `settings.register` resolves to a MockSettings object with `get`/`set`.
 */
export function createMockPluginContext(
  overrides: Partial<{ path: string }> = {},
): { ctx: MockPluginContext; settings: MockSettings } {
  const settingsObj: MockSettings = {
    get: mock((key: string) => {
      if (key === "enabled") return true;
      if (key === "oncePerDay") return true;
      return undefined;
    }),
    set: mock(() => {}),
  };

  const mockProducer: MockProducer = { close: mock(() => {}) };
  const mockTransport: MockPlainTransport = {
    tuple: { localPort: 40100, localIp: "127.0.0.1" },
    produce: mock(async () => mockProducer),
    close: mock(() => {}),
  };
  const mockRouter: MockRouter = {
    createPlainTransport: mock(async () => mockTransport),
  };
  const mockStream: MockStream = { remove: mock(() => {}) };

  const ctx: MockPluginContext = {
    path: overrides.path ?? "/tmp/sharkord-hero-introducer-test",
    log: mock(() => {}),
    debug: mock(() => {}),
    error: mock(() => {}),
    settings: {
      register: mock(async () => settingsObj),
    },
    events: {
      on: mock(() => {}),
    },
    commands: {
      register: mock(() => {}),
    },
    ui: {
      enable: mock(() => {}),
    },
    actions: {
      voice: {
        getRouter: mock(() => mockRouter),
        getListenInfo: mock(() => ({
          ip: "127.0.0.1",
          announcedAddress: "127.0.0.1",
        })),
        createStream: mock(() => mockStream),
      },
    },
  };

  return { ctx, settings: settingsObj };
}
