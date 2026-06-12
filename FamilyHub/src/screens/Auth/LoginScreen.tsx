import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, deleteUser } from "firebase/auth";
import { doc, setDoc, getDoc, updateDoc, arrayUnion, collection, addDoc } from "firebase/firestore";
import { auth, db } from "../../config/firebase";
import { useAuthStore } from "../../store/authStore";

// Passwort-Anforderungen: mind. 12 Zeichen, Groß- und Kleinbuchstaben, Zahl, Sonderzeichen
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;
// Benutzername: 3–20 Zeichen, nur Buchstaben, Zahlen, Unterstriche und Bindestriche
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 10;
const STORAGE_KEY = "fh_login_lock";

// Generiert einen zufälligen 6-stelligen Einladungscode
function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Hilfsfunktionen für persistente Sperrung im localStorage
const getLockData = (email: string): { attempts: number; lockedUntil: number | null } => {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}_${email.toLowerCase()}`);
    if (!raw) return { attempts: 0, lockedUntil: null };
    return JSON.parse(raw);
  } catch { return { attempts: 0, lockedUntil: null }; }
};

const setLockData = (email: string, attempts: number, lockedUntil: number | null) => {
  try {
    localStorage.setItem(`${STORAGE_KEY}_${email.toLowerCase()}`, JSON.stringify({ attempts, lockedUntil }));
  } catch {}
};

const clearLockData = (email: string) => {
  try { localStorage.removeItem(`${STORAGE_KEY}_${email.toLowerCase()}`); } catch {}
};

// Login- und Registrierungsscreen — Login per E-Mail oder Benutzername möglich
export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [identifier, setIdentifier] = useState("");   // E-Mail oder Benutzername beim Login
  const [password, setPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");             // Nur bei Registrierung
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setUser, setFamilyId } = useAuthStore();

  // Registrierungs-Schritt 2: Familien-Auswahl
  const [familyChoice, setFamilyChoice] = useState<null | "code" | "new">(null);
  const [inviteCode, setInviteCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Gespeicherte Sperrdaten laden wenn Identifier eingetippt wird
  useEffect(() => {
    if (!identifier) return;
    const saved = getLockData(identifier);
    if (saved.lockedUntil && Date.now() < saved.lockedUntil) {
      setLockedUntil(saved.lockedUntil);
      setFailedAttempts(saved.attempts);
      setRemainingSeconds(Math.ceil((saved.lockedUntil - Date.now()) / 1000));
      setErrorMsg(`Zu viele Fehlversuche. Anmeldung für ${LOCKOUT_MINUTES} Minuten gesperrt.`);
    } else if (saved.lockedUntil && Date.now() >= saved.lockedUntil) {
      clearLockData(identifier);
      setFailedAttempts(0);
      setLockedUntil(null);
    } else if (saved.attempts > 0) {
      setFailedAttempts(saved.attempts);
      setErrorMsg(`Bitte erneut versuchen. (${saved.attempts}/${MAX_ATTEMPTS} Fehlversuche)`);
    } else {
      setFailedAttempts(0);
      setLockedUntil(null);
      setErrorMsg("");
    }
  }, [identifier]);

  // Countdown-Timer während der Sperrzeit
  useEffect(() => {
    if (!lockedUntil) return;
    timerRef.current = setInterval(() => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        clearLockData(identifier);
        setLockedUntil(null);
        setFailedAttempts(0);
        setRemainingSeconds(0);
        setErrorMsg("");
        if (timerRef.current) clearInterval(timerRef.current);
      } else {
        setRemainingSeconds(remaining);
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockedUntil]);

  const getErrorMessage = (code: string): string => {
    switch (code) {
      case "auth/user-not-found":
      case "auth/invalid-email":
        return "Diese E-Mail-Adresse oder dieser Benutzername ist nicht registriert.";
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Anmeldedaten sind falsch.";
      case "auth/email-already-in-use":
        return "Diese E-Mail-Adresse ist bereits registriert.";
      case "auth/too-many-requests":
        return "Zu viele Fehlversuche. Bitte kurz warten.";
      case "auth/network-request-failed":
        return "Keine Internetverbindung. Bitte Verbindung prüfen.";
      case "auth/weak-password":
        return "Passwort erfüllt nicht die Mindestanforderungen.";
      default:
        return "Ein Fehler ist aufgetreten. Bitte erneut versuchen.";
    }
  };

  const formatCountdown = (secs: number): string => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // Löst einen Benutzernamen in eine E-Mail-Adresse auf (für Login per Benutzername)
  const resolveEmailFromUsername = async (uname: string): Promise<string> => {
    const snap = await getDoc(doc(db, "usernames", uname.toLowerCase()));
    if (!snap.exists()) throw new Error("username-not-found");
    return snap.data().email as string;
  };

  // Prüft ob Benutzername bereits vergeben ist (usernames erlaubt get auch ohne Login)
  const isUsernameTaken = async (uname: string): Promise<boolean> => {
    const snap = await getDoc(doc(db, "usernames", uname.toLowerCase()));
    return snap.exists();
  };

  // Tritt per Einladungscode einer Familie bei — Code-Lookup über inviteCodes-Index (get, kein list)
  const registerAndJoin = async (uid: string): Promise<string> => {
    const code = inviteCode.trim().toUpperCase();
    const codeSnap = await getDoc(doc(db, "inviteCodes", code));
    if (!codeSnap.exists()) throw new Error("invalid-code");
    const familyDocId = codeSnap.data().familyId as string;
    // Reihenfolge wichtig: erst members-Liste (Regel-Voraussetzung), dann eigene familyId
    await updateDoc(doc(db, "families", familyDocId), { members: arrayUnion(uid) });
    await updateDoc(doc(db, "users", uid), { familyId: familyDocId });
    return familyDocId;
  };

  // Erstellt eine neue Familie (zufällige Dokument-ID) plus Code-Index und macht den Gründer zum Admin
  const registerAndCreate = async (uid: string): Promise<string> => {
    const code = generateInviteCode();
    const familyRef = await addDoc(collection(db, "families"), {
      name: familyName.trim(), inviteCode: code,
      createdBy: uid, members: [uid], createdAt: new Date(),
    });
    await setDoc(doc(db, "inviteCodes", code), { familyId: familyRef.id });
    await updateDoc(doc(db, "users", uid), { familyId: familyRef.id, role: "admin" });
    return familyRef.id;
  };

  const handleAuth = async () => {
    setErrorMsg("");
    if (lockedUntil && Date.now() < lockedUntil) return;

    if (!password) {
      setErrorMsg("Bitte Passwort eingeben.");
      return;
    }

    if (isRegister) {
      // Passwort-Komplexität nur bei Registrierung prüfen — beim Login entscheidet der Server
      if (!PASSWORD_REGEX.test(password)) {
        setErrorMsg(
          "Passwort muss mindestens 12 Zeichen haben sowie Groß- und Kleinbuchstaben, eine Zahl und ein Sonderzeichen enthalten."
        );
        return;
      }
      // Registrierung: alle Felder prüfen
      if (!email.trim()) { setErrorMsg("Bitte E-Mail-Adresse eingeben."); return; }
      if (!username.trim()) { setErrorMsg("Bitte einen Benutzernamen eingeben."); return; }
      if (!USERNAME_REGEX.test(username.trim())) {
        setErrorMsg("Benutzername darf nur Buchstaben, Zahlen, _ und - enthalten.");
        return;
      }
      if (!familyChoice) {
        setErrorMsg("Bitte wählen ob du einen Einladungscode hast oder eine neue Familie erstellen möchtest.");
        return;
      }
      if (familyChoice === "code" && inviteCode.trim().length !== 6) {
        setErrorMsg("Bitte einen gültigen 6-stelligen Einladungscode eingeben.");
        return;
      }
      if (familyChoice === "new" && !familyName.trim()) {
        setErrorMsg("Bitte einen Familiennamen eingeben.");
        return;
      }
    } else {
      if (!identifier.trim()) { setErrorMsg("Bitte E-Mail oder Benutzername eingeben."); return; }
    }

    setLoading(true);
    try {
      if (isRegister) {
        const normalizedUsername = username.trim().toLowerCase();
        const normalizedEmail = email.trim().toLowerCase();
        const name = displayName.trim() || normalizedEmail.split("@")[0];

        // Benutzername vorab prüfen (öffentlicher get) — E-Mail-Duplikate meldet Firebase Auth selbst
        if (await isUsernameTaken(normalizedUsername)) {
          setErrorMsg("Dieser Benutzername ist bereits vergeben. Bitte einen anderen wählen.");
          setLoading(false);
          return;
        }

        // Bei Code-Beitritt: Code vorab über den Index validieren (get ist ohne Login nicht erlaubt,
        // daher erst nach Account-Erstellung — siehe registerAndJoin; hier nur Format geprüft)
        // Auth-Account anlegen
        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
        const role = familyChoice === "new" ? "admin" : "member";

        try {
          // Nutzerprofil anlegen — startet immer als "member" ohne Familie (Sicherheitsregel);
          // die Admin-Rolle vergibt registerAndCreate erst nachdem die Familie existiert
          await setDoc(doc(db, "users", cred.user.uid), {
            uid: cred.user.uid, email: normalizedEmail,
            displayName: name, username: normalizedUsername,
            role: "member", familyId: null,
          });
          // Benutzernamen-Index anlegen (für Login per Benutzername)
          await setDoc(doc(db, "usernames", normalizedUsername), {
            uid: cred.user.uid, email: normalizedEmail,
          });

          // Familie beitreten oder neu anlegen
          const newFamilyId = familyChoice === "code"
            ? await registerAndJoin(cred.user.uid)
            : await registerAndCreate(cred.user.uid);

          setUser({ uid: cred.user.uid, email: normalizedEmail, displayName: name, username: normalizedUsername, role });
          setFamilyId(newFamilyId);
        } catch (innerErr: any) {
          // Firestore-Schritte fehlgeschlagen — halbfertigen Auth-Account wieder entfernen
          try { await deleteUser(cred.user); } catch {}
          setErrorMsg(
            innerErr?.message === "invalid-code"
              ? "Dieser Einladungscode ist ungültig. Bitte den Code beim Admin der Familie anfragen."
              : "Registrierung fehlgeschlagen. Bitte erneut versuchen."
          );
          setLoading(false);
          return;
        }
        clearLockData(normalizedEmail);
        setFailedAttempts(0);
      } else {
        // Login: E-Mail oder Benutzername auflösen
        const input = identifier.trim();
        let loginEmail = input;

        if (!input.includes("@")) {
          // Kein @-Zeichen → als Benutzername behandeln
          try {
            loginEmail = await resolveEmailFromUsername(input);
          } catch {
            setErrorMsg("Dieser Benutzername ist nicht registriert.");
            setLoading(false);
            return;
          }
        }

        const cred = await signInWithEmailAndPassword(auth, loginEmail, password);
        const userDoc = await getDoc(doc(db, "users", cred.user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUser(data as any);
          setFamilyId(data.familyId ?? null);
        }
        clearLockData(input);
        setFailedAttempts(0);
      }
    } catch (e: any) {
      const msg = getErrorMessage(e.code ?? "");
      const newAttempts = failedAttempts + 1;
      setFailedAttempts(newAttempts);
      if (newAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
        setLockData(identifier, newAttempts, until);
        setLockedUntil(until);
        setRemainingSeconds(LOCKOUT_MINUTES * 60);
        setErrorMsg(`Zu viele Fehlversuche. Anmeldung für ${LOCKOUT_MINUTES} Minuten gesperrt.`);
      } else {
        setLockData(identifier, newAttempts, null);
        setErrorMsg(`${msg} (Versuch ${newAttempts}/${MAX_ATTEMPTS})`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Wechsel zwischen Login und Registrierung — alle Felder zurücksetzen
  const switchMode = () => {
    setIsRegister(!isRegister);
    setErrorMsg("");
    setIdentifier("");
    setEmail("");
    setUsername("");
    setDisplayName("");
    setFamilyChoice(null);
    setInviteCode("");
    setFamilyName("");
  };

  const isLocked = !!lockedUntil && Date.now() < lockedUntil;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#F7FAFC" }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* App-Titel */}
        <Text style={styles.title}>Family Hub</Text>
        <Text style={styles.subtitle}>Deine Familien-App</Text>

        {/* Registrierung: Name, Benutzername und E-Mail */}
        {isRegister && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Dein Name (optional)"
              value={displayName}
              onChangeText={setDisplayName}
              autoCapitalize="words"
              returnKeyType="next"
            />
            <TextInput
              style={[styles.input, isLocked && styles.inputDisabled]}
              placeholder="Benutzername (z.B. max_mustermann)"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              editable={!isLocked}
            />
            <Text style={styles.inputHint}>Buchstaben, Zahlen, _ und - erlaubt</Text>
            <TextInput
              style={[styles.input, isLocked && styles.inputDisabled]}
              placeholder="E-Mail-Adresse"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
              editable={!isLocked}
            />
          </>
        )}

        {/* Login: E-Mail oder Benutzername */}
        {!isRegister && (
          <TextInput
            style={[styles.input, isLocked && styles.inputDisabled]}
            placeholder="E-Mail oder Benutzername"
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            editable={!isLocked}
          />
        )}

        <TextInput
          style={[styles.input, isLocked && styles.inputDisabled]}
          placeholder="Passwort"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={!isRegister ? handleAuth : undefined}
          editable={!isLocked}
        />

        {/* Passwort-Anforderungen bei Registrierung */}
        {isRegister && (
          <View style={styles.requirementsBox}>
            <Text style={styles.requirementsTitle}>Passwort-Anforderungen:</Text>
            <Text style={styles.requirementsText}>✓ Mindestens 12 Zeichen</Text>
            <Text style={styles.requirementsText}>✓ Groß- und Kleinbuchstaben (A–Z, a–z)</Text>
            <Text style={styles.requirementsText}>✓ Mindestens eine Zahl (0–9)</Text>
            <Text style={styles.requirementsText}>✓ Mindestens ein Sonderzeichen (!@#$%...)</Text>
          </View>
        )}

        {/* Familien-Auswahl bei Registrierung */}
        {isRegister && (
          <View style={styles.familySection}>
            <Text style={styles.familySectionTitle}>👨‍👩‍👧‍👦 Familie</Text>
            <Text style={styles.familySectionSubtitle}>Hast du bereits einen Einladungscode?</Text>

            <TouchableOpacity
              style={styles.dropdown}
              onPress={() => setDropdownOpen(!dropdownOpen)}
              activeOpacity={0.8}
            >
              <Text style={[styles.dropdownText, !familyChoice && styles.dropdownPlaceholder]}>
                {familyChoice === "code" ? "Ja – Code eingeben" :
                 familyChoice === "new"  ? "Nein – Neue Familie erstellen" :
                 "Bitte auswählen…"}
              </Text>
              <Text style={styles.dropdownArrow}>{dropdownOpen ? "▲" : "▼"}</Text>
            </TouchableOpacity>

            {dropdownOpen && (
              <View style={styles.dropdownMenu}>
                <TouchableOpacity
                  style={[styles.dropdownItem, familyChoice === "code" && styles.dropdownItemActive]}
                  onPress={() => { setFamilyChoice("code"); setDropdownOpen(false); setErrorMsg(""); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dropdownItemText, familyChoice === "code" && styles.dropdownItemTextActive]}>
                    Ja – Code eingeben
                  </Text>
                </TouchableOpacity>
                <View style={styles.dropdownDivider} />
                <TouchableOpacity
                  style={[styles.dropdownItem, familyChoice === "new" && styles.dropdownItemActive]}
                  onPress={() => { setFamilyChoice("new"); setDropdownOpen(false); setErrorMsg(""); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.dropdownItemText, familyChoice === "new" && styles.dropdownItemTextActive]}>
                    Nein – Neue Familie erstellen
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {familyChoice === "code" && (
              <TextInput
                style={[styles.input, styles.codeInput, { marginTop: 10 }]}
                placeholder="Einladungscode (z.B. AB12CD)"
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="characters"
                maxLength={6}
                returnKeyType="done"
              />
            )}

            {familyChoice === "new" && (
              <TextInput
                style={[styles.input, { marginTop: 10 }]}
                placeholder="Familienname (z.B. Familie Homann)"
                value={familyName}
                onChangeText={setFamilyName}
                autoCapitalize="words"
                returnKeyType="done"
              />
            )}
          </View>
        )}

        {/* Fehlermeldung mit Countdown bei Sperrung */}
        {errorMsg ? (
          <View style={[styles.errorBox, isLocked && styles.errorBoxLocked]}>
            <Text style={styles.errorText}>⚠ {errorMsg}</Text>
            {isLocked && (
              <Text style={styles.countdown}>Entsperrung in {formatCountdown(remainingSeconds)}</Text>
            )}
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.button, isLocked && styles.buttonDisabled]}
          onPress={handleAuth}
          disabled={loading || isLocked}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>{isRegister ? "Registrieren & starten" : "Anmelden"}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={switchMode} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} disabled={isLocked}>
          <Text style={[styles.switchText, isLocked && styles.switchTextDisabled]}>
            {isRegister ? "Bereits registriert? Anmelden" : "Neu hier? Konto erstellen"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 },
  title: { fontSize: 36, fontWeight: "bold", textAlign: "center", color: "#E53E3E", marginBottom: 4 },
  subtitle: { fontSize: 16, textAlign: "center", color: "#718096", marginBottom: 40 },
  input: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 16, minHeight: 50 },
  inputDisabled: { backgroundColor: "#EDF2F7", color: "#A0AEC0" },
  inputHint: { fontSize: 12, color: "#718096", marginTop: -10, marginBottom: 14, paddingLeft: 4 },
  codeInput: { fontSize: 22, fontWeight: "bold", textAlign: "center", letterSpacing: 6 },
  requirementsBox: { backgroundColor: "#EBF8FF", borderRadius: 10, padding: 12, marginBottom: 14 },
  requirementsTitle: { fontSize: 13, fontWeight: "bold", color: "#2B6CB0", marginBottom: 4 },
  requirementsText: { fontSize: 12, color: "#2C5282", lineHeight: 20 },
  familySection: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, padding: 16, marginBottom: 16 },
  familySectionTitle: { fontSize: 15, fontWeight: "bold", color: "#2D3748", marginBottom: 4 },
  familySectionSubtitle: { fontSize: 14, color: "#718096", marginBottom: 12 },
  dropdown: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: "#CBD5E0", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dropdownText: { fontSize: 14, color: "#2D3748", fontWeight: "500" },
  dropdownPlaceholder: { color: "#A0AEC0" },
  dropdownArrow: { fontSize: 11, color: "#718096" },
  dropdownMenu: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#CBD5E0", borderRadius: 10, marginTop: 4, overflow: "hidden" },
  dropdownItem: { paddingHorizontal: 14, paddingVertical: 13 },
  dropdownItemActive: { backgroundColor: "#EBF8FF" },
  dropdownItemText: { fontSize: 14, color: "#2D3748" },
  dropdownItemTextActive: { color: "#3182CE", fontWeight: "600" },
  dropdownDivider: { height: 1, backgroundColor: "#EDF2F7" },
  errorBox: { backgroundColor: "#FFF5F5", borderWidth: 1, borderColor: "#FC8181", borderRadius: 10, padding: 12, marginBottom: 14 },
  errorBoxLocked: { backgroundColor: "#FFF5F5", borderColor: "#E53E3E", borderWidth: 2 },
  errorText: { color: "#C53030", fontSize: 14, textAlign: "center", lineHeight: 20 },
  countdown: { color: "#E53E3E", fontSize: 20, fontWeight: "bold", textAlign: "center", marginTop: 8 },
  button: { backgroundColor: "#E53E3E", borderRadius: 10, padding: 16, alignItems: "center", marginBottom: 16, minHeight: 52, justifyContent: "center" },
  buttonDisabled: { backgroundColor: "#A0AEC0" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  switchText: { textAlign: "center", color: "#4299E1", fontSize: 14, paddingVertical: 8 },
  switchTextDisabled: { color: "#A0AEC0" },
});
