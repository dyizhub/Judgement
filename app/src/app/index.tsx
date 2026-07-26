import { useGame } from '@/lib/connection';
import { HomeScreen } from '@/screens/HomeScreen';
import { LobbyScreen } from '@/screens/LobbyScreen';
import { GameScreen } from '@/screens/GameScreen';

// Single route; the server's phase is the source of truth for which screen shows
// — same model as the web client's routeScreen(). No stack navigation to fight
// with the server-driven flow.
export default function Root() {
  const { state } = useGame();

  if (!state) return <HomeScreen />;
  if (state.phase === 'lobby') return <LobbyScreen />;
  return <GameScreen />;
}
