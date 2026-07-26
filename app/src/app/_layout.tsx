import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FeltBackground } from '@/components/FeltBackground';
import { GameProvider } from '@/lib/connection';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.felt950 }}>
      <SafeAreaProvider>
        <GameProvider>
          <StatusBar style="light" />
          <FeltBackground />
          {/* Navigator theme must be transparent too — react-navigation's default
              theme paints an opaque background over the felt layer. */}
          <ThemeProvider
            value={{
              ...DarkTheme,
              colors: { ...DarkTheme.colors, background: 'transparent', card: 'transparent' },
            }}
          >
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: 'transparent' },
              }}
            >
              <Stack.Screen name="index" />
            </Stack>
          </ThemeProvider>
        </GameProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
