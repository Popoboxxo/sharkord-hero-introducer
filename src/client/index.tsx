/**
 * Native Sharkord v0.0.22 client entry — sharkord-hero-introducer.
 *
 * Exports `components` for all slots, bound to the hero:state server action.
 * Uses the shared Sharkord Plugin UI-Kit (teal brand) for a uniform look & feel.
 */

import { useEffect, useState } from "react";
import { Badge, Card, IconButton, Panel, List, StatusDot, tokens } from "../ui/kit";
import { callAction } from "../ui/kit/store";

const ICON = "🧑‍🎤";

type HeroState = { introCount: number; activeChannels: number; knownUsers: number };
const EMPTY: HeroState = { introCount: 0, activeChannels: 0, knownUsers: 0 };

function useHero(pollMs = 6000): HeroState {
  const [state, setState] = useState<HeroState>(EMPTY);
  useEffect(() => {
    const refresh = () => void callAction<HeroState>("hero:state").then((s) => s && setState({ ...EMPTY, ...s }));
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [pollMs]);
  return state;
}

/** TOPBAR_RIGHT — hero status. */
function HeroBadge() {
  const s = useHero();
  return (
    <Badge icon={ICON} tone={s.introCount > 0 ? "accent" : "muted"}>
      {s.introCount} intro{s.introCount === 1 ? "" : "s"}
    </Badge>
  );
}

/** CONNECT_SCREEN — welcome hint before login. */
function HeroWelcome() {
  return (
    <Card title="Hero Introducer" icon={ICON}>
      <p style={{ margin: 0, fontSize: tokens.fontSm, color: tokens.textMuted }}>
        This server greets you with a personal intro when you join a voice channel. Upload yours with <code>/hero</code>.
      </p>
    </Card>
  );
}

/** HOME_SCREEN — intro overview. */
function IntroCard() {
  const s = useHero();
  return (
    <Card title="Hero Introducer" icon={ICON}>
      <div style={{ display: "flex", alignItems: "center", gap: tokens.gap, fontSize: tokens.fontMd }}>
        <StatusDot color={tokens.accent} pulse={s.activeChannels > 0} />
        <strong>{s.introCount}</strong> intros loaded · {s.knownUsers} known users
      </div>
      <p style={{ margin: "6px 0 0 0", fontSize: tokens.fontSm, color: tokens.textMuted }}>
        Personal audio intros play when users join voice channels.
      </p>
    </Card>
  );
}

/** CHAT_ACTIONS — manage own intro. */
function ManageIntroButton() {
  return <IconButton icon={ICON} title="Manage your intro (/hero, /hero-search-music)" onClick={() => {}} />;
}

/** FULL_SCREEN — admin panel. */
function HeroPanel() {
  const s = useHero(4000);
  return (
    <Panel title="Hero Introducer" icon={ICON}>
      <Card title="Status">
        <List
          items={[
            <span>Intros loaded: <strong>{s.introCount}</strong></span>,
            <span>Active voice channels: <strong>{s.activeChannels}</strong></span>,
            <span>Known users: <strong>{s.knownUsers}</strong></span>,
          ]}
        />
      </Card>
      <Card title="Commands">
        <List
          items={[
            <span><code>/hero</code> — set or replace your personal intro</span>,
            <span><code>/hero-search-music</code> — find intro music</span>,
            <span><code>/hero-diagnose</code> — troubleshoot playback</span>,
          ]}
        />
      </Card>
    </Panel>
  );
}

export const components = {
  topbar_right: [HeroBadge],
  connect_screen: [HeroWelcome],
  home_screen: [IntroCard],
  chat_actions: [ManageIntroButton],
  full_screen: [HeroPanel],
};
