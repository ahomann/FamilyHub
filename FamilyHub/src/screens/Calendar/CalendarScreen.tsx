import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, doc, setDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { format, addDays, startOfWeek } from "date-fns";
import { de } from "date-fns/locale";

// Feste Mahlzeiten-Typen für alle Wochentage
const MEALS = ["Frühstück", "Mittagessen", "Abendessen"] as const;
type MealType = typeof MEALS[number];

const MEAL_ICONS: Record<MealType, string> = {
  "Frühstück": "🌅",
  "Mittagessen": "☀️",
  "Abendessen": "🌙",
};

// Essensplan-Screen: zeigt den wöchentlichen Mahlzeitenplan und ermöglicht das Bearbeiten einzelner Einträge
export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const { familyId } = useAuthStore();
  // Wochenbeginn standardmäßig auf Montag der aktuellen Woche
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [plan, setPlan] = useState<Record<string, Record<MealType, string>>>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<{ date: string; meal: MealType } | null>(null);
  const [inputValue, setInputValue] = useState("");

  // Alle 7 Tage der aktuellen Woche als Date-Objekte
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // Eindeutiger Schlüssel für die angezeigte Woche (wird als Firestore-Dokument-ID-Teil verwendet)
  const weekKey = format(weekStart, "yyyy-MM-dd");

  // Wird ausgeführt wenn familyId oder Woche wechselt: lädt Essensplan der aktuellen Woche aus Firestore in Echtzeit
  useEffect(() => {
    if (!familyId) return;
    const q = query(collection(db, "mealPlans"), where("familyId", "==", familyId), where("weekStart", "==", weekKey));
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const data = snap.docs[0].data();
        setPlan(data.meals || {});
      } else {
        setPlan({});
      }
    });
    return unsub;
  }, [familyId, weekKey]);

  // Öffnet das Bearbeitungs-Modal mit dem aktuellen Wert der gewählten Mahlzeit
  const openEdit = (date: string, meal: MealType) => {
    setEditing({ date, meal });
    setInputValue(plan[date]?.[meal] || "");
    setModalVisible(true);
  };

  // Speichert den geänderten Mahlzeiten-Eintrag als vollständiges Wochen-Dokument in Firestore
  const handleSave = async () => {
    if (!editing || !familyId) return;
    const { date, meal } = editing;
    const newPlan = { ...plan, [date]: { ...(plan[date] || {}), [meal]: inputValue.trim() } };
    setPlan(newPlan);
    // Dokument-ID aus familyId und Wochenschlüssel zusammengesetzt für eindeutige Zuordnung
    const docId = `${familyId}_${weekKey}`;
    await setDoc(doc(db, "mealPlans", docId), { familyId, weekStart: weekKey, meals: newPlan });
    setModalVisible(false);
  };

  // Leert einen einzelnen Mahlzeiten-Eintrag und speichert sofort in Firestore
  const handleClear = async (date: string, meal: MealType) => {
    if (!familyId) return;
    const newPlan = { ...plan, [date]: { ...(plan[date] || {}), [meal]: "" } };
    setPlan(newPlan);
    const docId = `${familyId}_${weekKey}`;
    await setDoc(doc(db, "mealPlans", docId), { familyId, weekStart: weekKey, meals: newPlan });
  };

  return (
    <View style={styles.container}>
      {/* Kopfzeile mit Wochennavigation (vor/zurück) */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>🍽️ Essensplan</Text>
        <View style={styles.weekNav}>
          <TouchableOpacity onPress={() => setWeekStart(addDays(weekStart, -7))} style={styles.navBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.navText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.weekLabel}>
            {format(weekStart, "d. MMM", { locale: de })} – {format(addDays(weekStart, 6), "d. MMM yyyy", { locale: de })}
          </Text>
          <TouchableOpacity onPress={() => setWeekStart(addDays(weekStart, 7))} style={styles.navBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.navText}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollbare Tageskarten für alle 7 Wochentage */}
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 16 }}>
        {weekDays.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const isToday = dateStr === format(new Date(), "yyyy-MM-dd");
          return (
            // Tageskarte: hebt heutigen Tag rot hervor
            <View key={dateStr} style={[styles.dayCard, isToday && styles.dayCardToday]}>
              <Text style={[styles.dayName, isToday && styles.dayNameToday]}>
                {format(day, "EEEE, d. MMMM", { locale: de })}{isToday ? "  •  Heute" : ""}
              </Text>
              {/* Drei Mahlzeiten-Zeilen pro Tag: Antippen öffnet Bearbeitungs-Modal, Gedrückt-Halten löscht */}
              {MEALS.map((meal) => {
                const value = plan[dateStr]?.[meal] || "";
                return (
                  <TouchableOpacity
                    key={meal}
                    style={styles.mealRow}
                    onPress={() => openEdit(dateStr, meal)}
                    onLongPress={() => value ? Alert.alert("Löschen?", `${meal} entfernen?`, [
                      { text: "Abbrechen", style: "cancel" },
                      { text: "Löschen", style: "destructive", onPress: () => handleClear(dateStr, meal) },
                    ]) : null}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.mealIcon}>{MEAL_ICONS[meal]}</Text>
                    <View style={styles.mealInfo}>
                      <Text style={styles.mealLabel}>{meal}</Text>
                      <Text style={value ? styles.mealValue : styles.mealEmpty}>
                        {value || "Antippen zum Eintragen"}
                      </Text>
                    </View>
                    {value ? <Text style={styles.editHint}>✏️</Text> : <Text style={styles.addHint}>＋</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </ScrollView>

      {/* Modal zum Bearbeiten einer einzelnen Mahlzeit */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { paddingBottom: insets.bottom + 24 }]}>
              <Text style={styles.modalTitle}>
                {editing ? `${MEAL_ICONS[editing.meal]} ${editing.meal}` : ""}
              </Text>
              {editing && (
                <Text style={styles.modalDate}>
                  {format(new Date(editing.date), "EEEE, d. MMMM", { locale: de })}
                </Text>
              )}
              <TextInput
                style={styles.input}
                placeholder="Was gibt es? z.B. Spaghetti Bolognese"
                value={inputValue}
                onChangeText={setInputValue}
                multiline
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
              <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.8}>
                <Text style={styles.saveButtonText}>Speichern</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setModalVisible(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.cancelText}>Abbrechen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FAFC" },
  header: { backgroundColor: "#fff", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  title: { fontSize: 22, fontWeight: "bold", color: "#2D3748", marginBottom: 10 },
  weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { padding: 8, minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  navText: { fontSize: 24, color: "#E53E3E", fontWeight: "bold" },
  weekLabel: { fontSize: 14, fontWeight: "600", color: "#4A5568" },
  dayCard: { backgroundColor: "#fff", borderRadius: 12, marginBottom: 12, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  dayCardToday: { borderWidth: 2, borderColor: "#E53E3E" },
  dayName: { fontSize: 14, fontWeight: "bold", color: "#718096", backgroundColor: "#F7FAFC", padding: 10, paddingHorizontal: 14 },
  dayNameToday: { color: "#E53E3E", backgroundColor: "#FFF5F5" },
  mealRow: { flexDirection: "row", alignItems: "center", padding: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: "#F7FAFC", minHeight: 52 },
  mealIcon: { fontSize: 20, marginRight: 12 },
  mealInfo: { flex: 1 },
  mealLabel: { fontSize: 12, color: "#718096", marginBottom: 2 },
  mealValue: { fontSize: 15, color: "#2D3748", fontWeight: "500" },
  mealEmpty: { fontSize: 14, color: "#CBD5E0", fontStyle: "italic" },
  editHint: { fontSize: 14 },
  addHint: { fontSize: 18, color: "#CBD5E0" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#2D3748", marginBottom: 4 },
  modalDate: { fontSize: 14, color: "#718096", marginBottom: 16 },
  input: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 16, minHeight: 80, textAlignVertical: "top" },
  saveButton: { backgroundColor: "#E53E3E", borderRadius: 10, padding: 16, alignItems: "center", marginBottom: 12, minHeight: 52, justifyContent: "center" },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  cancelText: { textAlign: "center", color: "#718096", fontSize: 15, paddingVertical: 8 },
});
