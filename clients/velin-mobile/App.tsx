// =============================================================================
// Velín — root komponenta + navigace
// =============================================================================
// Strom obrazovek:
//
//   Stack:
//     Gate         — kontrola JWT, rozhoduje kam pokračovat
//     Login        — HolyOS přihlášení (username + heslo)
//     Tabs         — hlavní část po loginu
//       └── MyDay  — dnešní plán
//       └── Chat   — chat (DM + kanály + task chaty)
//       └── Me     — profil + odhlášení
//     TaskDetail   — detail úkolu (stack push z MyDay)
//     ChatThread   — konkrétní chat (stack push z ChatList)
//
// Status bar je světlý (na tmavém pozadí).

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import * as Updates from 'expo-updates';
import Gate from './screens/Gate';
import Login from './screens/Login';
import MyDay from './screens/MyDay';
import Me from './screens/Me';
import TaskDetail from './screens/TaskDetail';
import ChatList from './screens/ChatList';
import ChatThread from './screens/ChatThread';
import NewChat from './screens/NewChat';
import { colors } from './lib/theme';

// =============================================================================
// OTA Updates — tichá kontrola při startu
// =============================================================================
// V dev (`expo start`) Updates.isEnabled === false → useEffect okamžitě skončí.
// V preview/production buildu se na startu zeptáme EAS Update, jestli existuje
// novější bundle pro aktuální runtimeVersion (= app.version z app.json). Pokud
// ano, stáhneme a hned reloadneme app; jinak pojede aktuální verze.
async function checkForOtaUpdate(): Promise<void> {
  if (!Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Tichý fail — bez sítě / EAS výpadek apod. Appka pojede s aktuálním bundle.
  }
}

export type RootStackParamList = {
  Gate: undefined;
  Login: undefined;
  Tabs: undefined;
  TaskDetail: { taskId: number };
  ChatThread: { channelId: string; channelTitle?: string };
  NewChat: undefined;
};

export type TabsParamList = {
  MyDay: undefined;
  Chat: undefined;
  Me: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

function TabsRoot() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.text2,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="MyDay"
        component={MyDay}
        options={{
          title: 'Dnes',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>📅</Text>,
        }}
      />
      <Tabs.Screen
        name="Chat"
        component={ChatList}
        options={{
          title: 'Chat',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>💬</Text>,
        }}
      />
      <Tabs.Screen
        name="Me"
        component={Me}
        options={{
          title: 'Já',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22, color }}>👤</Text>,
        }}
      />
    </Tabs.Navigator>
  );
}

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    border: colors.border,
    primary: colors.accent,
    text: colors.text,
  },
};

export default function App() {
  useEffect(() => {
    checkForOtaUpdate();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        <Stack.Navigator
          initialRouteName="Gate"
          screenOptions={{ headerShown: false, animation: 'fade' }}
        >
          <Stack.Screen name="Gate" component={Gate} />
          <Stack.Screen name="Login" component={Login} />
          <Stack.Screen name="Tabs" component={TabsRoot} />
          <Stack.Screen
            name="TaskDetail"
            component={TaskDetail}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="ChatThread"
            component={ChatThread}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="NewChat"
            component={NewChat}
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
