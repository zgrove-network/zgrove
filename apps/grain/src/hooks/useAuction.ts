import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  ROUND_SECONDS,
  SLOTS,
  WINDOW,
  drawClearing,
  drawPot,
  openingRounds,
  outcomeOf,
  statsOver,
  type Round,
} from "../lib/auction";

/** Real milliseconds per simulated second. A round is one block, 75 seconds;
 * waiting that long to watch the loop once is no way to look at a mechanism,
 * so the clock runs fast and the interface says it does. */
export const TICK_MS = 200;
export const SPEED = Math.round(1000 / TICK_MS);

/** Real seconds the opened box stays up before the next round. */
const HOLD_TICKS = 22;

export type Phase = "open" | "revealed";

export interface AuctionState {
  readonly round: number;
  readonly block: number;
  readonly left: number;
  readonly phase: Phase;
  readonly hold: number;
  readonly bids: number;
  readonly pot: number | null;
  readonly foundBlock: boolean;
  readonly myBid: number | null;
  readonly balance: number;
  readonly session: number;
  readonly slotsWon: number;
  readonly played: number;
  readonly history: readonly Round[];
}

type Action = { type: "tick" } | { type: "seal"; amount: number };

function initial(): AuctionState {
  return {
    round: 1247,
    block: 2_913_442,
    left: ROUND_SECONDS,
    phase: "open",
    hold: 0,
    bids: 34,
    pot: null,
    foundBlock: false,
    myBid: null,
    balance: 1,
    session: 0,
    slotsWon: 0,
    played: 0,
    history: openingRounds(),
  };
}

function reduce(state: AuctionState, action: Action): AuctionState {
  if (action.type === "seal") {
    if (state.phase !== "open" || state.myBid !== null) return state;
    return { ...state, myBid: action.amount };
  }

  if (state.phase === "open") {
    if (state.left > 1) {
      // Other bidders keep arriving while the round is open. Their amounts
      // are never known here, only that another envelope landed.
      return {
        ...state,
        left: state.left - 1,
        bids: state.bids + (Math.random() < 0.2 ? 1 : 0),
      };
    }
    const { pot, foundBlock } = drawPot();
    return { ...state, left: 0, phase: "revealed", hold: HOLD_TICKS, pot, foundBlock };
  }

  if (state.hold > 1) return { ...state, hold: state.hold - 1 };

  const settled: Round = {
    n: state.round,
    perSlot: (state.pot ?? 0) / SLOTS,
    clearing: drawClearing(),
    foundBlock: state.foundBlock,
    bid: state.myBid,
  };
  const result = outcomeOf(settled);

  return {
    round: state.round + 1,
    block: state.block + 1,
    left: ROUND_SECONDS,
    phase: "open",
    hold: 0,
    bids: 28 + Math.floor(Math.random() * 20),
    pot: null,
    foundBlock: false,
    myBid: null,
    balance: state.balance + result.delta,
    session: state.session + result.delta,
    slotsWon: state.slotsWon + (result.won ? 1 : 0),
    played: state.played + (state.myBid === null ? 0 : 1),
    history: [settled, ...state.history].slice(0, WINDOW),
  };
}

export function useAuction(running: boolean) {
  const [state, dispatch] = useReducer(reduce, undefined, initial);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => dispatch({ type: "tick" }), TICK_MS);
    return () => window.clearInterval(id);
  }, [running]);

  const seal = useCallback((amount: number) => dispatch({ type: "seal", amount }), []);
  const stats = useMemo(() => statsOver(state.history), [state.history]);

  return { state, stats, seal };
}
