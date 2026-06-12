# FamilyHub — Kontext für neuen Chat (Stand 12.06.2026)

## Wie weitermachen
Im neuen Chat sagen: "Lies bitte C:\claude\Project_Family_Wall\KONTEXT.md und mach weiter"

---

## Projekt
React Native / Expo SDK 56 App "FamilyHub" für Familienverwaltung.
**Pfad:** `C:\claude\Project_Family_Wall\FamilyHub`
**Firebase Projekt-ID:** `family-hub-app-6d428`

## Permanente Regeln (IMMER einhalten)
1. **Sicherheit:** .env für Firebase-Keys, Firestore-Regeln prüfen, keine Keys im Code
2. **Kommentare:** Bei jeder Änderung deutsche Wartungskommentare einfügen (Funktionen, useEffects, JSX-Abschnitte) — niemals StyleSheet-Einträge kommentieren

## Was heute fertig wurde (12.06.2026)

### Benutzername-System
- Registrierung: Benutzername-Feld (Format: Buchstaben, Zahlen, _ und -, keine Längenbeschränkung)
- Login: E-Mail ODER Benutzername möglich
- Eindeutigkeitsprüfung vor Anlage
- Profil: Benutzername nachträglich setzbar und bearbeitbar (mit Eindeutigkeitsprüfung)
- `usernames/{username}` Collection als Index: nur get erlaubt, kein list

### ProfileScreen — Tab-Navigation
- Tab "Profil": Name, E-Mail, Benutzername (✏️), Rolle, Abmelden
- Tab "Familie": Familienname (Admin: bearbeitbar), Einladungscode mit Code-Generator
- Tab "Mitglieder": nur für Admins sichtbar — Hochstufen, Entfernen
- Fixer Header mit Avatar, Name, Benutzername über allen Tabs

### Security-Audit (kritische Lücken geschlossen)
- families-Collection: war öffentlich auflistbar → jetzt list:false, nur Mitglieder dürfen get
- Privilege Escalation: jeder konnte sich selbst Admin machen → Schreibregeln auf 3 Übergänge beschränkt
- usernames-Collection: war auflistbar (E-Mail-Abgriff) → jetzt list:false
- Beitritt: konnte beliebige Felder überschreiben → affectedKeys-Prüfung
- SOSAlerts: familyId wird jetzt beim create geprüft

### Neues Einladungscode-System
- Familien haben jetzt zufällige Firestore-IDs (addDoc, nicht mehr Code als ID)
- Neue Collection `inviteCodes/{code}` → `{ familyId }`: nur get, kein list
- Code-Rotation löscht alten inviteCodes-Eintrag sofort

## Wichtige Dateien
```
FamilyHub/
  App.tsx                              ← onAuthStateChanged Listener
  src/
    screens/Auth/LoginScreen.tsx       ← Login per E-Mail oder Benutzername, Registrierung
    screens/Family/FamilySetupScreen.tsx ← Familie erstellen/beitreten (nutzt inviteCodes-Index)
    screens/Profile/ProfileScreen.tsx  ← Tab-Navigation: Profil / Familie / Mitglieder
    screens/Health/HealthScreen.tsx
    navigation/AppNavigator.tsx
    store/authStore.ts                 ← Zustand: user, familyId, loading
    types/index.ts                     ← User-Interface hat jetzt username-Feld
    config/firebase.ts
  firebase.rules/firestore.rules       ← MUSS manuell in Firebase Console deployed werden!
  .env                                 ← Firebase-Keys (nie committen)
```

## Firestore Collections (aktueller Stand)
- `users/{uid}` — Profil, username, role, familyId
- `families/{randomId}` — name, inviteCode, members, createdBy
- `inviteCodes/{code}` — { familyId } — Index für Beitritt per Code
- `usernames/{username}` — { uid, email } — Index für Login per Benutzername
- `shoppingLists`, `mealPlans`, `birthdays`, `recipes`, `healthTargets`, `bloodPressure`, `diabetesDiary`, `sosAlerts`

## Firestore-Regeln
**WICHTIG:** Nach jeder Regeländerung manuell in Firebase Console kopieren:
→ console.firebase.google.com → Projekt family-hub-app-6d428 → Firestore → Regeln → Veröffentlichen

## Offene Punkte (Priorität)
1. **SOFORT:** Firebase Rules in Firebase Console veröffentlichen (neue Regeln aus heute)
2. **SOFORT:** Für bestehende Familie einmalig "Neuen Code generieren" drücken (inviteCodes-Index anlegen)
3. EAS Build für iOS & Android einrichten (Asana-Task war fällig 13.06)
4. Einkaufslisten mit Firestore Echtzeit-Sync (Phase 2)
5. Geburtstags-Push-Benachrichtigungen
6. SOS-Screen mit GPS

## Git
- Git installiert (v2.54.0.windows.1)
- GitHub-Repo: https://github.com/ahomann/FamilyHub.git
- Repo liegt auf Project_Family_Wall-Ebene (inkl. KONTEXT.md + Dokumentation)
- Push: `cd C:\claude\Project_Family_Wall && git add . && git commit -m "..." && git push`

## Asana
- Token: siehe `reference_asana.md` in lokalem Memory (nie im Repo speichern)
- Workspace GID: `1215587111547021`
- Projekt GID: `1215603437115694`
