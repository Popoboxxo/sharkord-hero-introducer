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

export interface MockConsumer {
  id: string;
  paused: boolean;
  kind: string;
  rtpParameters: { codecs: Array<{ mimeType: string; payloadType: number }> };
  resume: ReturnType<typeof mock>;
  getStats: ReturnType<typeof mock>;
}

export interface MockProducer {
  id: string;
  paused: boolean;
  close: ReturnType<typeof mock>;
  on: ReturnType<typeof mock>;
  observer: { on: ReturnType<typeof mock> };
  getStats: ReturnType<typeof mock>;
  resume: ReturnType<typeof mock>;
}

export interface MockPlainTransport {
  tuple: { localPort: number; localIp: string };
  produce: ReturnType<typeof mock>;
  consume: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

export interface MockRouter {
  createPlainTransport: ReturnType<typeof mock>;
  rtpCapabilities: Record<string, unknown>;
  dump: ReturnType<typeof mock>;
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
  voice: {
    getRouter: ReturnType<typeof mock>;
    getListenInfo: ReturnType<typeof mock>;
    createStream: ReturnType<typeof mock>;
  };
}

// ---------------------------------------------------------------------------
// Captures: inspect what playAudio() passed to mocks
// ---------------------------------------------------------------------------

export interface MockCaptures {
  producer: MockProducer;
  consumer: MockConsumer;
  transport: MockPlainTransport;
  router: MockRouter;
  stream: MockStream;
  /** All Bun.spawn calls captured: { cmd, opts } */
  spawnCalls: Array<{ cmd: string[]; opts: Record<string, unknown> }>;
}

/**
 * Creates a fresh MockPluginContext with sensible defaults.
 *
 * `settings.register` resolves to a MockSettings object with `get`/`set`.
 *
 * Returns `captures` for inspecting what playAudio() passed to transport,
 * producer, router, createStream, and Bun.spawn.
 */
export function createMockPluginContext(
  overrides: Partial<{ path: string }> = {},
): { ctx: MockPluginContext; settings: MockSettings; captures: MockCaptures } {
  const settingsObj: MockSettings = {
    get: mock((key: string) => {
      if (key === "enabled") return true;
      if (key === "oncePerDay") return true;
      if (key === "debug") return false;
      if (key === "volume") return 25;
      return undefined;
    }),
    set: mock(() => {}),
  };

  const mockConsumer: MockConsumer = {
    id: "mock-consumer-id",
    paused: true,
    kind: "audio",
    rtpParameters: { codecs: [{ mimeType: "audio/opus", payloadType: 111 }] },
    resume: mock(async () => { mockConsumer.paused = false; }),
    getStats: mock(async () => [{ type: "inbound-rtp", packetCount: 0, byteCount: 0 }]),
  };

  const mockProducer: MockProducer = {
    id: "mock-producer-id",
    paused: false,
    close: mock(() => {}),
    on: mock(() => {}),
    observer: { on: mock(() => {}) },
    getStats: mock(async () => [{ packetCount: 0, byteCount: 0, score: 0 }]),
    resume: mock(async () => { mockProducer.paused = false; }),
  };

  const mockTransport: MockPlainTransport = {
    tuple: { localPort: 40100, localIp: "127.0.0.1" },
    produce: mock(async () => mockProducer),
    consume: mock(async () => mockConsumer),
    close: mock(() => {}),
  };

  const mockRouter: MockRouter = {
    createPlainTransport: mock(async () => mockTransport),
    rtpCapabilities: { codecs: [{ mimeType: "audio/opus", preferredPayloadType: 111, clockRate: 48000, channels: 2 }] },
    dump: mock(async () => ({
      transportIds: ["mock-transport-id"],
      mapProducerIdConsumerIds: [{ key: mockProducer.id, values: [mockConsumer.id] }],
    })),
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
        getListenInfo: mock(async () => ({
          ip: "127.0.0.1",
          announcedAddress: "127.0.0.1",
        })),
        createStream: mock(() => mockStream),
      },
    },
    voice: {
      getRouter: mock(() => mockRouter),
      getListenInfo: mock(async () => ({
        ip: "127.0.0.1",
        announcedAddress: "127.0.0.1",
      })),
      createStream: mock(() => mockStream),
    },
  };

  const captures: MockCaptures = {
    producer: mockProducer,
    consumer: mockConsumer,
    transport: mockTransport,
    router: mockRouter,
    stream: mockStream,
    spawnCalls: [],
  };

  return { ctx, settings: settingsObj, captures };
}
