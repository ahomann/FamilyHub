import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator, TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signOut } from "firebase/auth";
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, updateDoc, arrayRemove } from "firebase/firestore";
import { auth, db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";

interface Member {
  uid: string;
  displayName: string;
  email: string;
  role: string;
}

type Tab = "profil" | "familie" | "mitglieder";

// Profil-Screen mit drei Tabs: Profil, Familie, Mitglieder
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, familyId, setUser, setFamilyId } = useAuthStore();
  const [activeTab, setActiveTab] = useState<Tab>("profil");

  // Familie
  const [familyName, setFamilyName] = useState<string>("");
  const [inviteCode, setInviteCode] = useState<string>("");
  const [codeVisible, setCodeVisible] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState("");

  // Mitglieder
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Modals
  const [logoutModal, setLogoutModal] = useState(false);
  const [promoteModal, setPromoteModal] = useState<Member | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [removeModal, setRemoveModal] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);
  const [renameModal, setRenameModal] = useState(false);
  const [newFamilyName, setNewFamilyName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [usernameModal, setUsernameModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState("");

  const isAdmin = user?.role === "admin";

  // Familiendaten und Mitgliederliste aus Firestore laden
  useEffect(() => {
    if (!familyId) return;
    const load = async () => {
      const snap = await getDoc(doc(db, "families", familyId));
      if (snap.exists()) {
        setFamilyName(snap.data().name ?? "");
        setInviteCode(snap.data().inviteCode ?? familyId);
      }
      if (user?.role === "admin") {
        setLoadingMembers(true);
        const q = query(collection(db, "users"), where("familyId", "==", familyId));
        const userSnap = await getDocs(q);
        setMembers(userSnap.docs.map((d) => ({
          uid: d.id,
          displayName: d.data().displayName ?? "Unbekannt",
          email: d.data().email ?? "",
          role: d.data().role ?? "member",
        })));
        setLoadingMembers(false);
      }
    };
    load();
  }, [familyId, user?.role]);

  const handleRemove = async () => {
    if (!removeModal || !familyId) return;
    setRemoving(true);
    try {
      await updateDoc(doc(db, "users", removeModal.uid), { familyId: null, role: "member" });
      await updateDoc(doc(db, "families", familyId), { members: arrayRemove(removeModal.uid) });
      setMembers((prev) => prev.filter((m) => m.uid !== removeModal.uid));
    } catch (e) {
      if (__DEV__) console.error(e);
    } finally {
      setRemoving(false);
      setRemoveModal(null);
    }
  };

  const handlePromote = async () => {
    if (!promoteModal) return;
    setPromoting(true);
    try {
      await updateDoc(doc(db, "users", promoteModal.uid), { role: "admin" });
      setMembers((prev) => prev.map((m) => m.uid === promoteModal.uid ? { ...m, role: "admin" } : m));
    } catch (e) {
      if (__DEV__) console.error(e);
    } finally {
      setPromoting(false);
      setPromoteModal(null);
    }
  };

  const handleRename = async () => {
    if (!newFamilyName.trim()) { setRenameError("Bitte einen Familiennamen eingeben."); return; }
    if (!familyId) return;
    setRenaming(true);
    setRenameError("");
    try {
      await updateDoc(doc(db, "families", familyId), { name: newFamilyName.trim() });
      setFamilyName(newFamilyName.trim());
      setRenameModal(false);
    } catch (e) {
      setRenameError("Fehler beim Speichern. Bitte erneut versuchen.");
      if (__DEV__) console.error(e);
    } finally {
      setRenaming(false);
    }
  };

  const handleRegenerateCode = async () => {
    if (!familyId) return;
    setRegenerating(true);
    setRegenError("");
    try {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const newCode = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
      // Erst neuen Code-Index anlegen, dann Familie aktualisieren, zuletzt alten Index entwerten
      await setDoc(doc(db, "inviteCodes", newCode), { familyId });
      await updateDoc(doc(db, "families", familyId), { inviteCode: newCode });
      if (inviteCode && inviteCode !== newCode) {
        // Alten Code löschen damit er nicht mehr zum Beitritt taugt (Fehler hier nicht kritisch)
        try { await deleteDoc(doc(db, "inviteCodes", inviteCode)); } catch {}
      }
      setInviteCode(newCode);
    } catch (e: any) {
      setRegenError(
        e.code === "permission-denied"
          ? "Keine Berechtigung. Bitte Firebase-Regeln in der Console neu speichern."
          : "Fehler beim Generieren. Bitte erneut versuchen."
      );
    } finally {
      setRegenerating(false);
    }
  };

  // Benutzernamen speichern — prüft Eindeutigkeit und aktualisiert Firestore-Index
  const handleSaveUsername = async () => {
    const normalized = newUsername.trim().toLowerCase();
    if (!normalized) { setUsernameError("Bitte einen Benutzernamen eingeben."); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
      setUsernameError("Nur Buchstaben, Zahlen, _ und - erlaubt.");
      return;
    }
    if (normalized === user?.username) { setUsernameModal(false); return; }
    setSavingUsername(true);
    setUsernameError("");
    try {
      const snap = await getDoc(doc(db, "usernames", normalized));
      if (snap.exists()) { setUsernameError("Dieser Benutzername ist bereits vergeben."); setSavingUsername(false); return; }
      // Reihenfolge wichtig: erst neuen Namen beanspruchen, dann Profil ändern, zuletzt alten freigeben.
      // Schlägt das Beanspruchen fehl, bleibt der alte Name intakt.
      const oldUsername = user?.username;
      await setDoc(doc(db, "usernames", normalized), { uid: user!.uid, email: user!.email });
      await updateDoc(doc(db, "users", user!.uid), { username: normalized });
      if (oldUsername) {
        try { await deleteDoc(doc(db, "usernames", oldUsername)); } catch {}
      }
      setUser({ ...user!, username: normalized });
      setUsernameModal(false);
    } catch (e: any) {
      const msg = e?.code === "permission-denied"
        ? "Keine Berechtigung. Bitte Firebase-Regeln in der Console neu veröffentlichen."
        : `Fehler: ${e?.message ?? "Unbekannt"}`;
      setUsernameError(msg);
      console.error("Username speichern fehlgeschlagen:", e?.code, e?.message);
    } finally {
      setSavingUsername(false);
    }
  };

  const confirmLogout = async () => {
    setLogoutModal(false);
    await signOut(auth);
    setUser(null);
    setFamilyId(null);
  };

  // Tab-Inhalte als separate Render-Funktionen
  const renderProfilTab = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Persönliche Daten */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👤 Persönliche Daten</Text>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Name</Text>
          <Text style={styles.cardValue}>{user?.displayName ?? "—"}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>E-Mail</Text>
          <Text style={styles.cardValue}>{user?.email ?? "—"}</Text>
        </View>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Benutzername</Text>
          <View style={styles.cardRowRight}>
            <Text style={[styles.cardValue, !user?.username && styles.cardValueMuted]}>
              {user?.username ? `@${user.username}` : "Nicht gesetzt"}
            </Text>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => { setNewUsername(user?.username ?? ""); setUsernameError(""); setUsernameModal(true); }}
              activeOpacity={0.8}
            >
              <Text style={styles.editBtnText}>✏️</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={[styles.cardRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.cardLabel}>Rolle</Text>
          <View style={[styles.roleBadge, isAdmin && styles.roleBadgeAdmin]}>
            <Text style={[styles.roleBadgeText, isAdmin && styles.roleBadgeTextAdmin]}>
              {isAdmin ? "👑 Admin" : "👤 Mitglied"}
            </Text>
          </View>
        </View>
      </View>

      {/* Abmelden */}
      <TouchableOpacity style={styles.logoutBtn} onPress={() => setLogoutModal(true)} activeOpacity={0.8}>
        <Text style={styles.logoutText}>Abmelden</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderFamilieTab = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👨‍👩‍👧‍👦 Familie</Text>
        <View style={styles.cardRow}>
          <Text style={styles.cardLabel}>Familienname</Text>
          <View style={styles.cardRowRight}>
            <Text style={styles.cardValue}>{familyName || "—"}</Text>
            {isAdmin && (
              <TouchableOpacity
                style={styles.editBtn}
                onPress={() => { setNewFamilyName(familyName); setRenameError(""); setRenameModal(true); }}
                activeOpacity={0.8}
              >
                <Text style={styles.editBtnText}>✏️</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Einladungscode nur für Admins */}
        {isAdmin && (
          <>
            <View style={[styles.cardRow, !codeVisible && { borderBottomWidth: 0 }]}>
              <Text style={styles.cardLabel}>Einladungscode</Text>
              <TouchableOpacity onPress={() => setCodeVisible(!codeVisible)}>
                <Text style={styles.cardValue}>{codeVisible ? inviteCode : "●●●●●●  anzeigen"}</Text>
              </TouchableOpacity>
            </View>
            {codeVisible && (
              <View style={styles.codeBox}>
                <Text style={styles.codeText}>{inviteCode}</Text>
                <Text style={styles.codeHint}>Diesen Code an Familienmitglieder weitergeben</Text>
                <TouchableOpacity style={styles.regenBtn} onPress={handleRegenerateCode} disabled={regenerating} activeOpacity={0.8}>
                  {regenerating
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.regenBtnText}>🔄 Neuen Code generieren</Text>
                  }
                </TouchableOpacity>
                {regenError ? <Text style={styles.regenError}>{regenError}</Text> : null}
              </View>
            )}
          </>
        )}

        {!isAdmin && (
          <View style={[styles.cardRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.cardLabel}>Meine Rolle</Text>
            <Text style={styles.cardValue}>Mitglied</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );

  const renderMitgliederTab = () => (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>👑 Mitgliederverwaltung</Text>
        {loadingMembers ? (
          <ActivityIndicator color="#E53E3E" style={{ marginTop: 8 }} />
        ) : members.length === 0 ? (
          <Text style={styles.emptyText}>Keine Mitglieder gefunden</Text>
        ) : (
          members.map((m) => (
            <View key={m.uid} style={styles.memberRow}>
              <View style={[styles.memberAvatar, m.role === "admin" && styles.memberAvatarAdmin]}>
                <Text style={styles.memberAvatarText}>{m.displayName.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {m.displayName} {m.uid === user?.uid ? "(Du)" : ""}
                </Text>
                <Text style={styles.memberEmail}>{m.email}</Text>
              </View>
              <View style={styles.memberActions}>
                {m.role === "admin" ? (
                  <View style={styles.adminTag}>
                    <Text style={styles.adminTagText}>Admin</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={styles.promoteBtn} onPress={() => setPromoteModal(m)} activeOpacity={0.8}>
                    <Text style={styles.promoteBtnText}>↑ Admin</Text>
                  </TouchableOpacity>
                )}
                {m.uid !== user?.uid && (
                  <TouchableOpacity style={styles.removeBtn} onPress={() => setRemoveModal(m)} activeOpacity={0.8}>
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "profil", label: "Profil" },
    { key: "familie", label: "Familie" },
    ...(isAdmin ? [{ key: "mitglieder" as Tab, label: "Mitglieder" }] : []),
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Profilkopf */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.displayName?.charAt(0).toUpperCase() ?? "?"}</Text>
        </View>
        <Text style={styles.name}>{user?.displayName ?? "Unbekannt"}</Text>
        {user?.username
          ? <Text style={styles.username}>@{user.username}</Text>
          : <Text style={styles.usernameMuted}>Kein Benutzername</Text>
        }
      </View>

      {/* Tab-Leiste */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
            onPress={() => setActiveTab(tab.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab-Inhalt */}
      <View style={[styles.tabContent, { paddingBottom: insets.bottom + 16 }]}>
        {activeTab === "profil" && renderProfilTab()}
        {activeTab === "familie" && renderFamilieTab()}
        {activeTab === "mitglieder" && renderMitgliederTab()}
      </View>

      {/* Modal: Benutzername bearbeiten */}
      <Modal visible={usernameModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Benutzername</Text>
            <TextInput
              style={styles.modalInput}
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder="benutzername"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSaveUsername}
            />
            <Text style={styles.inputHint}>Buchstaben, Zahlen, _ und - erlaubt</Text>
            {usernameError ? <Text style={styles.modalError}>{usernameError}</Text> : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setUsernameModal(false)} activeOpacity={0.8}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleSaveUsername} disabled={savingUsername} activeOpacity={0.8}>
                {savingUsername ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>Speichern</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Familienname ändern */}
      <Modal visible={renameModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Familienname ändern</Text>
            <TextInput
              style={styles.modalInput}
              value={newFamilyName}
              onChangeText={setNewFamilyName}
              placeholder="Neuer Familienname"
              autoCapitalize="words"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRename}
            />
            {renameError ? <Text style={styles.modalError}>{renameError}</Text> : null}
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setRenameModal(false)} activeOpacity={0.8}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleRename} disabled={renaming} activeOpacity={0.8}>
                {renaming ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>Speichern</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Mitglied zum Admin hochstufen */}
      <Modal visible={!!promoteModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Zum Admin machen?</Text>
            <Text style={styles.modalText}>
              Möchtest du {promoteModal?.displayName} zum Admin ernennen?{"\n"}
              Admin-Rechte können nicht rückgängig gemacht werden.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setPromoteModal(null)} activeOpacity={0.8}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handlePromote} disabled={promoting} activeOpacity={0.8}>
                {promoting ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>Ernennen</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Mitglied entfernen */}
      <Modal visible={!!removeModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Mitglied entfernen?</Text>
            <Text style={styles.modalText}>
              Möchtest du {removeModal?.displayName} aus der Familie entfernen?{"\n"}
              Die Person verliert sofort den Zugriff auf alle Familiendaten.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setRemoveModal(null)} activeOpacity={0.8}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleRemove} disabled={removing} activeOpacity={0.8}>
                {removing ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>Entfernen</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Abmelden */}
      <Modal visible={logoutModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Abmelden</Text>
            <Text style={styles.modalText}>Möchtest du dich wirklich abmelden?</Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setLogoutModal(false)} activeOpacity={0.8}>
                <Text style={styles.modalCancelText}>Abbrechen</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmLogout} activeOpacity={0.8}>
                <Text style={styles.modalConfirmText}>Abmelden</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7FAFC" },

  // Header
  header: { alignItems: "center", paddingVertical: 20, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#EDF2F7" },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: "#E53E3E", justifyContent: "center", alignItems: "center", marginBottom: 10 },
  avatarText: { fontSize: 28, fontWeight: "bold", color: "#fff" },
  name: { fontSize: 20, fontWeight: "bold", color: "#2D3748", marginBottom: 2 },
  username: { fontSize: 14, color: "#4299E1", fontWeight: "600" },
  usernameMuted: { fontSize: 13, color: "#A0AEC0" },

  // Tabs
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  tabItem: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: "#E53E3E" },
  tabLabel: { fontSize: 14, fontWeight: "600", color: "#A0AEC0" },
  tabLabelActive: { color: "#E53E3E" },

  // Tab-Inhalt
  tabContent: { flex: 1, padding: 16 },

  // Karten
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  cardTitle: { fontSize: 15, fontWeight: "bold", color: "#2D3748", marginBottom: 12 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F7FAFC" },
  cardLabel: { fontSize: 14, color: "#718096" },
  cardValue: { fontSize: 14, color: "#4299E1", fontWeight: "600" },
  cardValueMuted: { color: "#A0AEC0" },
  cardRowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  editBtn: { backgroundColor: "#EBF8FF", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  editBtnText: { fontSize: 14 },

  // Rolle
  roleBadge: { backgroundColor: "#EDF2F7", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 3 },
  roleBadgeAdmin: { backgroundColor: "#FFF5F5", borderWidth: 1, borderColor: "#E53E3E" },
  roleBadgeText: { fontSize: 12, color: "#718096", fontWeight: "600" },
  roleBadgeTextAdmin: { color: "#E53E3E" },

  // Einladungscode
  codeBox: { backgroundColor: "#FFF5F5", borderRadius: 10, padding: 14, marginTop: 10, alignItems: "center" },
  codeText: { fontSize: 28, fontWeight: "bold", color: "#E53E3E", letterSpacing: 6, marginBottom: 4 },
  codeHint: { fontSize: 12, color: "#718096", marginBottom: 10 },
  regenBtn: { backgroundColor: "#E53E3E", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  regenBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  regenError: { color: "#C53030", fontSize: 12, marginTop: 6, textAlign: "center" },

  // Mitglieder
  emptyText: { fontSize: 14, color: "#718096", textAlign: "center", paddingVertical: 8 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F7FAFC" },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#718096", justifyContent: "center", alignItems: "center", marginRight: 10 },
  memberAvatarAdmin: { backgroundColor: "#E53E3E" },
  memberAvatarText: { fontSize: 16, fontWeight: "bold", color: "#fff" },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: "600", color: "#2D3748" },
  memberEmail: { fontSize: 12, color: "#718096", marginTop: 1 },
  memberActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  adminTag: { backgroundColor: "#FFF5F5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "#E53E3E" },
  adminTagText: { fontSize: 12, color: "#E53E3E", fontWeight: "bold" },
  promoteBtn: { backgroundColor: "#EBF8FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#4299E1" },
  promoteBtnText: { fontSize: 12, color: "#4299E1", fontWeight: "bold" },
  removeBtn: { backgroundColor: "#FFF5F5", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#E53E3E" },
  removeBtnText: { fontSize: 12, color: "#E53E3E", fontWeight: "bold" },

  // Abmelden
  logoutBtn: { backgroundColor: "#fff", borderWidth: 2, borderColor: "#E53E3E", borderRadius: 12, padding: 16, alignItems: "center", marginTop: 8 },
  logoutText: { color: "#E53E3E", fontSize: 16, fontWeight: "bold" },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" },
  modalBox: { backgroundColor: "#fff", borderRadius: 16, padding: 24, width: "85%", maxWidth: 340 },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#2D3748", marginBottom: 8, textAlign: "center" },
  modalText: { fontSize: 15, color: "#718096", textAlign: "center", marginBottom: 24, lineHeight: 22 },
  modalInput: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, fontSize: 16, marginBottom: 8 },
  modalError: { color: "#C53030", fontSize: 13, marginBottom: 8, textAlign: "center" },
  inputHint: { fontSize: 12, color: "#718096", marginBottom: 12, textAlign: "center" },
  modalButtons: { flexDirection: "row", gap: 12 },
  modalCancel: { flex: 1, backgroundColor: "#F7FAFC", borderRadius: 10, padding: 14, alignItems: "center" },
  modalCancelText: { color: "#4A5568", fontWeight: "600", fontSize: 15 },
  modalConfirm: { flex: 1, backgroundColor: "#E53E3E", borderRadius: 10, padding: 14, alignItems: "center" },
  modalConfirmText: { color: "#fff", fontWeight: "bold", fontSize: 15 },
});
