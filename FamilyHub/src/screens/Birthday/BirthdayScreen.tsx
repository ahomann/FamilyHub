import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, Alert, KeyboardAvoidingView, Platform, type TextInput as TI,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, addDoc, onSnapshot, deleteDoc, doc, query, orderBy, where } from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { Birthday } from "../../types";
import { format, differenceInDays, setYear, isBefore, addYears } from "date-fns";
import { de } from "date-fns/locale";
import { requestNotificationPermissions, scheduleBirthdayNotifications } from "../../utils/birthdayNotifications";

// Berechnet die Anzahl der Tage bis zum nächsten Geburtstag (jährlich rollierend)
function daysUntilBirthday(dateStr: string): number {
  const today = new Date();
  const bday = new Date(dateStr);
  let next = setYear(bday, today.getFullYear());
  if (isBefore(next, today)) next = addYears(next, 1);
  return differenceInDays(next, today);
}

// Berechnet das aktuelle Alter einer Person anhand des Geburtsdatums
function getAge(dateStr: string): number {
  const bday = new Date(dateStr);
  const today = new Date();
  let age = today.getFullYear() - bday.getFullYear();
  const m = today.getMonth() - bday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) age--;
  return age;
}

// Geburtstags-Screen: zeigt alle Familien-Geburtstage sortiert nach Nähe und ermöglicht das Hinzufügen/Löschen
export default function BirthdayScreen() {
  const insets = useSafeAreaInsets();
  const { familyId } = useAuthStore();
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [relation, setRelation] = useState("");

  const refRelation = useRef<TI>(null);
  const refYear = useRef<TI>(null);

  // Einmalig beim Start: Benachrichtigungs-Berechtigung anfragen
  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  // Benachrichtigungen neu planen sobald sich die Geburtstagsliste ändert
  useEffect(() => {
    if (birthdays.length > 0) {
      scheduleBirthdayNotifications(birthdays);
    }
  }, [birthdays]);

  // Wird ausgeführt wenn familyId verfügbar ist: abonniert Echtzeit-Updates der Geburtstage aus Firestore
  useEffect(() => {
    if (!familyId) return;
    // Server-seitiger familyId-Filter: holt nur Einträge der eigenen Familie (kein clientseitiges Filtern fremder Daten)
    const q = query(collection(db, "birthdays"), where("familyId", "==", familyId), orderBy("date"));
    const unsub = onSnapshot(q, (snap) => {
      // Nach verbleibenden Tagen bis zum nächsten Geburtstag sortieren
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Birthday))
        .sort((a, b) => daysUntilBirthday(a.date) - daysUntilBirthday(b.date));
      setBirthdays(data);
    });
    return unsub;
  }, [familyId]);

  // Validiert und speichert einen neuen Geburtstag in Firestore
  const handleAdd = async () => {
    if (!name || !day || !month || !year) {
      Alert.alert("Fehler", "Bitte alle Felder ausfüllen.");
      return;
    }
    const dateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    if (isNaN(Date.parse(dateStr))) {
      Alert.alert("Fehler", "Ungültiges Datum.");
      return;
    }
    await addDoc(collection(db, "birthdays"), { familyId, name, date: dateStr, relation: relation || "" });
    setName(""); setDay(""); setMonth(""); setYear(""); setRelation("");
    setModalVisible(false);
  };

  // Zeigt Bestätigungsdialog vor dem Löschen eines Geburtstags
  const handleDelete = (id: string, personName: string) => {
    Alert.alert("Löschen", `${personName} wirklich entfernen?`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: () => deleteDoc(doc(db, "birthdays", id)) },
    ]);
  };

  // Rendert eine einzelne Geburtstagskarte mit Hervorhebung für heute und bald
  const renderItem = ({ item }: { item: Birthday }) => {
    const days = daysUntilBirthday(item.date);
    // Nächstes Alter: bei heutigem Geburtstag das aktuelle Alter, sonst das kommende
    const age = getAge(item.date) + (days === 0 ? 0 : 1);
    const isToday = days === 0;
    const isSoon = days <= 7;
    return (
      <TouchableOpacity
        style={[styles.card, isToday && styles.cardToday, isSoon && !isToday && styles.cardSoon]}
        onLongPress={() => handleDelete(item.id, item.name)}
        activeOpacity={0.7}
      >
        <Text style={styles.cardEmoji}>{isToday ? "🎉" : "🎂"}</Text>
        <View style={styles.cardInfo}>
          <Text style={styles.cardName}>{item.name}</Text>
          {item.relation ? <Text style={styles.cardRelation}>{item.relation}</Text> : null}
          <Text style={styles.cardDate}>{format(new Date(item.date), "d. MMMM", { locale: de })} · wird {age}</Text>
        </View>
        {/* Tage-Anzeige: "Heute!" oder Countdown-Zahl */}
        <View style={styles.cardDays}>
          {isToday ? (
            <Text style={styles.daysToday}>Heute!</Text>
          ) : (
            <>
              <Text style={[styles.daysNumber, isSoon && styles.daysSoon]}>{days}</Text>
              <Text style={styles.daysLabel}>Tage</Text>
            </>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Kopfzeile mit Titel und Hinzufügen-Button */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>🎂 Geburtstage</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
          <Text style={styles.addButtonText}>+ Hinzufügen</Text>
        </TouchableOpacity>
      </View>

      {/* Leer-Zustand oder Liste der Geburtstage */}
      {birthdays.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🎈</Text>
          <Text style={styles.emptyText}>Noch keine Geburtstage</Text>
          <Text style={styles.emptyHint}>Tippe auf "+ Hinzufügen"</Text>
        </View>
      ) : (
        <FlatList
          data={birthdays}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 16 }}
        />
      )}

      {/* Modal für das Hinzufügen eines neuen Geburtstags */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { paddingBottom: insets.bottom + 24 }]}>
              <Text style={styles.modalTitle}>Geburtstag hinzufügen</Text>
              <TextInput style={styles.input} placeholder="Name" value={name} onChangeText={setName} autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => refRelation.current?.focus()} autoFocus />
              <TextInput ref={refRelation} style={styles.input} placeholder="Beziehung (z.B. Mama, Bruder)" value={relation} onChangeText={setRelation} returnKeyType="next" onSubmitEditing={() => refYear.current?.focus()} />
              {/* Datum-Eingabe aufgeteilt in Tag, Monat und Jahr */}
              <View style={styles.dateRow}>
                <TextInput style={[styles.input, styles.dateField]} placeholder="TT" value={day} onChangeText={setDay} keyboardType="number-pad" maxLength={2} />
                <TextInput style={[styles.input, styles.dateField]} placeholder="MM" value={month} onChangeText={setMonth} keyboardType="number-pad" maxLength={2} />
                <TextInput ref={refYear} style={[styles.input, styles.dateFieldYear]} placeholder="JJJJ" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} returnKeyType="done" onSubmitEditing={handleAdd} />
              </View>
              <TouchableOpacity style={styles.saveButton} onPress={handleAdd} activeOpacity={0.8}>
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  title: { fontSize: 22, fontWeight: "bold", color: "#2D3748" },
  addButton: { backgroundColor: "#E53E3E", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, justifyContent: "center" },
  addButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyEmoji: { fontSize: 60, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: "bold", color: "#2D3748" },
  emptyHint: { fontSize: 14, color: "#718096", marginTop: 4 },
  card: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardToday: { backgroundColor: "#FFF5F5", borderWidth: 2, borderColor: "#E53E3E" },
  cardSoon: { backgroundColor: "#FFFAF0", borderWidth: 1, borderColor: "#ED8936" },
  cardEmoji: { fontSize: 28, marginRight: 12 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: "bold", color: "#2D3748" },
  cardRelation: { fontSize: 13, color: "#718096", marginTop: 1 },
  cardDate: { fontSize: 13, color: "#4A5568", marginTop: 3 },
  cardDays: { alignItems: "center", minWidth: 48 },
  daysNumber: { fontSize: 22, fontWeight: "bold", color: "#4299E1" },
  daysSoon: { color: "#ED8936" },
  daysLabel: { fontSize: 11, color: "#718096" },
  daysToday: { fontSize: 14, fontWeight: "bold", color: "#E53E3E" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#2D3748", marginBottom: 16 },
  input: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 16, minHeight: 50 },
  dateRow: { flexDirection: "row", gap: 8 },
  dateField: { flex: 1 },
  dateFieldYear: { flex: 2 },
  saveButton: { backgroundColor: "#E53E3E", borderRadius: 10, padding: 16, alignItems: "center", marginBottom: 12, minHeight: 52, justifyContent: "center" },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  cancelText: { textAlign: "center", color: "#718096", fontSize: 15, paddingVertical: 8 },
});
