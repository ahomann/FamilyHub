# FamilyHub — Kontext für neuen Chat (Stand 14.06.2026)

## Wie weitermachen
Im neuen Chat sagen: "Lies bitte C:\claude\FamilyHub\KONTEXT.md und mach weiter"

---

## Projekt
React Native / Expo SDK 56 App "FamilyHub" für Familienverwaltung.
**Pfad:** `C:\claude\FamilyHub\FamilyHub`
**Firebase Projekt-ID:** `family-hub-app-6d428`

## Permanente Regeln (IMMER einhalten)
1. **Sicherheit:** .env für Firebase-Keys, Firestore-Regeln prüfen, keine Keys im Code
2. **Kommentare:** Bei jeder Änderung deutsche Wartungskommentare einfügen (Funktionen, useEffects, JSX-Abschnitte) — niemals StyleSheet-Einträge kommentieren

## Testen
- **Web-Browser (aktuell):** `npx expo start --web` → IP-Adresse im iPhone-Browser öffnen
- **Expo Go:** Warten auf SDK 56 Update im App Store (aktuell Version 54.0.2 installiert)
- **Tunnel (unterwegs):** `npx expo start --tunnel` (ngrok eingerichtet, Expo-Login: ahomann)
- **EAS Build / App Store:** zurückgestellt — kein Apple Developer Account (99$/Jahr zu teuer)

## Was heute fertig wurde (14.06.2026)

### Firebase Rules & Infrastruktur
- Firebase Rules in Firebase Console veröffentlicht (via Firebase CLI)
- `firebase.json` und `.firebaserc` angelegt für künftige Deploys
- Für bestehende Familie einmalig neuen Einladungscode generiert (inviteCodes-Index angelegt)

### Geburtstags-Push-Benachrichtigungen
- Neue Datei: `src/utils/birthdayNotifications.ts`
- Berechtigung anfragen (Android: eigener Notification Channel)
- Am Geburtstag um 9:00 Uhr — jährlich wiederkehrend
- 7 Tage vorher um 9:00 Uhr — Erinnerung
- Benachrichtigungen werden neu geplant wenn sich die Geburtstagsliste ändert
- Web: automatisch deaktiviert (nicht unterstützt)

### SOS-Screen mit GPS (komplett neu implementiert)
- Großer roter SOS-Knopf mit Bestätigungsdialog
- GPS-Standort via `expo-location` (Web: Browser Geolocation API)
- Alert wird in Firestore gespeichert, alle Familienmitglieder sehen ihn in Echtzeit
- "Standort anzeigen": iOS → Apple Maps, Android → Google Maps App, Web → Google Maps Browser
- "Erledigt" Button schließt den Alert
- Lokale Push-Benachrichtigung wenn anderes Familienmitglied SOS drückt (nur nativ, nicht Web)

## Was früher fertig wurde (12.06.2026)

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
  firebase.json                        ← Firebase CLI Konfiguration
  .firebaserc                          ← Projekt-ID für Firebase CLI
  src/
    screens/Auth/LoginScreen.tsx       ← Login per E-Mail oder Benutzername, Registrierung
    screens/Family/FamilySetupScreen.tsx ← Familie erstellen/beitreten (nutzt inviteCodes-Index)
    screens/Profile/ProfileScreen.tsx  ← Tab-Navigation: Profil / Familie / Mitglieder
    screens/Birthday/BirthdayScreen.tsx ← Geburtstage mit Push-Benachrichtigungen
    screens/Shopping/ShoppingScreen.tsx ← Einkaufsliste mit Echtzeit-Sync
    screens/SOS/SOSScreen.tsx          ← SOS-Notruf mit GPS und Google Maps
    screens/Health/HealthScreen.tsx
    navigation/AppNavigator.tsx
    store/authStore.ts                 ← Zustand: user, familyId, loading
    types/index.ts                     ← User-Interface hat jetzt username-Feld
    config/firebase.ts
    utils/birthdayNotifications.ts     ← Push-Benachrichtigungen für Geburtstage
  firebase.rules/firestore.rules       ← MUSS via Firebase CLI deployed werden!
  .env                                 ← Firebase-Keys (nie committen)
```

## Firestore Collections (aktueller Stand)
- `users/{uid}` — Profil, username, role, familyId
- `families/{randomId}` — name, inviteCode, members, createdBy
- `inviteCodes/{code}` — { familyId } — Index für Beitritt per Code
- `usernames/{username}` — { uid, email } — Index für Login per Benutzername
- `shoppingLists`, `shoppingHistory`, `mealPlans`, `birthdays`, `recipes`
- `healthTargets`, `bloodPressure`, `diabetesDiary`
- `sosAlerts` — { userId, familyId, latitude, longitude, timestamp, resolved }

## Firestore-Regeln deployen
```powershell
cd C:\claude\FamilyHub\FamilyHub
firebase deploy --only firestore:rules
```

## Offene Punkte
1. Weitere Features nach Bedarf (Mahlzeitenplan, Rezepte, Gesundheit ausbauen)
2. EAS Build — zurückgestellt bis Apple Developer Account vorhanden

## Git
- Git installiert (v2.54.0.windows.1)
- GitHub-Repo: https://github.com/ahomann/FamilyHub.git
- Repo liegt auf FamilyHub-Ebene (inkl. KONTEXT.md + Dokumentation)

### Normaler Push (Arbeitsrechner)
```powershell
cd C:\claude\FamilyHub
git add .
git status   # prüfen: .env darf NICHT auftauchen
git commit -m "Beschreibung der Änderung"
git push
```

### Erstmaliges Klonen zuhause
```powershell
git clone https://github.com/ahomann/FamilyHub.git
cd FamilyHub\FamilyHub
npm install
```
Danach `.env` manuell anlegen (wird nie ins Repo committed):
```
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=...
(etc.)
```

### Updates zuhause holen
```powershell
cd <Pfad>\FamilyHub
git pull
cd FamilyHub
npm install   # nur nötig wenn package.json geändert wurde
```

### Wichtige Regeln
- **Niemals** Tokens, Keys oder Passwörter in KONTEXT.md oder andere getrackte Dateien
- Asana-Token, Firebase-Keys → nur in `.env` oder lokalem Memory
- `node_modules/` und `.env` sind in `.gitignore` — werden nie committed
- GitHub Push Protection blockiert Secrets automatisch

## Asana
- Token: siehe `reference_asana.md` in lokalem Memory (nie im Repo speichern)
- Workspace GID: `1215587111547021`
- Projekt GID: `1215603437115694`
