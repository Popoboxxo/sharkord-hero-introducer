// Tracked ambient type declarations for `@sharkord/plugin-sdk`.
//
// `@sharkord/plugin-sdk` is provided at runtime by the Sharkord host and is
// not published to npm — it is hand-vendored into `node_modules/@sharkord`
// per developer machine, which means the copy is untracked (node_modules is
// gitignored) and can silently drift from the version pinned in
// `package.json`. This file is the tracked source of truth for the SDK
// surface this plugin actually depends on; `tsconfig.json` redirects the
// `@sharkord/plugin-sdk` specifier here via `compilerOptions.paths` so type
// checking no longer depends on whatever happens to be vendored locally.
//
// Kept in sync with SDK 0.0.22 (see sharkord-meta docs/SDK-0.0.22-MIGRATION.md).
// No runtime values are imported from `@sharkord/plugin-sdk` in this plugin
// (see `src/index.ts`), so redirecting only the type-checker's module
// resolution here does not affect the built bundle.

export type TCreateStreamOptions = {
  channelId: number;
  title: string;
  key: string;
  avatarUrl?: string;
  bannerUrl?: string;
  producers: {
    audio?: unknown;
    video?: unknown;
  };
};

export type TExternalStreamHandle = {
  streamId: number;
  remove: () => void;
  update: (options: {
    title?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    producers?: {
      audio?: unknown;
      video?: unknown;
    };
  }) => void;
};

export type ServerEvent =
  | "user:joined"
  | "user:left"
  | "user:joined_voice"
  | "user:left_voice"
  | "voice:user_joined"
  | "voice:user_left"
  | "message:created"
  | "message:updated"
  | "message:deleted"
  | "voice:runtime_initialized"
  | "voice:runtime_closed"
  | "setting:set";

export interface EventPayloads {
  "user:joined": { userId: number; username: string };
  "user:left": { userId: number; username: string };
  "user:joined_voice": { userId: number; channelId: number };
  "user:left_voice": { userId: number; channelId: number };
  // This plugin's handlers (src/handlers/voice-events.ts) subscribe to
  // these two event names; see REQ-CORE-001 / REQ-CORE-015 in
  // docs/REQUIREMENTS.md. Payload shape is read defensively via
  // `Record<string, unknown>` casts at the call site.
  "voice:user_joined": Record<string, unknown>;
  "voice:user_left": Record<string, unknown>;
  "message:created": {
    messageId: number;
    channelId: number;
    userId: number | null;
    pluginId: string | null;
    content: string;
    textContent: string;
  };
  "message:updated": {
    messageId: number;
    channelId: number;
    userId: number | null;
    pluginId: string | null;
    content: string;
    textContent: string;
  };
  "message:deleted": { messageId: number; channelId: number };
  "voice:runtime_initialized": { channelId: number };
  "voice:runtime_closed": { channelId: number };
  "setting:set": { key: string; value: unknown };
}

export type TPluginSettingDefinition = {
  key: string;
  type: "string" | "number" | "boolean";
  // SDK 0.0.22 renamed `label` to `name` (see docs/SDK-0.0.22-MIGRATION.md,
  // section 2). Both kept optional here so either convention type-checks.
  name?: string;
  label?: string;
  description?: string;
  defaultValue?: unknown;
  required?: boolean;
};

export interface PluginSettings<
  T extends readonly TPluginSettingDefinition[] = TPluginSettingDefinition[]
> {
  get<K extends T[number]["key"]>(key: K): unknown;
  set<K extends T[number]["key"]>(key: K, value: unknown): void;
}

export interface PluginContext {
  path: string;
  pluginId: string;

  logger: {
    log(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };

  log(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  error(...args: unknown[]): void;

  events: {
    on<E extends ServerEvent>(
      event: E,
      handler: (payload: EventPayloads[E]) => void | Promise<void>
    ): () => void;
    off<E extends ServerEvent>(
      event: E,
      handler: (payload: EventPayloads[E]) => void | Promise<void>
    ): void;
  };

  actions: {
    register<TPayload = void>(action: unknown): void;
  };

  voice: {
    getRouter(channelId: number): unknown;
    createStream(options: TCreateStreamOptions): TExternalStreamHandle;
    getListenInfo(): { ip: string; announcedAddress: string | undefined };
  };

  messages: {
    send(
      channelId: number,
      content: string,
      options?: { parentMessageId?: number; replyToMessageId?: number }
    ): Promise<{ messageId: number }>;
    edit(messageId: number, content: string): Promise<void>;
    delete(messageId: number): Promise<void>;
  };

  commands: {
    register<TArgs = void>(command: unknown): void;
  };

  settings: {
    register<T extends readonly TPluginSettingDefinition[]>(
      definitions: T
    ): Promise<PluginSettings<T>>;
  };

  hooks: {
    onBeforeFileSave(handler: unknown): void;
  };

  data: {
    getUser(userId: number): Promise<unknown | undefined>;
    getChannel(channelId: number): Promise<unknown | undefined>;
    getPublicUsers(): Promise<unknown[]>;
  };

  ui: {
    enable(): void;
    disable(): void;
  };
}

export interface UnloadPluginContext
  extends Pick<
    PluginContext,
    | "path"
    | "logger"
    | "log"
    | "debug"
    | "error"
    | "voice"
    | "messages"
    | "ui"
  > {}

export interface PluginConfig {
  name: string;
  version: string;
  onLoad?(): void | Promise<void>;
  onUnload?(): void | Promise<void>;
  components?: unknown;
}

export type CommandDefinition<TArgs = void> = {
  name: string;
  description: string;
  args?: unknown[];
  executes?: (ctx: unknown, args: TArgs) => void | Promise<void>;
};

export type ActionDefinition<TPayload = void> = unknown;

export enum FileSaveType {
  Attachment = "attachment",
  Avatar = "avatar",
  Banner = "banner",
}

export const PLUGIN_SDK_VERSION = "0.0.22";

export enum PluginSlot {
  ChannelHeader = "channel-header",
  MessageActions = "message-actions",
  UserProfile = "user-profile",
}

export type TInvokerContext = unknown;
export type TPluginActions = unknown;
export type TPluginComponentsMapBySlotId = unknown;
export type TPluginStore = unknown;
export type TPluginStoreState = unknown;
export type TActionContract = unknown;
export type TBeforeFileSaveHook = unknown;
export type TCommandArg = unknown;
export type TCommandContract = unknown;
