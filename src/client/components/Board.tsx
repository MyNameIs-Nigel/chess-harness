import { Chess, type Square } from "chess.js";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Chessboard, type Arrow } from "react-chessboard";

interface Props {
  fen: string;
  orientation: "white" | "black";
  /** The human may move the side to move. */
  interactive: boolean;
  lastMove: { from: string; to: string } | null;
  arrows: Arrow[];
  onMove: (uci: string) => void;
}

const PROMOTIONS = ["q", "r", "b", "n"] as const;
const GLYPH: Record<string, string> = { q: "♛", r: "♜", b: "♝", n: "♞" };

export function Board({ fen, orientation, interactive, lastMove, arrows, onMove }: Props) {
  const chess = useMemo(() => new Chess(fen), [fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);

  useEffect(() => {
    setSelected(null);
    setPromotion(null);
  }, [fen, interactive]);

  const targets = useMemo(
    () => (selected ? chess.moves({ square: selected, verbose: true }) : []),
    [chess, selected],
  );

  function attempt(from: Square, to: Square): "moved" | "promoting" | null {
    const candidates = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!candidates.length) return null;
    setSelected(null);
    if (candidates.some((m) => m.promotion)) {
      setPromotion({ from, to });
      return "promoting";
    }
    onMove(from + to);
    return "moved";
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.from] = squareStyles[lastMove.to] = {
      background: "rgba(255, 210, 70, 0.42)",
    };
  }
  if (chess.inCheck()) {
    const king = chess.findPiece({ type: "k", color: chess.turn() })[0];
    if (king)
      squareStyles[king] = {
        background:
          "radial-gradient(circle, rgba(255,40,40,.9) 0%, rgba(255,40,40,.25) 60%, transparent 75%)",
      };
  }
  if (selected) squareStyles[selected] = { background: "rgba(90, 170, 255, 0.5)" };
  for (const m of targets) {
    squareStyles[m.to] = {
      ...squareStyles[m.to],
      backgroundImage: m.captured
        ? "radial-gradient(circle, transparent 58%, rgba(20,30,40,.35) 60%)"
        : "radial-gradient(circle, rgba(20,30,40,.35) 22%, transparent 24%)",
    };
  }

  const mine = (pieceType: string) => interactive && pieceType[0] === chess.turn();

  return (
    <div className="board">
      <Chessboard
        options={{
          id: "main",
          position: fen,
          boardOrientation: orientation,
          allowDragging: interactive,
          canDragPiece: ({ piece }) => mine(piece.pieceType),
          onPieceDrop: ({ sourceSquare, targetSquare }) =>
            !!targetSquare && attempt(sourceSquare as Square, targetSquare as Square) === "moved",
          onSquareClick: ({ square, piece }) => {
            if (!interactive) return;
            if (selected && attempt(selected, square as Square)) return;
            setSelected(
              piece && mine(piece.pieceType) && square !== selected ? (square as Square) : null,
            );
          },
          squareStyles,
          arrows,
          lightSquareStyle: { backgroundColor: "#eeeed2" },
          darkSquareStyle: { backgroundColor: "#769656" },
          animationDurationInMs: 180,
        }}
      />
      {promotion && (
        <div className="promotion" role="dialog" aria-label="Choose promotion piece">
          {PROMOTIONS.map((p) => (
            <button
              key={p}
              className={chess.turn() === "w" ? "white-piece" : "black-piece"}
              onClick={() => {
                onMove(promotion.from + promotion.to + p);
                setPromotion(null);
              }}
            >
              {GLYPH[p]}
            </button>
          ))}
          <button className="cancel" onClick={() => setPromotion(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
