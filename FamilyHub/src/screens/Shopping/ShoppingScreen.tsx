import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, FlatList, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  collection, addDoc, onSnapshot, deleteDoc, doc, query,
  where, Timestamp, updateDoc,
} from "firebase/firestore";
import { db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";
import { z } from "zod";

// Validierung für Einkaufslisten
const shoppingListSchema = z.object({
  name: z.string().min(1, "Name erforderlich").max(50, "Name zu lang"),
});

const itemSchema = z.object({
  name: z.string().min(1, "Artikel erforderlich").max(100, "Artikel zu lang"),
});

// Datenstrukturen
interface ShoppingItem {
  id: string;
  name: string;
  checked: boolean;
  createdAt: Timestamp;
}

interface ShoppingList {
  id: string;
  familyId: string;
  name: string;
  items: ShoppingItem[];
  createdBy: string;
  createdAt: Timestamp;
}

export default function ShoppingScreen() {
  const insets = useSafeAreaInsets();
  const { familyId, user } = useAuthStore();

  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [selectedList, setSelectedList] = useState<ShoppingList | null>(null);
  const [newListName, setNewListName] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [modalVisible, setModalVisible] = useState(false);
  const [itemModalVisible, setItemModalVisible] = useState(false);

  // Abonniere Einkaufslisten für die Familie — Real-time Sync mit Firestore
  useEffect(() => {
    if (!familyId) return;

    const q = query(
      collection(db, "shoppingLists"),
      where("familyId", "==", familyId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const listsData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ShoppingList[];

      setLists(listsData);
      // Wenn aktuelle Liste gelöscht wurde, setze Auswahl zurück
      if (
        selectedList &&
        !listsData.find((l) => l.id === selectedList.id)
      ) {
        setSelectedList(null);
      }
    });

    return () => unsubscribe();
  }, [familyId, selectedList]);

  // Erstelle neue Einkaufsliste
  const createList = async () => {
    try {
      const validated = shoppingListSchema.parse({ name: newListName });

      await addDoc(collection(db, "shoppingLists"), {
        familyId,
        name: validated.name,
        items: [],
        createdBy: user?.uid,
        createdAt: Timestamp.now(),
      });

      setNewListName("");
      setModalVisible(false);
    } catch (error: any) {
      Alert.alert("Fehler", error.message);
    }
  };

  // Füge Artikel zu Liste hinzu
  const addItem = async () => {
    if (!selectedList) return;

    try {
      const validated = itemSchema.parse({ name: newItemName });

      const newItem: ShoppingItem = {
        id: Date.now().toString(),
        name: validated.name,
        checked: false,
        createdAt: Timestamp.now(),
      };

      const updatedItems = [...selectedList.items, newItem];
      await updateDoc(doc(db, "shoppingLists", selectedList.id), {
        items: updatedItems,
      });

      setNewItemName("");
      setItemModalVisible(false);
    } catch (error: any) {
      Alert.alert("Fehler", error.message);
    }
  };

  // Markiere Artikel als erledigt/nicht erledigt
  const toggleItem = async (itemId: string) => {
    if (!selectedList) return;

    const updatedItems = selectedList.items.map((item) =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );

    await updateDoc(doc(db, "shoppingLists", selectedList.id), {
      items: updatedItems,
    });
  };

  // Lösche Artikel
  const deleteItem = async (itemId: string) => {
    if (!selectedList) return;

    const updatedItems = selectedList.items.filter((item) => item.id !== itemId);
    await updateDoc(doc(db, "shoppingLists", selectedList.id), {
      items: updatedItems,
    });
  };

  // Lösche Liste
  const deleteList = async (listId: string) => {
    Alert.alert(
      "Liste löschen?",
      "Diese Aktion kann nicht rückgängig gemacht werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: async () => {
            await deleteDoc(doc(db, "shoppingLists", listId));
            setSelectedList(null);
          },
        },
      ]
    );
  };

  if (!selectedList) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🛒 Einkaufslisten</Text>
        </View>

        <ScrollView style={styles.listContainer}>
          {lists.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Keine Einkaufslisten vorhanden</Text>
            </View>
          ) : (
            lists.map((list) => (
              <TouchableOpacity
                key={list.id}
                style={styles.listCard}
                onPress={() => setSelectedList(list)}
              >
                <View>
                  <Text style={styles.listName}>{list.name}</Text>
                  <Text style={styles.listItemCount}>
                    {list.items.filter((i) => !i.checked).length} von{" "}
                    {list.items.length} Artikel
                  </Text>
                </View>
                <Text style={styles.arrow}>→</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setModalVisible(true)}
        >
          <Text style={styles.addButtonText}>+ Neue Liste</Text>
        </TouchableOpacity>

        {/* Modal für neue Liste */}
        <Modal
          transparent
          animationType="slide"
          visible={modalVisible}
          onRequestClose={() => setModalVisible(false)}
        >
          <KeyboardAvoidingView
            behavior="padding"
            style={styles.modalContainer}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Neue Einkaufsliste</Text>

              <TextInput
                style={styles.input}
                placeholder="Listenname (z.B. 'Wochenmarkt')"
                value={newListName}
                onChangeText={setNewListName}
                placeholderTextColor="#A0AEC0"
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => {
                    setNewListName("");
                    setModalVisible(false);
                  }}
                >
                  <Text style={styles.cancelButtonText}>Abbrechen</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, styles.createButton]}
                  onPress={createList}
                >
                  <Text style={styles.createButtonText}>Erstellen</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    );
  }

  // Detailansicht einer Liste
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.detailHeader}>
        <TouchableOpacity onPress={() => setSelectedList(null)}>
          <Text style={styles.backButton}>← Zurück</Text>
        </TouchableOpacity>
        <Text style={styles.detailTitle}>{selectedList.name}</Text>
        <TouchableOpacity
          onPress={() => deleteList(selectedList.id)}
        >
          <Text style={styles.deleteButton}>🗑️</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={selectedList.items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <TouchableOpacity
              style={styles.checkbox}
              onPress={() => toggleItem(item.id)}
            >
              <Text style={styles.checkboxText}>
                {item.checked ? "✓" : "○"}
              </Text>
            </TouchableOpacity>

            <Text
              style={[
                styles.itemName,
                item.checked && styles.itemNameChecked,
              ]}
            >
              {item.name}
            </Text>

            <TouchableOpacity
              onPress={() => deleteItem(item.id)}
              style={styles.deleteItemButton}
            >
              <Text style={styles.deleteItemText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Keine Artikel hinzugefügt</Text>
          </View>
        }
        style={styles.itemsList}
      />

      <TouchableOpacity
        style={styles.addButton}
        onPress={() => setItemModalVisible(true)}
      >
        <Text style={styles.addButtonText}>+ Artikel hinzufügen</Text>
      </TouchableOpacity>

      {/* Modal für neuen Artikel */}
      <Modal
        transparent
        animationType="slide"
        visible={itemModalVisible}
        onRequestClose={() => setItemModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.modalContainer}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Artikel hinzufügen</Text>

            <TextInput
              style={styles.input}
              placeholder="Artikelname (z.B. 'Milch')"
              value={newItemName}
              onChangeText={setNewItemName}
              placeholderTextColor="#A0AEC0"
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setNewItemName("");
                  setItemModalVisible(false);
                }}
              >
                <Text style={styles.cancelButtonText}>Abbrechen</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.createButton]}
                onPress={addItem}
              >
                <Text style={styles.createButtonText}>Hinzufügen</Text>
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
  listContainer: {
    flex: 1,
    padding: 16,
  },
  listCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "white",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#4FD1C5",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  listName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2D3748",
  },
  listItemCount: {
    fontSize: 12,
    color: "#718096",
    marginTop: 4,
  },
  arrow: {
    fontSize: 20,
    color: "#CBD5E0",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
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
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  backButton: {
    fontSize: 16,
    fontWeight: "600",
    color: "#4FD1C5",
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#2D3748",
  },
  deleteButton: {
    fontSize: 20,
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
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: "#E2E8F0",
  },
  checkbox: {
    marginRight: 12,
  },
  checkboxText: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#4FD1C5",
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    color: "#2D3748",
  },
  itemNameChecked: {
    textDecorationLine: "line-through",
    color: "#A0AEC0",
  },
  deleteItemButton: {
    padding: 8,
  },
  deleteItemText: {
    fontSize: 16,
    color: "#FC8181",
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
    paddingVertical: 10,
    fontSize: 14,
    color: "#2D3748",
    marginBottom: 16,
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
  createButton: {
    backgroundColor: "#4FD1C5",
  },
  createButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "white",
  },
});
