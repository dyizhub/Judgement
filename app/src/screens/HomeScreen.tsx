import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, ErrorText, Field, GameTitle, Panel } from '@/components/ui';
import { useGame } from '@/lib/connection';
import { colors, fonts } from '@/lib/theme';

export function HomeScreen() {
  const { create, join, error, connected } = useGame();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const onCreate = () => {
    const n = name.trim();
    if (!n) return setLocalError('Enter your name first.');
    setLocalError(null);
    create(n);
  };

  const onJoin = () => {
    const n = name.trim();
    if (!n) return setLocalError('Enter your name first.');
    const c = code.trim();
    if (!c) return setLocalError('Enter a room code.');
    setLocalError(null);
    join(c, n);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <Panel style={styles.panel}>
          <GameTitle>Judgement</GameTitle>
          <Text style={styles.subtitle}>The classic trick-taking card game</Text>

          <Field
            placeholder="Your name"
            value={name}
            onChangeText={setName}
            maxLength={16}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <View style={{ height: 16 }} />
          <Button label="Create Room" onPress={onCreate} disabled={!connected} />

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Field
            placeholder="Room code"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect={false}
            style={styles.codeField}
          />
          <View style={{ height: 16 }} />
          <Button label="Join Room" onPress={onJoin} variant="secondary" disabled={!connected} />

          <ErrorText>{localError ?? error}</ErrorText>
          {!connected && <Text style={styles.connecting}>Connecting to server…</Text>}
        </Panel>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  panel: { maxWidth: 390 },
  subtitle: {
    fontFamily: fonts.serif,
    fontSize: 13,
    fontStyle: 'italic',
    color: colors.creamDim,
    textAlign: 'center',
    marginBottom: 26,
  },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.goldHairline },
  dividerText: {
    color: colors.creamDim,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 2,
    paddingHorizontal: 14,
  },
  codeField: { textAlign: 'center', letterSpacing: 6, fontWeight: '700' },
  connecting: { color: colors.creamDim, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
