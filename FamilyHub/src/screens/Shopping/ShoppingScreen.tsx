import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, Modal, KeyboardAvoidingView, FlatList, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  collection, addDoc, onSnapshot, doc, query,
  where, Timestamp, updateDoc, deleteDoc,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { z } from "zod";

const itemSchema = z.object({
  name: z.string().min(1, "Artikel erforderlich").max(100, "Artikel zu lang"),
});

interface ShoppingItem {
  id: string;
  name: string;
  createdAt: Timestamp;
}

interface SavedArticle {
  id: string;
  familyId: string;
  name: string;
  createdAt: Timestamp;
}

interface ShoppingList {
  id: string;
  familyId: string;
  items: ShoppingItem[];
  createdBy: string;
  createdAt: Timestamp;
}

export default function ShoppingScreen() {
  const insets = useSafeAreaInsets();
  const { familyId, user } = useAuthStore();

  const [currentList, setCurrentList] = useState<ShoppingList | null>(null);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [itemModalVisible, setItemModalVisible] = useState(false);
  const [suggestions, setSuggestions] = useState<SavedArticle[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [managingArticles, setManagingArticles] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Abonniere die aktuelle Einkaufsliste — Real-time Sync mit Firestore
  useEffect(() => {
    if (!familyId) return;

    const q = query(
      collection(db, "shoppingLists"),
      where("familyId", "==", familyId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const lists = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as ShoppingList[];

      if (lists.length === 0) {
        createDefaultList();
      } else {
        setCurrentList(lists[0]);
      }
    });

    return () => unsubscribe();
  }, [familyId]);

  // Abonniere gespeicherte Artikel — für Autocomplete
  useEffect(() => {
    if (!familyId) return;

    const q = query(
      collection(db, "shoppingHistory"),
      where("familyId", "==", familyId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const articles = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      })) as SavedArticle[];

      setSavedArticles(articles);
    });

    return () => unsubscribe();
  }, [familyId]);

  const createDefaultList = async () => {
    try {
      const docRef = await addDoc(collection(db, "shoppingLists"), {
        familyId,
        items: [],
        createdBy: user?.uid,
        createdAt: Timestamp.now(),
      });

      setCurrentList({
        id: docRef.id,
        familyId: familyId!,
        items: [],
        createdBy: user?.uid || "",
        createdAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Fehler beim Erstellen der Liste:", error);
    }
  };

  const handleTextChange = (text: string) => {
    setNewItemName(text);

    if (text.length > 0) {
      const filtered = savedArticles.filter((article) =>
        article.name.toLowerCase().startsWith(text.toLowerCase())
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (articleName: string) => {
    setNewItemName(articleName);
    setShowSuggestions(false);
  };

  const addItem = async () => {
    if (!currentList) return;

    try {
      const validated = itemSchema.parse({ name: newItemName });

      const newItem: ShoppingItem = {
        id: Date.now().toString(),
        name: validated.name,
        createdAt: Timestamp.now(),
      };

      const updatedItems = [...currentList.items, newItem];
      await updateDoc(doc(db, "shoppingLists", currentList.id), {
        items: updatedItems,
      });

      // Speichere in History, falls noch nicht gespeichert
      if (!savedArticles.find((a) => a.name.toLowerCase() === validated.name.toLowerCase())) {
        await addDoc(collection(db, "shoppingHistory"), {
          familyId,
          name: validated.name,
          createdAt: Timestamp.now(),
        });
      }

      setNewItemName("");
      setItemModalVisible(false);
      setShowSuggestions(false);
    } catch (error: any) {
      console.error("Fehler:", error.message);
    }
  };

  // Abhaken = sofort löschen
  const markItemAsChecked = async (itemId: string) => {
    if (!currentList) return;

    try {
      const updatedItems = currentList.items.filter((item) => item.id !== itemId);

      // Lokalen State sofort aktualisieren für besseres UX
      setCurrentList({ ...currentList, items: updatedItems });

      await updateDoc(doc(db, "shoppingLists", currentList.id), {
        items: updatedItems,
      });
    } catch (error) {
      console.error("Fehler beim Löschen:", error);
    }
  };

  const deleteSavedArticle = async (articleId: string) => {
    try {
      await deleteDoc(doc(db, "shoppingHistory", articleId));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error("Fehler beim Löschen:", error);
    }
  };

  if (!currentList) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Text style={styles.loadingText}>Lädt...</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🛒 Einkaufsliste</Text>
        <TouchableOpacity onPress={() => setManagingArticles(!managingArticles)}>
          <Text style={styles.settingsButton}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {managingArticles ? (
        <View style={styles.managementContainer}>
          <Text style={styles.managementTitle}>Gespeicherte Artikel</Text>
          <FlatList
            data={savedArticles}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.savedArticleRow}>
                <Text style={styles.savedArticleName}>{item.name}</Text>
                {confirmDeleteId === item.id ? (
                  <View style={styles.confirmRow}>
                    <TouchableOpacity onPress={() => setConfirmDeleteId(null)} style={styles.confirmNo}>
                      <Text style={styles.confirmNoText}>Nein</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteSavedArticle(item.id)} style={styles.confirmYes}>
                      <Text style={styles.confirmYesText}>Löschen</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setConfirmDeleteId(item.id)}>
                    <Text style={styles.deleteIcon}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.noSavedText}>Noch keine Artikel gespeichert</Text>
            }
          />
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => setManagingArticles(false)}
          >
            <Text style={styles.doneButtonText}>Fertig</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <FlatList
            data={currentList.items}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.itemRow}
                activeOpacity={0.7}
                onPress={() => markItemAsChecked(item.id)}
              >
                <Text style={styles.bulletHollow}>○</Text>
                <Text style={styles.itemName}>{item.name}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>Keine Artikel auf der Liste</Text>
                <Text style={styles.emptySubtext}>Tippe + Artikel um etwas hinzuzufügen</Text>
              </View>
            }
            style={styles.itemsList}
          />

          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setItemModalVisible(true)}
          >
            <Text style={styles.addButtonText}>+ Artikel</Text>
          </TouchableOpacity>
        </>
      )}

      <Modal
        transparent
        animationType="slide"
        visible={itemModalVisible}
        onRequestClose={() => {
          setItemModalVisible(false);
          setShowSuggestions(false);
        }}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Neuer Artikel</Text>

            <TextInput
              style={styles.input}
              placeholder="z.B. Milch, Käse, Brot..."
              value={newItemName}
              onChangeText={handleTextChange}
              placeholderTextColor="#A0AEC0"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addItem}
            />

            {showSuggestions && suggestions.length > 0 && (
              <View style={styles.suggestionsBox}>
                {suggestions.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.suggestionItem}
                    onPress={() => selectSuggestion(item.name)}
                  >
                    <Text style={styles.suggestionText}>{item.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setNewItemName("");
                  setItemModalVisible(false);
                  setShowSuggestions(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Abbrechen</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.confirmButton]}
                onPress={addItem}
              >
                <Text style={styles.confirmButtonText}>Hinzufügen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7FAFC",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#2D3748",
  },
  settingsButton: {
    fontSize: 24,
  },
  managementContainer: {
    flex: 1,
    padding: 16,
  },
  managementTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2D3748",
    marginBottom: 16,
  },
  savedArticleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#CBD5E0",
  },
  savedArticleName: {
    fontSize: 15,
    color: "#2D3748",
    flex: 1,
  },
  deleteIcon: {
    fontSize: 18,
    color: "#FC8181",
  },
  confirmRow: {
    flexDirection: "row",
    gap: 8,
  },
  confirmNo: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#EDF2F7",
  },
  confirmNoText: {
    fontSize: 13,
    color: "#4A5568",
    fontWeight: "500",
  },
  confirmYes: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#FC8181",
  },
  confirmYesText: {
    fontSize: 13,
    color: "white",
    fontWeight: "600",
  },
  noSavedText: {
    fontSize: 14,
    color: "#A0AEC0",
    textAlign: "center",
    marginTop: 20,
  },
  doneButton: {
    backgroundColor: "#4FD1C5",
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  doneButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "white",
  },
  itemsList: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: "#4FD1C5",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  bulletHollow: {
    fontSize: 22,
    color: "#2D3748",
    marginRight: 12,
    lineHeight: 26,
  },
  itemName: {
    flex: 1,
    fontSize: 16,
    color: "#2D3748",
    fontWeight: "500",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#718096",
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: "#A0AEC0",
  },
  addButton: {
    backgroundColor: "#4FD1C5",
    marginHorizontal: 16,
    marginBottom: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  modalContainer: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: "white",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 30,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2D3748",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#F7FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    color: "#2D3748",
    marginBottom: 12,
  },
  suggestionsBox: {
    backgroundColor: "#F7FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 8,
    marginBottom: 16,
    maxHeight: 150,
    overflow: "hidden",
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  suggestionText: {
    fontSize: 14,
    color: "#4FD1C5",
    fontWeight: "500",
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "#EDF2F7",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4A5568",
  },
  confirmButton: {
    backgroundColor: "#4FD1C5",
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
  loadingText: {
    flex: 1,
    textAlignVertical: "center",
    textAlign: "center",
    fontSize: 16,
    color: "#A0AEC0",
  },
});
