export interface DiagTransport {
  id: string;
  tuple: { localPort: number };
  produce(params: unknown): Promise<DiagProducer>;
  consume(params: unknown): Promise<unknown>;
  close(): void;
  dump(): Promise<Record<string, unknown>>;
  getStats?(): Promise<unknown>;
  consumers?: Map<string, DiagConsumerLike>;
}

export interface DiagProducer {
  id: string;
  paused: boolean;
  close(): void;
  getStats(): Promise<Array<{ packetCount: number; byteCount: number; score: number }>>;
  observer?: { on(event: string, handler: (consumer: DiagConsumerLike) => void): void };
}

export interface DiagConsumerLike {
  id: string;
  paused: boolean;
  kind?: string;
  type?: string;
  producerPaused?: boolean;
  score?: unknown;
  getStats(): Promise<unknown>;
}

export interface DiagRouter {
  createPlainTransport(params: unknown): Promise<DiagTransport>;
  dump(): Promise<{
    transportIds?: string[];
    mapProducerIdConsumerIds?: Array<{ key: string; values: string[] }>;
  }>;
  rtpCapabilities: unknown;
  transportsForTesting?: Map<string, DiagTransport>;
}

export interface DiagListenInfo {
  ip: string;
  announcedAddress: string;
}

export type StageReporter = {
  pass(stage: string, detail: string): void;
  fail(stage: string, detail: string): void;
  info(stage: string, detail: string): void;
};
