import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Modal, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { collection, addDoc, onSnapshot, deleteDoc, doc, query, where } from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";

const CATEGORIES = ["Alle", "Frühstück", "Mittagessen", "Abendessen", "Dessert", "Snack", "Backen"];
const CATEGORY_ICONS: Record<string, string> = {
  "Frühstück": "🌅", "Mittagessen": "☀️", "Abendessen": "🌙",
  "Dessert": "🍰", "Snack": "🍎", "Backen": "🥐", "Alle": "📖",
};

interface Recipe {
  id: string; familyId: string; name: string; category: string;
  duration: string; servings: string; ingredients: string; steps: string; notes: string;
}

// Rezept-Screen: Übersicht, Suche, Detailansicht und Neueingabe von Familienrezepten
export default function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { familyId } = useAuthStore();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [filter, setFilter] = useState("Alle");
  const [search, setSearch] = useState("");
  const [listModal, setListModal] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [selected, setSelected] = useState<Recipe | null>(null);

  // Formularfelder für das Anlegen eines neuen Rezepts
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Abendessen");
  const [duration, setDuration] = useState("");
  const [servings, setServings] = useState("");
  const [ingredients, setIngredients] = useState("");
  const [steps, setSteps] = useState("");
  const [notes, setNotes] = useState("");

  // Wird ausgeführt wenn familyId verfügbar ist: abonniert alle Rezepte der Familie in Echtzeit
  useEffect(() => {
    if (!familyId) return;
    const q = query(collection(db, "recipes"), where("familyId", "==", familyId));
    return onSnapshot(q, (snap) => {
      setRecipes(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Recipe)));
    });
  }, [familyId]);

  // Setzt alle Formularfelder auf den Ausgangszustand zurück
  const resetForm = () => {
    setName(""); setCategory("Abendessen"); setDuration("");
    setServings(""); setIngredients(""); setSteps(""); setNotes("");
  };

  // Validiert Pflichtfelder und speichert ein neues Rezept in Firestore
  const handleSave = async () => {
    if (!name.trim() || !ingredients.trim() || !steps.trim()) {
      Alert.alert("Fehler", "Name, Zutaten und Zubereitung sind Pflichtfelder.");
      return;
    }
    await addDoc(collection(db, "recipes"), {
      familyId, name: name.trim(), category, duration, servings,
      ingredients: ingredients.trim(), steps: steps.trim(), notes: notes.trim(),
    });
    resetForm();
    setEditModal(false);
  };

  // Zeigt Bestätigungsdialog vor dem Löschen und schließt das Detail-Modal nach dem Löschen
  const handleDelete = (recipe: Recipe) => {
    Alert.alert("Rezept löschen", `"${recipe.name}" wirklich löschen?`, [
      { text: "Abbrechen", style: "cancel" },
      { text: "Löschen", style: "destructive", onPress: async () => {
        await deleteDoc(doc(db, "recipes", recipe.id));
        setDetailModal(false);
      }},
    ]);
  };

  // Filtert Rezepte nach aktiver Kategorie und Suchtext gleichzeitig
  const filtered = recipes.filter((r) => {
    const matchCat = filter === "Alle" || r.category === filter;
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Öffnet das Detailmodal für ein ausgewähltes Rezept
  const openDetail = (recipe: Recipe) => { setSelected(recipe); setDetailModal(true); };

  return (
    <View style={styles.container}>
      {/* Kopfzeile mit Titel und Button zum Anlegen eines neuen Rezepts */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>📖 Rezeptbox</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => { resetForm(); setEditModal(true); }} activeOpacity={0.8}>
          <Text style={styles.addButtonText}>+ Rezept</Text>
        </TouchableOpacity>
      </View>

      {/* Suchfeld für Rezepte nach Name */}
      <View style={styles.searchRow}>
        <TextInput style={styles.searchInput} placeholder="🔍 Rezept suchen..." value={search} onChangeText={setSearch} clearButtonMode="while-editing" />
      </View>

      {/* Horizontale Kategorie-Filter-Chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        {CATEGORIES.map((cat) => (
          <TouchableOpacity key={cat} style={[styles.filterChip, filter === cat && styles.filterChipActive]} onPress={() => setFilter(cat)} activeOpacity={0.7}>
            <Text style={[styles.filterChipText, filter === cat && styles.filterChipTextActive]}>{CATEGORY_ICONS[cat]} {cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Leer-Zustand oder Liste der gefilterten Rezepte */}
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>👨‍🍳</Text>
          <Text style={styles.emptyText}>Noch keine Rezepte</Text>
          <Text style={styles.emptyHint}>Tippe auf "+ Rezept" um loszulegen</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 16 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => openDetail(item)} activeOpacity={0.7}>
              <Text style={styles.cardEmoji}>{CATEGORY_ICONS[item.category] || "🍴"}</Text>
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{item.name}</Text>
                <View style={styles.cardMeta}>
                  <Text style={styles.cardMetaText}>{item.category}</Text>
                  {item.duration ? <Text style={styles.cardMetaText}>⏱ {item.duration}</Text> : null}
                  {item.servings ? <Text style={styles.cardMetaText}>👥 {item.servings}</Text> : null}
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Detail-Modal: Vollansicht eines Rezepts mit Zutaten, Zubereitungsschritten und Tipps */}
      <Modal visible={detailModal} animationType="slide">
        <View style={[styles.detailContainer, { paddingTop: insets.top }]}>
          <View style={styles.detailHeader}>
            <TouchableOpacity onPress={() => setDetailModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backBtn}>‹ Zurück</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => selected && handleDelete(selected)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.deleteBtn}>🗑️</Text>
            </TouchableOpacity>
          </View>
          {selected && (
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }}>
              <Text style={styles.detailEmoji}>{CATEGORY_ICONS[selected.category] || "🍴"}</Text>
              <Text style={styles.detailTitle}>{selected.name}</Text>
              {/* Metadaten-Badges: Dauer, Portionen, Kategorie */}
              <View style={styles.detailMeta}>
                {selected.duration ? <View style={styles.metaBadge}><Text style={styles.metaBadgeText}>⏱ {selected.duration}</Text></View> : null}
                {selected.servings ? <View style={styles.metaBadge}><Text style={styles.metaBadgeText}>👥 {selected.servings} Portionen</Text></View> : null}
                <View style={styles.metaBadge}><Text style={styles.metaBadgeText}>{selected.category}</Text></View>
              </View>
              {/* Zutaten: jede Zeile des Freitextfeldes wird als einzelner Punkt dargestellt */}
              <Text style={styles.sectionTitle}>🛒 Zutaten</Text>
              <View style={styles.sectionBox}>
                {selected.ingredients.split("\n").filter(Boolean).map((line, i) => (
                  <Text key={i} style={styles.ingredientLine}>• {line}</Text>
                ))}
              </View>
              {/* Zubereitungsschritte: jede Zeile wird nummeriert dargestellt */}
              <Text style={styles.sectionTitle}>👨‍🍳 Zubereitung</Text>
              <View style={styles.sectionBox}>
                {selected.steps.split("\n").filter(Boolean).map((line, i) => (
                  <View key={i} style={styles.stepRow}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                    <Text style={styles.stepText}>{line}</Text>
                  </View>
                ))}
              </View>
              {/* Optionaler Tipps-Bereich, nur wenn Notizen vorhanden */}
              {selected.notes ? (
                <>
                  <Text style={styles.sectionTitle}>💡 Tipps & Notizen</Text>
                  <View style={styles.sectionBox}><Text style={styles.notesText}>{selected.notes}</Text></View>
                </>
              ) : null}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Eingabe-Modal: Formular zum Anlegen eines neuen Rezepts */}
      <Modal visible={editModal} animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.detailContainer, { paddingTop: insets.top }]}>
            <View style={styles.detailHeader}>
              <TouchableOpacity onPress={() => setEditModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.backBtn}>✕ Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.saveBtn}>Speichern</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.formLabel}>Rezeptname *</Text>
              <TextInput style={styles.input} placeholder="z.B. Spaghetti Carbonara" value={name} onChangeText={setName} returnKeyType="next" />
              {/* Kategorie-Auswahl als horizontale Chip-Leiste */}
              <Text style={styles.formLabel}>Kategorie</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8 }}>
                {CATEGORIES.filter(c => c !== "Alle").map((cat) => (
                  <TouchableOpacity key={cat} style={[styles.filterChip, category === cat && styles.filterChipActive]} onPress={() => setCategory(cat)}>
                    <Text style={[styles.filterChipText, category === cat && styles.filterChipTextActive]}>{CATEGORY_ICONS[cat]} {cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              {/* Dauer und Portionen nebeneinander */}
              <View style={styles.row}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.formLabel}>⏱ Dauer</Text>
                  <TextInput style={styles.input} placeholder="z.B. 30 Min." value={duration} onChangeText={setDuration} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>👥 Portionen</Text>
                  <TextInput style={styles.input} placeholder="z.B. 4" value={servings} onChangeText={setServings} keyboardType="number-pad" />
                </View>
              </View>
              {/* Mehrzeilige Pflichtfelder für Zutaten und Zubereitungsschritte */}
              <Text style={styles.formLabel}>🛒 Zutaten * (eine pro Zeile)</Text>
              <TextInput style={[styles.input, styles.multiline]} placeholder={"200g Spaghetti\n150g Speck\n2 Eier\n..."} value={ingredients} onChangeText={setIngredients} multiline />
              <Text style={styles.formLabel}>👨‍🍳 Zubereitung * (ein Schritt pro Zeile)</Text>
              <TextInput style={[styles.input, styles.multiline]} placeholder={"Wasser aufkochen\nSpeck anbraten\n..."} value={steps} onChangeText={setSteps} multiline />
              <Text style={styles.formLabel}>💡 Tipps & Notizen</Text>
              <TextInput style={[styles.input, styles.multiline]} placeholder="Optional..." value={notes} onChangeText={setNotes} multiline />
            </ScrollView>
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
  searchRow: { padding: 12, backgroundColor: "#fff" },
  searchInput: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 10, fontSize: 15, minHeight: 44 },
  filterBar: { backgroundColor: "#fff", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E2E8F0", maxHeight: 52 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", minHeight: 36, justifyContent: "center" },
  filterChipActive: { backgroundColor: "#E53E3E", borderColor: "#E53E3E" },
  filterChipText: { fontSize: 13, color: "#4A5568" },
  filterChipTextActive: { color: "#fff", fontWeight: "bold" },
  empty: { flex: 1, justifyContent: "center", alignItems: "center" },
  emptyEmoji: { fontSize: 60, marginBottom: 12 },
  emptyText: { fontSize: 18, fontWeight: "bold", color: "#2D3748" },
  emptyHint: { fontSize: 14, color: "#718096", marginTop: 4 },
  card: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2, minHeight: 64 },
  cardEmoji: { fontSize: 28, marginRight: 12 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: "bold", color: "#2D3748" },
  cardMeta: { flexDirection: "row", gap: 10, marginTop: 4 },
  cardMetaText: { fontSize: 12, color: "#718096" },
  chevron: { fontSize: 22, color: "#CBD5E0" },
  detailContainer: { flex: 1, backgroundColor: "#F7FAFC" },
  detailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0", minHeight: 56 },
  backBtn: { fontSize: 16, color: "#E53E3E", fontWeight: "600" },
  deleteBtn: { fontSize: 20 },
  saveBtn: { fontSize: 16, color: "#E53E3E", fontWeight: "bold" },
  detailEmoji: { fontSize: 50, textAlign: "center", marginBottom: 8 },
  detailTitle: { fontSize: 26, fontWeight: "bold", color: "#2D3748", textAlign: "center", marginBottom: 12 },
  detailMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center", marginBottom: 20 },
  metaBadge: { backgroundColor: "#EBF4FF", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  metaBadgeText: { fontSize: 13, color: "#4299E1", fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#2D3748", marginBottom: 8, marginTop: 4 },
  sectionBox: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 16 },
  ingredientLine: { fontSize: 15, color: "#4A5568", marginBottom: 4 },
  stepRow: { flexDirection: "row", marginBottom: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#E53E3E", color: "#fff", fontWeight: "bold", fontSize: 13, textAlign: "center", lineHeight: 24, marginRight: 10, marginTop: 1 },
  stepText: { flex: 1, fontSize: 15, color: "#4A5568", lineHeight: 22 },
  notesText: { fontSize: 15, color: "#4A5568", lineHeight: 22 },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#4A5568", marginBottom: 6 },
  input: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 16, minHeight: 48 },
  multiline: { minHeight: 100, textAlignVertical: "top" },
  row: { flexDirection: "row" },
});
