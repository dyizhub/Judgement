import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Panel } from '@/components/ui';
import { useGame } from '@/lib/connection';
import { TIER_LABEL } from '@/lib/protocol';
import { colors, fonts, radius, tierColors } from '@/lib/theme';

const TIERS: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

export function LobbyScreen() {
  const { state, send, leave, error } = useGame();
  const [difficulty, setDifficulty] = useState<1 | 2 | 3 | 4>(2);
  if (!state) return null;

  const isHost = state.youId === state.hostId;
  const count = state.players.length;
  const canStart = isHost && count >= 3 && count <= 5;

  let hint: string;
  if (!isHost) hint = 'Waiting for host to start…';
  else if (count < 3) hint = `Need at least 3 players to start (${count}/5).`;
  else if (count > 5) hint = 'Too many players (max 5).';
  else hint = `${count} players ready (max 5).`;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.center}>
        <Panel style={styles.panel}>
          <Text style={styles.heading}>Room</Text>
          <Text style={styles.code}>{state.code}</Text>

          <View style={styles.players}>
            {state.players.map((p) => {
              const tier = p.isBot && p.difficulty ? tierColors[p.difficulty] : null;
              return (
                <View key={p.id} style={[styles.player, !p.connected && styles.playerDim]}>
                  <Text style={styles.playerName}>{p.name}</Text>
                  <View style={styles.playerRight}>
                    {p.id === state.hostId && (
                      <View style={styles.hostBadge}>
                        <Text style={styles.hostBadgeText}>Host</Text>
                      </View>
                    )}
                    {p.isBot && p.difficulty && tier && (
                      <View style={[styles.botBadge, { borderColor: tier.border, backgroundColor: tier.bg }]}>
                        <Text style={[styles.botBadgeText, { color: tier.fg }]}>{TIER_LABEL[p.difficulty]}</Text>
                      </View>
                    )}
                    {p.isBot && isHost && (
                      <Pressable
                        onPress={() => send({ type: 'removeBot', playerId: p.id })}
                        style={styles.removeBot}
                        hitSlop={8}
                      >
                        <Text style={styles.removeBotText}>×</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {isHost && (
            <View style={styles.botControls}>
              <View style={styles.tierRow}>
                {TIERS.map((t) => {
                  const active = t === difficulty;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setDifficulty(t)}
                      style={[styles.tierChip, active && styles.tierChipActive]}
                    >
                      <Text style={[styles.tierChipText, active && styles.tierChipTextActive]}>
                        {TIER_LABEL[t]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Button
                label="Add Bot"
                variant="secondary"
                onPress={() => send({ type: 'addBot', difficulty })}
                disabled={count >= 5}
              />
            </View>
          )}

          <Text style={styles.hint}>{hint}</Text>

          {isHost && <Button label="Start Game" onPress={() => send({ type: 'start' })} disabled={!canStart} />}
          <ErrorText>{error}</ErrorText>
          <Button label="Leave" variant="secondary" onPress={leave} style={styles.leave} />
        </Panel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  panel: { maxWidth: 430 },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 15,
    textTransform: 'uppercase',
    letterSpacing: 3,
    color: colors.creamDim,
    textAlign: 'center',
  },
  code: {
    fontFamily: fonts.serif,
    fontSize: 38,
    fontWeight: '700',
    color: colors.goldBright,
    letterSpacing: 12,
    textAlign: 'center',
    marginTop: 6,
    marginLeft: 12, // optical balance for letterSpacing on last glyph
  },
  players: { marginVertical: 22, gap: 7 },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.26)',
    borderWidth: 1,
    borderColor: colors.goldHairlineSoft,
    borderRadius: radius.sm,
  },
  playerDim: { opacity: 0.45 },
  playerName: { color: colors.cream, fontSize: 14, flexShrink: 1 },
  playerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hostBadge: { backgroundColor: colors.gold, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  hostBadgeText: { color: '#241a06', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  botBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, borderWidth: 1 },
  botBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  removeBot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.goldHairlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBotText: { color: colors.creamDim, fontSize: 14, lineHeight: 16 },
  botControls: { gap: 10, marginBottom: 14 },
  tierRow: { flexDirection: 'row', gap: 6 },
  tierChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.goldHairline,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  tierChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  tierChipText: { color: colors.goldBright, fontSize: 12, fontWeight: '700' },
  tierChipTextActive: { color: '#241a06' },
  hint: { color: colors.creamDim, fontSize: 12, textAlign: 'center', marginBottom: 16, minHeight: 16 },
  leave: { marginTop: 4 },
});
