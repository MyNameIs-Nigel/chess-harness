import { useHashRoute } from "./api";
import { Game } from "./components/Game";
import { Setup } from "./components/Setup";

export function App() {
  const { gameId, go } = useHashRoute();
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-icon">♞</span> LLM Chess
        </a>
        <span className="tagline">Language models play. Stockfish keeps score.</span>
        {gameId && (
          <a className="button ghost" href="#/">
            New game
          </a>
        )}
      </header>
      <main>
        {gameId ? (
          <Game key={gameId} id={gameId} />
        ) : (
          <Setup onStart={(id) => go(`#/game/${id}`)} />
        )}
      </main>
    </div>
  );
}
