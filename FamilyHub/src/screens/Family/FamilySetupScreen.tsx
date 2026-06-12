import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { doc, setDoc, getDoc, updateDoc, arrayUnion, collection, addDoc } from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { User } from "../../types";

// Generiert einen zufälligen 6-stelligen Einladungscode aus Großbuchstaben und Zahlen
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Bildschirm zur Familien-Einrichtung: Neue Familie erstellen oder bestehender beitreten
export default function FamilySetupScreen() {
  const insets = useSafeAreaInsets();
  const { user, setUser, setFamilyId } = useAuthStore();
  const [mode, setMode] = useState<"choose" | "create" | "join" | "created">("choose");
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  // Dokument-ID der neu erstellten Familie (nicht identisch mit dem Einladungscode)
  const [familyIdToSet, setFamilyIdToSet] = useState("");
  const [loading, setLoading] = useState(false);

  // Erstellt eine neue Familie in Firestore und verknüpft den Nutzer damit
  const handleCreate = async () => {
    if (!familyName.trim()) {
      Alert.alert("Fehler", "Bitte einen Familiennamen eingeben.");
      return;
    }
    if (!user?.uid) return;
    setLoading(true);
    try {
      const code = generateInviteCode();
      // Familie mit zufälliger Dokument-ID anlegen (Code ist NICHT die ID — Sicherheit)
      const familyRef = await addDoc(collection(db, "families"), {
        name: familyName.trim(),
        inviteCode: code,
        createdBy: user.uid,
        members: [user.uid],
        createdAt: new Date(),
      });
      // Code-Index anlegen: ermöglicht Beitritt per Code ohne lesbare Familien-Collection
      await setDoc(doc(db, "inviteCodes", code), { familyId: familyRef.id });
      // Gründer wird Admin — erst jetzt, da die Sicherheitsregel die createdBy-Prüfung braucht
      await updateDoc(doc(db, "users", user.uid), { familyId: familyRef.id, role: "admin" });
      setUser({ ...user, role: "admin" });
      setCreatedCode(code);
      setFamilyIdToSet(familyRef.id);
      setMode("created");
    } catch (e: any) {
      Alert.alert("Fehler", "Familie konnte nicht erstellt werden.");
      if (__DEV__) console.error(e.code);
    } finally {
      setLoading(false);
    }
  };

  // Sucht eine Familie anhand des Einladungscodes und fügt den Nutzer als Mitglied hinzu
  const handleJoin = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      Alert.alert("Fehler", "Bitte einen gültigen 6-stelligen Code eingeben.");
      return;
    }
    if (!user?.uid) return;
    setLoading(true);
    try {
      // Code über den inviteCodes-Index nachschlagen (get — Codes sind nicht auflistbar)
      const codeSnap = await getDoc(doc(db, "inviteCodes", code));
      if (!codeSnap.exists()) {
        Alert.alert("Nicht gefunden", "Keine Familie mit diesem Code gefunden.");
        setLoading(false);
        return;
      }
      const familyDocId = codeSnap.data().familyId as string;
      // Reihenfolge wichtig: erst zur Mitgliederliste (Regel-Voraussetzung), dann eigene familyId setzen
      await updateDoc(doc(db, "families", familyDocId), { members: arrayUnion(user.uid) });
      await updateDoc(doc(db, "users", user.uid), { familyId: familyDocId });
      setFamilyId(familyDocId);
    } catch (e: any) {
      Alert.alert("Fehler", "Beitreten fehlgeschlagen.");
      if (__DEV__) console.error(e.code);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#F7FAFC" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Kopfbereich mit Icon und Titel */}
        <Text style={styles.icon}>👨‍👩‍👧‍👦</Text>
        <Text style={styles.title}>Deine Familie</Text>
        <Text style={styles.subtitle}>Erstelle eine neue Familie oder tritt einer bestehenden bei</Text>

        {/* Auswahlmodus: Erstellen oder Beitreten */}
        {mode === "choose" && (
          <View style={styles.choiceContainer}>
            <TouchableOpacity style={styles.choiceBtn} onPress={() => setMode("create")} activeOpacity={0.8}>
              <Text style={styles.choiceIcon}>🏠</Text>
              <Text style={styles.choiceBtnText}>Neue Familie erstellen</Text>
              <Text style={styles.choiceDesc}>Du bist der erste — erstelle eine Familie und lade andere ein</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.choiceBtn, styles.choiceBtnSecondary]} onPress={() => setMode("join")} activeOpacity={0.8}>
              <Text style={styles.choiceIcon}>🔗</Text>
              <Text style={styles.choiceBtnText}>Familie beitreten</Text>
              <Text style={styles.choiceDesc}>Du hast einen Einladungscode erhalten — tritt der Familie bei</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Formular: Neue Familie erstellen */}
        {mode === "create" && (
          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>Neue Familie erstellen</Text>
            <TextInput
              style={styles.input}
              placeholder="Familienname (z.B. Familie Homann)"
              value={familyName}
              onChangeText={setFamilyName}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleCreate}
            />
            <Text style={styles.hint}>Nach dem Erstellen erhältst du einen Einladungscode den du mit deiner Familie teilen kannst.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleCreate} disabled={loading} activeOpacity={0.8}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Familie erstellen</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode("choose")} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.backText}>← Zurück</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Erfolgsmeldung nach dem Erstellen — zeigt den Einladungscode zum Teilen */}
        {mode === "created" && (
          <View style={styles.formContainer}>
            <Text style={styles.successIcon}>🎉</Text>
            <Text style={styles.formTitle}>Familie erstellt!</Text>
            <Text style={styles.hint}>Teile diesen Code mit deiner Familie damit sie beitreten können:</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeDisplay}>{createdCode}</Text>
            </View>
            <Text style={styles.hint}>Der Code kann jederzeit in den Einstellungen wieder angezeigt werden.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setFamilyId(familyIdToSet)} activeOpacity={0.8}>
              <Text style={styles.primaryBtnText}>Weiter zur App →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Formular: Bestehender Familie beitreten */}
        {mode === "join" && (
          <View style={styles.formContainer}>
            <Text style={styles.formTitle}>Familie beitreten</Text>
            <TextInput
              style={[styles.input, styles.codeInput]}
              placeholder="Einladungscode (z.B. AB12CD)"
              value={inviteCode}
              onChangeText={setInviteCode}
              autoCapitalize="characters"
              maxLength={6}
              returnKeyType="done"
              onSubmitEditing={handleJoin}
            />
            <Text style={styles.hint}>Den Einladungscode bekommst du von dem Familienmitglied das die Familie erstellt hat.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={handleJoin} disabled={loading} activeOpacity={0.8}>
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Beitreten</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setMode("choose")} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.backText}>← Zurück</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, alignItems: "center" },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "bold", color: "#2D3748", textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 15, color: "#718096", textAlign: "center", marginBottom: 40, lineHeight: 22 },
  choiceContainer: { width: "100%", gap: 16 },
  choiceBtn: { backgroundColor: "#E53E3E", borderRadius: 14, padding: 20, alignItems: "center" },
  choiceBtnSecondary: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#E53E3E" },
  choiceIcon: { fontSize: 32, marginBottom: 8 },
  choiceBtnText: { fontSize: 17, fontWeight: "bold", color: "#2D3748", marginBottom: 6 },
  choiceDesc: { fontSize: 13, color: "#718096", textAlign: "center", lineHeight: 18 },
  formContainer: { width: "100%" },
  formTitle: { fontSize: 20, fontWeight: "bold", color: "#2D3748", marginBottom: 20, textAlign: "center" },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 12, minHeight: 50 },
  codeInput: { fontSize: 24, fontWeight: "bold", textAlign: "center", letterSpacing: 6 },
  hint: { fontSize: 13, color: "#718096", marginBottom: 20, lineHeight: 20, textAlign: "center" },
  primaryBtn: { backgroundColor: "#E53E3E", borderRadius: 10, padding: 16, alignItems: "center", marginBottom: 16, minHeight: 52, justifyContent: "center" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  backText: { textAlign: "center", color: "#718096", fontSize: 15, paddingVertical: 8 },
  successIcon: { fontSize: 48, textAlign: "center", marginBottom: 12 },
  codeBox: { backgroundColor: "#FFF5F5", borderWidth: 2, borderColor: "#E53E3E", borderRadius: 14, padding: 20, alignItems: "center", marginBottom: 16 },
  codeDisplay: { fontSize: 36, fontWeight: "bold", color: "#E53E3E", letterSpacing: 8 },
});
