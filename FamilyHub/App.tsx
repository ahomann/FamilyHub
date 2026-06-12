import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./src/config/firebase";
import { useAuthStore } from "./src/store/authStore";
import AppNavigator from "./src/navigation/AppNavigator";

// Haupt-App-Komponente: initialisiert Firebase-Auth-Listener und rendert die Navigation
export default function App() {
  const { setUser, setFamilyId, setLoading } = useAuthStore();

  // Wird beim App-Start einmalig ausgeführt: überwacht den Firebase-Anmeldestatus und lädt Benutzerdaten + familyId aus Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUser(data as any);
          // familyId aus Firestore in den Store laden — bestimmt ob FamilySetup oder Hauptapp gezeigt wird
          setFamilyId(data.familyId ?? null);
        }
        // Dokument existiert noch nicht (Race-Condition während Registrierung) — Store nicht zurücksetzen,
        // LoginScreen läuft noch und setzt den Store selbst nach dem setDoc-Aufruf
      } else {
        setUser(null);
        setFamilyId(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // App-Rahmen: SafeArea + GestureHandler als Pflicht-Provider für die gesamte App
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <AppNavigator />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
