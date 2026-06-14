import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Linking, Alert, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import {
  collection, addDoc, onSnapshot, updateDoc, doc,
  query, where, orderBy,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { SOSAlert } from "../../types";
import { format } from "date-fns";
import { de } from "date-fns/locale";

// Richtet den Android-Kanal für SOS-Benachrichtigungen mit maximaler Priorität ein
async function setupSOSChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("sos", {
      name: "SOS Notfallmeldungen",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

export default function SOSScreen() {
  const insets = useSafeAreaInsets();
  const { user, familyId } = useAuthStore();

  const [alerts, setAlerts] = useState<SOSAlert[]>([]);
  const [sending, setSending] = useState(false);
  const knownIds = useRef<Set<string>>(new Set());
  const initialLoad = useRef(true);

  useEffect(() => {
    setupSOSChannel();
  }, []);

  // Echtzeit-Abo auf offene SOS-Alerts der eigenen Familie
  useEffect(() => {
    if (!familyId) return;

    const q = query(
      collection(db, "sosAlerts"),
      where("familyId", "==", familyId),
      where("resolved", "==", false),
      orderBy("timestamp", "desc")
    );

    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SOSAlert));
      setAlerts(data);

      // Beim ersten Laden alle IDs als bekannt markieren — keine Benachrichtigung
      if (initialLoad.current) {
        data.forEach((a) => knownIds.current.add(a.id));
        initialLoad.current = false;
        return;
      }

      // Neue Alerts von anderen Familienmitgliedern per lokaler Benachrichtigung melden (nicht auf Web)
      if (Platform.OS !== "web") {
        data.forEach((alert) => {
          if (!knownIds.current.has(alert.id) && alert.userId !== user?.uid) {
            knownIds.current.add(alert.id);
            Notifications.scheduleNotificationAsync({
              identifier: `sos-${alert.id}`,
              content: {
                title: "🆘 SOS-Notruf!",
                body: "Ein Familienmitglied braucht Hilfe und hat seinen Standort geteilt!",
                sound: true,
              },
              trigger: null,
            });
          }
        });
      } else {
        data.forEach((alert) => knownIds.current.add(alert.id));
      }
    });

    return unsub;
  }, [familyId, user?.uid]);

  // GPS-Standort ermitteln und SOS-Alert in Firestore speichern
  const handleSOS = async () => {
    if (!familyId || !user) return;

    Alert.alert(
      "SOS abschicken?",
      "Dein aktueller Standort wird an alle Familienmitglieder gesendet.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Jetzt senden",
          style: "destructive",
          onPress: async () => {
            setSending(true);
            try {
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== "granted") {
                Alert.alert("Kein Zugriff", "Standort-Berechtigung wurde verweigert.");
                return;
              }

              const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              });

              await addDoc(collection(db, "sosAlerts"), {
                userId: user.uid,
                familyId,
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                timestamp: new Date().toISOString(),
                resolved: false,
              });
            } catch (e) {
              Alert.alert("Fehler", "Standort konnte nicht ermittelt werden.");
            } finally {
              setSending(false);
            }
          },
        },
      ]
    );
  };

  // Alert als erledigt markieren
  const handleResolve = (alertId: string) => {
    Alert.alert("Als erledigt markieren?", "Der SOS-Alert wird geschlossen.", [
      { text: "Abbrechen", style: "cancel" },
      {
        text: "Erledigt",
        onPress: () => updateDoc(doc(db, "sosAlerts", alertId), { resolved: true }),
      },
    ]);
  };

  // Standort öffnen: Apple Maps (iOS), Google Maps App (Android) oder Google Maps Browser (Web)
  const openMap = (lat: number, lng: number) => {
    if (Platform.OS === "ios") {
      Linking.openURL(`maps://?ll=${lat},${lng}&q=SOS-Standort`).catch(() =>
        Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)
      );
    } else if (Platform.OS === "android") {
      Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(SOS-Standort)`).catch(() =>
        Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`)
      );
    } else {
      Linking.openURL(`https://www.google.com/maps?q=${lat},${lng}`);
    }
  };

  const renderAlert = ({ item }: { item: SOSAlert }) => {
    const isOwn = item.userId === user?.uid;
    const time = format(new Date(item.timestamp), "d. MMM, HH:mm", { locale: de });

    return (
      <View style={styles.alertCard}>
        <View style={styles.alertHeader}>
          <Text style={styles.alertEmoji}>🆘</Text>
          <View style={styles.alertInfo}>
            <Text style={styles.alertWho}>{isOwn ? "Du (eigener Alert)" : "Familienmitglied"}</Text>
            <Text style={styles.alertTime}>{time} Uhr</Text>
          </View>
        </View>

        <View style={styles.alertActions}>
          <TouchableOpacity
            style={styles.mapButton}
            onPress={() => openMap(item.latitude, item.longitude)}
          >
            <Text style={styles.mapButtonText}>📍 Standort anzeigen</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resolveButton}
            onPress={() => handleResolve(item.id)}
          >
            <Text style={styles.resolveButtonText}>✓ Erledigt</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🆘 SOS Notruf</Text>
      </View>

      {/* Großer roter SOS-Knopf */}
      <View style={styles.sosSection}>
        <TouchableOpacity
          style={[styles.sosButton, sending && styles.sosButtonDisabled]}
          onPress={handleSOS}
          disabled={sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator size="large" color="white" />
          ) : (
            <>
              <Text style={styles.sosButtonText}>SOS</Text>
              <Text style={styles.sosButtonSub}>Standort teilen</Text>
            </>
          )}
        </TouchableOpacity>
        <Text style={styles.sosHint}>Drücken um Notruf mit GPS-Standort zu senden</Text>
      </View>

      {/* Liste offener Alerts */}
      <View style={styles.alertsSection}>
        <Text style={styles.alertsSectionTitle}>
          Offene Notrufe {alerts.length > 0 ? `(${alerts.length})` : ""}
        </Text>

        {alerts.length === 0 ? (
          <View style={styles.noAlerts}>
            <Text style={styles.noAlertsEmoji}>✅</Text>
            <Text style={styles.noAlertsText}>Keine offenen Notrufe</Text>
          </View>
        ) : (
          <FlatList
            data={alerts}
            keyExtractor={(item) => item.id}
            renderItem={renderAlert}
            contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FAFC" },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#fff",
  },
  headerTitle: { fontSize: 22, fontWeight: "bold", color: "#2D3748" },
  sosSection: { alignItems: "center", paddingVertical: 40, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  sosButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#E53E3E",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#E53E3E",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  sosButtonDisabled: { backgroundColor: "#FC8181", shadowOpacity: 0.2 },
  sosButtonText: { fontSize: 40, fontWeight: "900", color: "#fff", letterSpacing: 2 },
  sosButtonSub: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 4, fontWeight: "600" },
  sosHint: { marginTop: 16, fontSize: 13, color: "#718096", textAlign: "center", paddingHorizontal: 40 },
  alertsSection: { flex: 1, padding: 16 },
  alertsSectionTitle: { fontSize: 16, fontWeight: "bold", color: "#2D3748", marginBottom: 12 },
  noAlerts: { flex: 1, justifyContent: "center", alignItems: "center", paddingBottom: 60 },
  noAlertsEmoji: { fontSize: 48, marginBottom: 12 },
  noAlertsText: { fontSize: 15, color: "#718096" },
  alertCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#E53E3E",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  alertHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  alertEmoji: { fontSize: 28, marginRight: 12 },
  alertInfo: { flex: 1 },
  alertWho: { fontSize: 15, fontWeight: "bold", color: "#2D3748" },
  alertTime: { fontSize: 13, color: "#718096", marginTop: 2 },
  alertActions: { flexDirection: "row", gap: 10 },
  mapButton: {
    flex: 1,
    backgroundColor: "#EBF8FF",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  mapButtonText: { fontSize: 13, fontWeight: "600", color: "#3182CE" },
  resolveButton: {
    flex: 1,
    backgroundColor: "#F0FFF4",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  resolveButtonText: { fontSize: 13, fontWeight: "600", color: "#38A169" },
});
