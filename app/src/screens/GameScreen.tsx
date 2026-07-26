import { useEffect, useMemo, useRef } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';

import { Card } from '@/components/Card';
import {
  DealtCard,
  PanelEntrance,
  PulseGlow,
  TrickBanner,
  TrickCardEntrance,
  TurnPulse,
  WinnerHighlight,
} from '@/components/animated';
import { Button } from '@/components/ui';
import { useTrickPause } from '@/hooks/useTrickPause';
import { useGame } from '@/lib/connection';
import {
  cardEq,
  legalPlays,
  SUIT_SYMBOL,
  turnOrderOf,
  type Card as CardT,
} from '@/lib/protocol';
import { colors, fonts, radius } from '@/lib/theme';

function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS !== 'web') void Haptics.impactAsync(style);
}

export function GameScreen() {
  const { state, send } = useGame();
  useKeepAwake(); // don't let the screen sleep mid-hand
  const trickView = useTrickPause(state);

  const {
    phase, round, totalRounds, trump, players, youIdx,
    hand, bids, tricksWon, handCounts, trick, turnIdx, dealerIdx, forbiddenBid,
  } = state ?? ({} as NonNullable<typeof state>);
  const n = players?.length ?? 0;
  const myTurn = turnIdx === youIdx;

  // Buzz when it becomes your turn, and when a trick resolves.
  const prevTurnRef = useRef(false);
  useEffect(() => {
    const isMine = myTurn && (phase === 'bidding' || phase === 'playing');
    if (isMine && !prevTurnRef.current) tap(Haptics.ImpactFeedbackStyle.Medium);
    prevTurnRef.current = isMine;
  }, [myTurn, phase]);

  const prevWinnerRef = useRef<number | null>(null);
  useEffect(() => {
    if (trickView.winnerIdx !== null && prevWinnerRef.current === null) {
      tap(trickView.winnerIdx === youIdx ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light);
    }
    prevWinnerRef.current = trickView.winnerIdx;
  }, [trickView.winnerIdx, youIdx]);

  const legal = useMemo(
    () => (state && phase === 'playing' && myTurn ? legalPlays(hand, trick) : []),
    [state, phase, myTurn, hand, trick],
  );

  if (!state) return null;

  const isLegal = (c: CardT) => legal.some((l) => cardEq(l, c));
  const trumpLabel = trump ? `Trump ${SUIT_SYMBOL[trump]}` : 'No Trump';

  return (
    <SafeAreaView style={styles.safe}>
      {/* Top bar */}
      <View style={styles.topbar}>
        <Text style={styles.topLeft}>
          Round {round}/{totalRounds} · {round} card{round === 1 ? '' : 's'}
        </Text>
        <Text style={styles.topCenter}>{trumpLabel}</Text>
      </View>

      {/* Opponents */}
      <View style={styles.opponents}>
        {players.map((p, idx) => {
          if (idx === youIdx) return null;
          const bid = bids[idx];
          const active = turnIdx === idx;
          return (
            <PulseGlow key={p.id} active={active} style={[styles.seat, active && styles.seatActive]}>
              <Text style={styles.seatOrder}>{turnOrderOf(idx, n, dealerIdx)}</Text>
              <Text style={styles.seatName} numberOfLines={1}>
                {p.name}
                {dealerIdx === idx ? '  Ⓓ' : ''}
              </Text>
              <Text style={styles.seatInfo}>
                {bid === null ? 'No bid' : `Bid ${bid} · Won ${tricksWon[idx]}`}
              </Text>
              <Text style={styles.seatCount}>{handCounts[idx]} cards</Text>
            </PulseGlow>
          );
        })}
      </View>

      {/* Trick */}
      <View style={styles.trickArea}>
        {/* Engraved table oval on the felt — ported from the web table's ::before */}
        <View pointerEvents="none" style={styles.tableOval} />
        {trickView.winnerName && <TrickBanner name={trickView.winnerName} />}
        {trickView.trick.map((entry, i) => (
          <TrickCardEntrance key={`${entry.playerIdx}-${entry.card.suit}-${entry.card.rank}`}>
            <WinnerHighlight isWinner={trickView.winnerIdx === entry.playerIdx}>
              <View style={styles.trickCard}>
                <Card card={entry.card} width={54} isTrump={!!trump && entry.card.suit === trump} />
                <Text style={styles.trickLabel} numberOfLines={1}>
                  {players[entry.playerIdx].name}
                </Text>
              </View>
            </WinnerHighlight>
          </TrickCardEntrance>
        ))}
      </View>

      {/* Bid prompt */}
      {phase === 'bidding' && myTurn && (
        <PanelEntrance style={styles.bidBar}>
          <Text style={styles.bidHint}>
            Your bid (0–{round}{forbiddenBid !== null ? `, not ${forbiddenBid}` : ''})
          </Text>
          <View style={styles.bidRow}>
            {Array.from({ length: round + 1 }, (_, b) => {
              const forbidden = b === forbiddenBid;
              return (
                <Pressable
                  key={b}
                  disabled={forbidden}
                  onPress={() => {
                    tap();
                    send({ type: 'bid', bid: b });
                  }}
                  style={({ pressed }) => [
                    styles.bidBtn,
                    forbidden && styles.bidBtnForbidden,
                    pressed && !forbidden && styles.bidBtnPressed,
                  ]}
                >
                  <Text style={[styles.bidBtnText, forbidden && styles.bidBtnTextForbidden]}>{b}</Text>
                </Pressable>
              );
            })}
          </View>
        </PanelEntrance>
      )}

      {/* My area */}
      <View style={styles.myArea}>
        <View style={styles.myInfoRow}>
          <Text style={styles.myInfo}>
            {players[youIdx].name} (Turn {turnOrderOf(youIdx, n, dealerIdx)}/{n})
            {'   '}
            {bids[youIdx] === null ? 'Bid —' : `Bid ${bids[youIdx]} · Won ${tricksWon[youIdx]}`}
          </Text>
          {myTurn && (phase === 'bidding' || phase === 'playing') && (
            <TurnPulse>
              <Text style={styles.myTurnText}>◆ Your turn</Text>
            </TurnPulse>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hand}>
          {hand.map((c, i) => {
            const playable = phase === 'playing' && myTurn && isLegal(c);
            const dim = phase === 'playing' && myTurn && !isLegal(c);
            return (
              <DealtCard key={`${c.suit}-${c.rank}-${round}`} index={i}>
                <Card
                  card={c}
                  width={64}
                  isTrump={!!trump && c.suit === trump}
                  onPress={
                    playable
                      ? () => {
                          tap();
                          send({ type: 'play', card: { suit: c.suit, rank: c.rank } });
                        }
                      : undefined
                  }
                  disabled={dim}
                  style={i > 0 ? styles.handOverlap : undefined}
                />
              </DealtCard>
            );
          })}
        </ScrollView>
      </View>

      {/* Scoreboard: a screen-level modal, not nested in the felt — otherwise it
          dims the trick cards behind it and sits off-centre. */}
      {(phase === 'roundEnd' || phase === 'gameEnd') && <ScoreBoard />}
    </SafeAreaView>
  );
}

function ScoreBoard() {
  const { state, send } = useGame();
  if (!state) return null;
  const { players, scoreHistory, scores, phase, youId, hostId, round } = state;
  const isHost = youId === hostId;

  let title = 'Scores';
  if (phase === 'gameEnd') {
    const max = Math.max(...scores);
    const winners = players.filter((_, i) => scores[i] === max).map((p) => p.name);
    title = `${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}!`;
  }

  return (
    <View style={styles.scoreOverlay}>
      <View style={styles.scorePanel}>
        <Text style={styles.scoreTitle}>{title}</Text>
        <ScrollView style={styles.scoreScroll}>
          <View style={styles.scoreRowHead}>
            <Text style={[styles.scoreCell, styles.scoreRoundCol, styles.scoreHeadText]}>R</Text>
            {players.map((p) => (
              <Text key={p.id} style={[styles.scoreCell, styles.scoreHeadText]} numberOfLines={1}>{p.name}</Text>
            ))}
          </View>
          {scoreHistory.map((rr, ri) => (
            <View key={ri} style={styles.scoreRow}>
              <Text style={[styles.scoreCell, styles.scoreRoundCol]}>{ri + 1}</Text>
              {rr.map((r, i) => (
                <Text key={i} style={styles.scoreCell}>
                  {r.bid}/{r.won} {r.delta >= 0 ? '+' : ''}{r.delta}
                </Text>
              ))}
            </View>
          ))}
          <View style={[styles.scoreRow, styles.scoreTotalRow]}>
            <Text style={[styles.scoreCell, styles.scoreRoundCol, styles.scoreTotalText]}>Σ</Text>
            {scores.map((s, i) => (
              <Text key={i} style={[styles.scoreCell, styles.scoreTotalText]}>{s}</Text>
            ))}
          </View>
        </ScrollView>
        {phase === 'roundEnd' && isHost && (
          <Button label="Next Round" onPress={() => send({ type: 'nextRound' })} style={styles.scoreBtn} />
        )}
        {phase === 'gameEnd' && isHost && (
          <Button label="Play Again" onPress={() => send({ type: 'playAgain' })} style={styles.scoreBtn} />
        )}
        {!isHost && phase === 'roundEnd' && (
          <Text style={styles.scoreWait}>Waiting for host…</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  topbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderBottomWidth: 1,
    borderBottomColor: colors.goldHairlineSoft,
  },
  topLeft: { color: colors.creamDim, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  topCenter: { color: colors.cream, fontFamily: fonts.serif, fontSize: 17, fontWeight: '700' },
  opponents: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, padding: 10 },
  seat: {
    minWidth: 120,
    padding: 10,
    backgroundColor: colors.panelBot,
    borderWidth: 1,
    borderColor: colors.goldHairline,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  seatActive: { borderColor: colors.goldBright },
  seatOrder: {
    position: 'absolute',
    top: -8,
    left: -8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.felt950,
    borderWidth: 1,
    borderColor: colors.goldHairline,
    color: colors.cream,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
    overflow: 'hidden',
  },
  seatName: { color: colors.goldBright, fontFamily: fonts.serif, fontSize: 15, fontWeight: '700' },
  seatInfo: { color: colors.cream, fontSize: 12, marginTop: 3 },
  seatCount: { color: colors.creamDim, fontSize: 10, marginTop: 2, textTransform: 'uppercase' },
  trickArea: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    // Wrapped flex lines default to alignContent:flex-start, which pins the
    // trick to the top of the felt — center the lines instead.
    alignContent: 'center',
    gap: 12,
    paddingHorizontal: 12,
  },
  // Percentage width/height (not top/bottom insets — those collapse in RN's
  // absolute layout) so the oval scales with the felt area.
  tableOval: {
    position: 'absolute',
    alignSelf: 'center',
    top: '16%',
    width: '82%',
    height: '66%',
    borderWidth: 1,
    borderColor: 'rgba(201, 164, 79, 0.14)',
    borderRadius: 9999,
  },
  trickCard: { alignItems: 'center', gap: 4 },
  trickLabel: { color: colors.creamDim, fontSize: 10, textTransform: 'uppercase' },
  bidBar: { padding: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
  bidHint: { color: colors.creamDim, fontSize: 13, marginBottom: 8 },
  bidRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  bidBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.felt800,
  },
  bidBtnForbidden: { opacity: 0.32, borderColor: colors.goldHairlineSoft },
  bidBtnPressed: { backgroundColor: colors.gold, transform: [{ translateY: -2 }] },
  bidBtnText: { color: colors.goldBright, fontFamily: fonts.serif, fontSize: 18, fontWeight: '700' },
  bidBtnTextForbidden: { color: colors.creamDim, textDecorationLine: 'line-through' },
  myArea: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderTopWidth: 1,
    borderTopColor: colors.goldHairlineSoft,
  },
  myInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  myInfo: { color: colors.cream, fontSize: 12, textAlign: 'center' },
  myTurnText: {
    color: colors.goldBright,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  // flexGrow lets a short hand centre itself; long hands still scroll.
  hand: {
    paddingHorizontal: 20,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexGrow: 1,
    minHeight: 96,
  },
  handOverlap: { marginLeft: -22 },
  scoreOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2,8,6,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  scorePanel: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: colors.panelBot,
    borderWidth: 1,
    borderColor: colors.goldHairline,
    borderRadius: radius.lg,
    padding: 20,
  },
  scoreTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    fontWeight: '700',
    color: colors.goldBright,
    textAlign: 'center',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scoreScroll: { marginBottom: 16 },
  scoreRowHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.goldHairline, paddingBottom: 4 },
  scoreRow: { flexDirection: 'row', paddingVertical: 3 },
  scoreTotalRow: { borderTopWidth: 2, borderTopColor: colors.gold, marginTop: 4, paddingTop: 6 },
  scoreCell: { flex: 1, color: colors.cream, fontSize: 11, textAlign: 'center' },
  scoreRoundCol: { flex: 0.4, color: colors.creamDim },
  scoreHeadText: { color: colors.goldBright, fontWeight: '700', textTransform: 'uppercase', fontSize: 10 },
  scoreTotalText: { color: colors.goldBright, fontWeight: '700' },
  scoreBtn: { marginTop: 4 },
  scoreWait: { color: colors.creamDim, textAlign: 'center', fontSize: 13 },
});
