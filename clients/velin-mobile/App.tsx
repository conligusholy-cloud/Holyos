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
//     NewChat      — výběr kolegy pro nové DM (modal)
//
// Push deep-link: tap na notifikaci s data.channel_id → otevři ChatThread.
// Status bar je světlý (na tmavém pozadí).

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from 'react-native';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';
import Gate from './screens/Gate';
import Login from './screens/Login';
import MyDay from './screens/MyDay';
import Me from './screens/Me';
import TaskDetail from './screens/TaskDetail';
import ChatList from './screens/ChatList';
import ChatThread from './screens/ChatThread';
import NewChat from './screens/NewChat';
import EveningReflection from './screens/EveningReflection';
import Attendance from './screens/Attendance';
import NewGeoFence from './screens/NewGeoFence';
import { colors } from './lib/theme';

// =============================================================================
// OTA Updates — tichá kontrola při startu
// =============================================================================
async function checkForOtaUpdate(): Promise<void> {
  if (!Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // Tichý fail — bez sítě / EAS výpadek apod.
  }
}

export type RootStackParamList = {
  Gate: undefined;
  Login: undefined;
  Tabs: undefined;
  TaskDetail: { taskId: number };
  ChatThread: { channelId: string; channelTitle?: string };
  NewChat: undefined;
  EveningReflection: undefined;
  Attendance: undefined;
  NewGeoFence: undefined;
};

export type TabsParamList = {
  MyDay: undefined;
  Chat: undefined;
  Me: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<TabsParamList>();

// =============================================================================
// Navigation ref — pro programové navigování z handlerů mimo komponenty
// =============================================================================
// Push notif handler musí naviovat zvenku React stromu (Notifications API
// nemá přístup k useNavigation). Containerref to umožňuje.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

// =============================================================================
// Push deep-link — tap na chat_message notifikaci otevře ChatThread
// =============================================================================
// Backend pošle push s data = { channel_id, message_id, type: 'chat_message' }.
// Když uživatel tapne na notifikaci:
//   1) Pokud má channel_id, naviguj na Tabs → ChatThread.
//   2) Pokud app je studeně otevřená (kliknutí z killed state), pomocí
//      getLastNotificationResponseAsync zachytíme i ten případ.
//
// POZOR: Nezasahujeme do navigace dokud Gate nedoběhne — Gate sám rozhodne,
// zda jít na Login (chybí JWT) nebo Tabs. Pak handler navigace.navigate
// pushne ChatThread na zásobník.
function handleNotificationTap(data: any) {
  if (!data || typeof data !== 'object') return;

  // Routing podle typu/kind notifikace:
  // - kind='evening_reflection' (velin-scheduler 16:30) → EveningReflection modal
  // - channel_id (createNotification pro chat_message) → ChatThread
  // - jinak: žádná specifická navigace, jen otevřít app.
  let target: { name: keyof RootStackParamList; params?: any } | null = null;

  if (data.kind === 'evening_reflection' || data.type === 'evening_reflection') {
    target = { name: 'EveningReflection' };
  } else if (typeof data.channel_id === 'string' && data.channel_id) {
    target = {
      name: 'ChatThread',
      params: {
        channelId: data.channel_id,
        channelTitle: typeof data.title === 'string' ? data.title : undefined,
      },
    };
  }

  if (!target) return;

  // Počkej, až navigation ref bude ready (Gate doběhl). Lehký retry:
  const tryNavigate = (attempts = 0) => {
    if (!navigationRef.isReady()) {
      if (attempts < 20) {
        setTimeout(() => tryNavigate(attempts + 1), 200);
      }
      return;
    }
    try {
      navigationRef.navigate(target!.name as any, target!.params);
    } catch (e) {
      console.warn('[push] navigate failed:', e);
    }
  };
  tryNavigate();
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

export default function App() {
  // OTA check při startu
  useEffect(() => {
    checkForOtaUpdate();
  }, []);

  // Push tap handler — registrujeme jednou při mountu App.
  useEffect(() => {
    // Studený start: app byl zabit, klik na notifikaci ho znovu otevírá.
    // Expo nabízí lastNotificationResponse jako "co bylo posledně tapnuté".
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response?.notification?.request?.content?.data) {
        handleNotificationTap(response.notification.request.content.data);
      }
    });

    // Teplý start / běžící app: listener na nové tapy.
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response?.notification?.request?.content?.data;
        if (data) handleNotificationTap(data);
      }
    );

    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
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
          <Stack.Screen
            name="EveningReflection"
            component={EveningReflection}
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
          <Stack.Screen
            name="Attendance"
            component={Attendance}
            options={{ animation: 'slide_from_right' }}
          />
          <Stack.Screen
            name="NewGeoFence"
            component={NewGeoFence}
            options={{ animation: 'slide_from_bottom', presentation: 'modal' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
