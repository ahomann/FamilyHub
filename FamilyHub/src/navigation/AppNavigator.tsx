import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";
import { Text } from "react-native";
import { useAuthStore } from "../store/authStore";

import LoginScreen from "../screens/Auth/LoginScreen";
import FamilySetupScreen from "../screens/Family/FamilySetupScreen";
import ProfileScreen from "../screens/Profile/ProfileScreen";
import ShoppingScreen from "../screens/Shopping/ShoppingScreen";
import BirthdayScreen from "../screens/Birthday/BirthdayScreen";
import CalendarScreen from "../screens/Calendar/CalendarScreen";
import RecipeScreen from "../screens/Recipe/RecipeScreen";
import HealthScreen from "../screens/Health/HealthScreen";
import SOSScreen from "../screens/SOS/SOSScreen";

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Untere Tab-Leiste mit allen Hauptbereichen der App
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#E53E3E",
        tabBarInactiveTintColor: "#718096",
        headerShown: false,
        tabBarScrollEnabled: true,
        tabBarItemStyle: { width: 90 },
      }}
    >
      <Tab.Screen
        name="Shopping"
        component={ShoppingScreen}
        options={{ tabBarLabel: "Einkauf", tabBarIcon: () => <Text>🛒</Text> }}
      />
      <Tab.Screen
        name="Birthday"
        component={BirthdayScreen}
        options={{ tabBarLabel: "Geburtstage", tabBarIcon: () => <Text>🎂</Text> }}
      />
      <Tab.Screen
        name="Calendar"
        component={CalendarScreen}
        options={{ tabBarLabel: "Essensplan", tabBarIcon: () => <Text>🍽️</Text> }}
      />
      <Tab.Screen
        name="Recipes"
        component={RecipeScreen}
        options={{ tabBarLabel: "Rezepte", tabBarIcon: () => <Text>📖</Text> }}
      />
      <Tab.Screen
        name="Health"
        component={HealthScreen}
        options={{ tabBarLabel: "Gesundheit", tabBarIcon: () => <Text>❤️</Text> }}
      />
      <Tab.Screen
        name="SOS"
        component={SOSScreen}
        options={{ tabBarLabel: "SOS", tabBarIcon: () => <Text>🆘</Text> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: "Profil", tabBarIcon: () => <Text>👤</Text> }}
      />
    </Tab.Navigator>
  );
}

// Haupt-Navigator: Login → FamilySetup (wenn keine familyId) → Haupttabs
export default function AppNavigator() {
  const { user, familyId } = useAuthStore();

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // Nicht eingeloggt → Login anzeigen
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : !familyId ? (
          // Eingeloggt aber noch keiner Familie zugeordnet → Familien-Setup anzeigen
          <Stack.Screen name="FamilySetup" component={FamilySetupScreen} />
        ) : (
          // Eingeloggt und Familie vorhanden → Haupt-App anzeigen
          <Stack.Screen name="Main" component={MainTabs} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
