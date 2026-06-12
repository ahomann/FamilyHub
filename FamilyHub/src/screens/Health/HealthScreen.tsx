import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, Platform, Dimensions, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LineChart, BarChart, PieChart } from "react-native-chart-kit";
import {
  collection, addDoc, onSnapshot, deleteDoc, doc, query,
  where, orderBy, Timestamp, updateDoc, setDoc,
} from "firebase/firestore";
import { db, auth } from "../../config/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { useAuthStore } from "../../store/authStore";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import DateTimePicker from "@react-native-community/datetimepicker";
import { z } from "zod";

// Zod-Schemas für medizinische Eingaben — verhindert ungültige oder gefährliche Werte in Firestore
const bpSchema = z.object({
  systolic:  z.number().min(60, "Systolisch zu niedrig").max(300, "Systolisch zu hoch"),
  diastolic: z.number().min(30, "Diastolisch zu niedrig").max(200, "Diastolisch zu hoch"),
  pulse:     z.number().min(0).max(300).optional(),
});

const diabetesSchema = z.object({
  bloodSugar:      z.number().min(20, "Blutzucker zu niedrig").max(600, "Blutzucker zu hoch"),
  bolus:           z.number().min(0).max(100).optional(),
  carbs:           z.number().min(0).max(500).optional(),
  correctionAuto:  z.number().min(0).max(50).optional(),
  correctionManual:z.number().min(0).max(50).optional(),
});

const targetsSchema = z.object({
  sugarMin: z.number().min(40, "Mindestwert zu niedrig").max(200, "Mindestwert zu hoch"),
  sugarMax: z.number().min(60, "Maximalwert zu niedrig").max(400, "Maximalwert zu hoch"),
}).refine(d => d.sugarMin < d.sugarMax, { message: "Mindestwert muss kleiner als Maximalwert sein" });

// Haupt-Tabs: Blutdruck oder Diabetes
type Tab = "blutdruck" | "diabetes";
// Unter-Tabs im Diabetes-Bereich
type DiabetesTab = "eintraege" | "dashboard";
type TimeOfDay = "morgens" | "abends";

// Datenstruktur eines Blutdruck-Eintrags in Firestore (Collection: bloodPressure)
interface BloodPressureEntry {
  id: string;
  userId: string;
  systolic: number;    // Oberer Blutdruckwert in mmHg
  diastolic: number;   // Unterer Blutdruckwert in mmHg
  pulse: number;
  timeOfDay: TimeOfDay;
  note: string;
  createdAt: Timestamp;
}

// Datenstruktur eines Diabetes-Eintrags in Firestore (Collection: diabetesDiary)
interface DiabetesEntry {
  id: string;
  userId: string;
  bloodSugar: number;      // Blutzucker in mg/dL
  bolus: number;           // Mahlzeiten-Insulin in IE
  carbs: number;           // Kohlenhydrate in Gramm (1 BE = 12g KH)
  correctionAuto: number;  // Automatische Korrektur durch Insulinpumpe
  correctionManual: number;// Manuelle Korrektur durch den Nutzer
  mealContext: string;     // Zeitpunkt (z.B. "vor dem Frühstück")
  note: string;
  createdAt: Timestamp;
}

// Blutzucker-Zielbereiche des Nutzers, gespeichert in Firestore (Collection: healthTargets/{uid})
interface HealthTargets {
  sugarMin: number; sugarMax: number;
}

// Klassifiziert Blutdruckwerte nach WHO-Tabelle und gibt Label + Farbe zurück
function getBPStatus(systolic: number, diastolic: number): { label: string; color: string } {
  if (systolic < 105 || diastolic < 65)   return { label: "Niedrig",           color: "#2563EB" }; // Blau
  if (systolic < 120 && diastolic < 80)   return { label: "Optimal",           color: "#16A34A" }; // Grün
  if (systolic < 130 && diastolic < 85)   return { label: "Normal",            color: "#92400E" }; // Türkis
  if (systolic < 140 && diastolic < 90)   return { label: "Hochnormal",        color: "#CA8A04" }; // Gelb
  if (systolic < 160 && diastolic < 100)  return { label: "Hypertonie Grad 1", color: "#EA580C" }; // Orange
  if (systolic < 180 && diastolic < 110)  return { label: "Hypertonie Grad 2", color: "#DC2626" }; // Rot
  return                                         { label: "Hypertonie Grad 3", color: "#7C3AED" }; // Lila
}

// Klassifiziert einen Blutzuckerwert (mg/dL) und gibt Label + Farbe zurück
function getSugarStatus(value: number): { label: string; color: string } {
  if (value < 70) return { label: "Zu niedrig", color: "#3182CE" };
  if (value <= 140) return { label: "Normal", color: "#38A169" };
  if (value <= 180) return { label: "Erhöht", color: "#D69E2E" };
  return { label: "Kritisch", color: "#E53E3E" };
}

// Chartbreite = Bildschirmbreite minus Padding (16px je Seite)
const SCREEN_WIDTH = Dimensions.get("window").width - 32;

// Zeitraum-Optionen für den Graph-Filter (1T, 7T, 14T, 30T)
const RANGE_OPTIONS: { label: string; days: number }[] = [
  { label: "1T", days: 1 },
  { label: "7T", days: 7 },
  { label: "14T", days: 14 },
  { label: "30T", days: 30 },
];

// Zeigt Grafiken und Statistiken für den Diabetes-Tab an (Blutzucker-Chart, IE/BE-Torte, HbA1c)
function DiabetesDashboard({ entries, targets }: { entries: DiabetesEntry[]; targets: HealthTargets }) {
  // Ausgewählter Zeitraum in Tagen (Standard: 14 Tage)
  const [rangeDays, setRangeDays] = useState(14);

  // Alle Einträge auf den gewählten Zeitraum filtern
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - rangeDays);
  const filtered = entries.filter((e) => {
    try { return e.createdAt.toDate() >= cutoff; } catch { return false; }
  });

  const last14 = filtered;

  if (last14.length < 2) return (
    <>
      <View style={styles.rangeSelector}>
        {RANGE_OPTIONS.map((o) => (
          <TouchableOpacity key={o.days} style={[styles.rangeBtn, rangeDays === o.days && styles.rangeBtnActive]} onPress={() => setRangeDays(o.days)}>
            <Text style={[styles.rangeBtnText, rangeDays === o.days && styles.rangeBtnTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ color: "#A0AEC0", textAlign: "center", marginTop: 16 }}>Nicht genug Einträge für diesen Zeitraum</Text>
    </>
  );

  // Bei 1T: Uhrzeit je Messung; bei >1T: Datum unter jede Messung, aber nur jeden N-ten beschriften um Überlappung zu vermeiden
  const labelStep = last14.length > 14 ? 3 : last14.length > 7 ? 2 : 1;
  const labels = last14.map((e, i) => {
    try {
      if (rangeDays === 1) return format(e.createdAt.toDate(), "HH:mm", { locale: de });
      return i % labelStep === 0 ? format(e.createdAt.toDate(), "dd.MM", { locale: de }) : "";
    } catch { return ""; }
  });

  const sugarData = last14.map((e) => e.bloodSugar);
  // Anteil der Messungen im Zielbereich in Prozent
  const inTargetCount = filtered.filter((e) => e.bloodSugar >= targets.sugarMin && e.bloodSugar <= targets.sugarMax).length;
  const inTargetPct = filtered.length > 0 ? Math.round((inTargetCount / filtered.length) * 100) : 0;
  const avgSugar = filtered.length > 0 ? Math.round(filtered.reduce((s, e) => s + e.bloodSugar, 0) / filtered.length) : 0;

  const pctColor = inTargetPct >= 70 ? "#16A34A" : inTargetPct >= 50 ? "#CA8A04" : "#DC2626";

  return (
    <View style={styles.dashboardCard}>
      <Text style={styles.dashboardTitle}>📊 Graph</Text>

      {/* Summary row */}
      <View style={styles.dashboardRow}>
        <View style={styles.dashboardStat}>
          <Text style={styles.dashboardStatValue}>{avgSugar}</Text>
          <Text style={styles.dashboardStatLabel}>Ø mg/dL</Text>
        </View>
        <View style={styles.dashboardDivider} />
        <View style={styles.dashboardStat}>
          <Text style={[styles.dashboardStatValue, { color: pctColor }]}>{inTargetPct}%</Text>
          <Text style={styles.dashboardStatLabel}>Im Zielbereich</Text>
        </View>
        <View style={styles.dashboardDivider} />
        <View style={styles.dashboardStat}>
          <Text style={styles.dashboardStatValue}>{entries.length}</Text>
          <Text style={styles.dashboardStatLabel}>Messungen</Text>
        </View>
      </View>

      {/* Target range bar */}
      <View style={styles.targetBarContainer}>
        <View style={styles.targetBarBg}>
          <View style={[styles.targetBarFill, { width: `${inTargetPct}%` as any, backgroundColor: pctColor }]} />
        </View>
        <Text style={styles.targetBarLabel}>
          Ziel: {targets.sugarMin}–{targets.sugarMax} mg/dL
        </Text>
      </View>

      {/* Zeitraum-Auswahl */}
      <View style={styles.rangeSelector}>
        {RANGE_OPTIONS.map((o) => (
          <TouchableOpacity key={o.days} style={[styles.rangeBtn, rangeDays === o.days && styles.rangeBtnActive]} onPress={() => setRangeDays(o.days)}>
            <Text style={[styles.rangeBtnText, rangeDays === o.days && styles.rangeBtnTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Line chart */}
      <Text style={styles.chartTitle}>Blutzucker — {last14.length} Messungen</Text>
      <LineChart
        data={{
          labels,
          datasets: [
            { data: sugarData, color: () => "#DC2626", strokeWidth: 2 },
            { data: Array(last14.length).fill(targets.sugarMax), color: () => "rgba(22,163,74,0.7)", strokeWidth: 2, withDots: false },
            { data: Array(last14.length).fill(targets.sugarMin), color: () => "rgba(22,163,74,0.7)", strokeWidth: 2, withDots: false },
          ],
          legend: ["Blutzucker", "Ziel Max", "Ziel Min"],
          legendOffset: -10,
        }}
        width={SCREEN_WIDTH}
        height={200}
        chartConfig={{
          backgroundColor: "#fff",
          backgroundGradientFrom: "#fff",
          backgroundGradientTo: "#fff",
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(220,38,38,${opacity})`,
          labelColor: () => "#718096",
          propsForDots: { r: "4", strokeWidth: "1", stroke: "#DC2626" },
          propsForBackgroundLines: { stroke: "#F7FAFC" },
          propsForLabels: { fontSize: rangeDays === 1 ? 10 : 9 },
        }}
        bezier
        style={{ borderRadius: 8, marginTop: 4 }}
        withVerticalLabels={true}
        fromZero={false}
      />

      {/* IE/BE Verhältnis Tortendiagramm — Tagesdurchschnitt */}
      {(() => {
        const withData = last14.filter((e) => e.bolus > 0 && e.carbs > 0);
        if (withData.length < 1) return null;
        const PIE_COLORS = ["#7C3AED","#A78BFA","#5B21B6","#C4B5FD","#6D28D9","#8B5CF6","#4C1D95","#DDD6FE"];

        // Einträge nach Datum gruppieren, dann IE/BE-Tagesdurchschnitt berechnen (1 BE = 12g KH)
        const byDay: Record<string, number[]> = {};
        withData.forEach((e) => {
          let day = "";
          try { day = format(e.createdAt.toDate(), "dd.MM", { locale: de }); } catch { return; }
          const ratio = e.bolus / (e.carbs / 12);
          if (!byDay[day]) byDay[day] = [];
          byDay[day].push(ratio);
        });

        const dayEntries = Object.entries(byDay).map(([day, ratios], idx) => {
          const avg = parseFloat((ratios.reduce((a, b) => a + b, 0) / ratios.length).toFixed(2));
          return {
            name: `${day} · Ø ${avg} IE/BE`,
            population: avg,
            color: PIE_COLORS[idx % PIE_COLORS.length],
            legendFontColor: "#4A5568",
            legendFontSize: 12,
          };
        });

        const totalAvg = parseFloat((dayEntries.reduce((a, b) => a + b.population, 0) / dayEntries.length).toFixed(2));
        return (
          <>
            <Text style={[styles.chartTitle, { marginTop: 16 }]}>💉 IE pro BE — Tagesdurchschnitt</Text>
            <Text style={{ fontSize: 13, color: "#718096", textAlign: "center", marginBottom: 8 }}>
              Gesamtdurchschnitt: <Text style={{ fontWeight: "bold", color: "#7C3AED" }}>{totalAvg} IE pro BE</Text>
            </Text>
            <PieChart
              data={dayEntries}
              width={SCREEN_WIDTH}
              height={220}
              chartConfig={{
                color: (opacity = 1) => `rgba(124,58,237,${opacity})`,
                labelColor: () => "#4A5568",
              }}
              accessor="population"
              backgroundColor="transparent"
              paddingLeft="12"
              absolute={false}
            />
            <Text style={styles.barNote}>1 BE = 12g KH · Tortenstück = Ø IE/BE pro Tag</Text>
          </>
        );
      })()}

      {/* HbA1c-Schätzwert: Formel (Ø BG + 86) ÷ 33,3 — zeigt geschätzten Langzeit-Blutzucker */}
      {(() => {
        if (last14.length < 1) return null;
        const avgBG = last14.reduce((s, e) => s + e.bloodSugar, 0) / last14.length;
        // HbA1c in % nach der vereinfachten ADAG-Formel
        const hba1c = parseFloat(((avgBG + 86) / 33.3).toFixed(1));
        // Umrechnung in mmol/mol (internationale Einheit)
        const hba1cMmol = Math.round(hba1c * 10.929 - 23.5);
        const hba1cColor = hba1c < 6.0 ? "#16A34A" : hba1c < 7.0 ? "#CA8A04" : hba1c < 8.0 ? "#EA580C" : hba1c < 9.0 ? "#DC2626" : "#7C3AED";
        const hba1cLabel = hba1c < 6.0 ? "Normal" : hba1c < 7.0 ? "Erhöht" : hba1c < 8.0 ? "Diabetes-Zielbereich" : hba1c < 9.0 ? "Erhöht" : "Stark erhöht";
        const HBA1C_TABLE = [
          { bg: "bis 116", pct: "< 6,0 %", mmol: "< 42", label: "Normal",               color: "#16A34A" },
          { bg: "126",     pct: "6,0 %",   mmol: "42",    label: "Erhöht",               color: "#CA8A04" },
          { bg: "154",     pct: "7,0 %",   mmol: "53",    label: "Diabetes-Zielbereich", color: "#EA580C" },
          { bg: "183",     pct: "8,0 %",   mmol: "64",    label: "Erhöht",               color: "#DC2626" },
          { bg: "212",     pct: "9,0 %",   mmol: "75",    label: "Stark erhöht",         color: "#7C3AED" },
        ];
        return (
          <>
            {/* HbA1c kompakt: Header + Tabelle in einer Box */}
            <View style={styles.hba1cTable}>
              {/* Header-Zeile: aktueller Wert */}
              <View style={[styles.hba1cTableRow, { backgroundColor: hba1cColor + "18", paddingVertical: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: "bold", color: "#2D3748" }}>HbA1c Schätzwert</Text>
                  <Text style={{ fontSize: 11, color: "#718096" }}>Ø {Math.round(avgBG)} mg/dL · {last14.length} Messungen</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 16, fontWeight: "bold", color: hba1cColor }}>{hba1c} % · {hba1cMmol} mmol/mol</Text>
                  <Text style={{ fontSize: 11, fontWeight: "600", color: hba1cColor }}>{hba1cLabel}</Text>
                </View>
              </View>
              {/* Spaltenköpfe */}
              <View style={[styles.hba1cTableRow, styles.hba1cTableHeader]}>
                <Text style={[styles.hba1cTableCell, styles.hba1cTableHeaderText]}>Ø BG</Text>
                <Text style={[styles.hba1cTableCell, styles.hba1cTableHeaderText]}>HbA1c %</Text>
                <Text style={[styles.hba1cTableCell, styles.hba1cTableHeaderText]}>mmol/mol</Text>
                <Text style={[styles.hba1cTableCellWide, styles.hba1cTableHeaderText]}>Einschätzung</Text>
              </View>
              {HBA1C_TABLE.map((row, i) => {
                const isActive = hba1cLabel === row.label && hba1cColor === row.color;
                return (
                  <View key={i} style={[styles.hba1cTableRow, isActive && { backgroundColor: row.color + "18" }]}>
                    <Text style={[styles.hba1cTableCell, isActive && { fontWeight: "bold", color: row.color }]}>{row.bg}</Text>
                    <Text style={[styles.hba1cTableCell, isActive && { fontWeight: "bold", color: row.color }]}>{row.pct}</Text>
                    <Text style={[styles.hba1cTableCell, isActive && { fontWeight: "bold", color: row.color }]}>{row.mmol}</Text>
                    <View style={[styles.hba1cTableCellWide, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: row.color }} />
                      <Text style={[{ fontSize: 11, color: "#4A5568" }, isActive && { fontWeight: "bold", color: row.color }]}>{row.label}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        );
      })()}
    </View>
  );
}

// Haupt-Screen für den Gesundheitsbereich: Blutdruck und Diabetes-Tagebuch
export default function HealthScreen() {
  const { user } = useAuthStore();
  const insets = useSafeAreaInsets();
  // uid wird reaktiv über onAuthStateChanged gesetzt, nicht aus dem Zustand-Store (der hält Firestore-Daten, nicht Auth-UID)
  const [uid, setUid] = useState<string | undefined>(auth.currentUser?.uid);
  // Referenzen auf die nativen datetime-local Inputs im Web, um showPicker() aufzurufen
  const bpDateInputRef = useRef<HTMLInputElement>(null);
  const diabetesDateInputRef = useRef<HTMLInputElement>(null);

  // Im Web: Nativen Kalender-Pfeil im datetime-local Feld per CSS ausblenden
  useEffect(() => {
    if (Platform.OS === "web") {
      const style = document.createElement("style");
      style.textContent = `input[type="datetime-local"]::-webkit-calendar-picker-indicator { display: none; }`;
      document.head.appendChild(style);
      return () => { document.head.removeChild(style); };
    }
  }, []);

  // Firebase Auth-Listener: aktualisiert uid sobald sich der Anmeldestatus ändert
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUid(u?.uid));
  }, []);
  const [activeTab, setActiveTab] = useState<Tab>("blutdruck");

  // --- Blutdruck-Zustand ---
  const [bpEntries, setBpEntries] = useState<BloodPressureEntry[]>([]);
  const [bpModal, setBpModal] = useState(false);
  const [editingBP, setEditingBP] = useState<BloodPressureEntry | null>(null);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morgens");
  const [bpNote, setBpNote] = useState("");
  const [bpDate, setBpDate] = useState(new Date());
  const [showBpDatePicker, setShowBpDatePicker] = useState(false);

  // --- Diabetes-Zustand ---
  const [diabetesEntries, setDiabetesEntries] = useState<DiabetesEntry[]>([]);
  const [diabetesModal, setDiabetesModal] = useState(false);
  const [editingDiabetes, setEditingDiabetes] = useState<DiabetesEntry | null>(null);
  const [bloodSugar, setBloodSugar] = useState("");
  const [bolus, setBolus] = useState("");
  const [carbs, setCarbs] = useState("");
  const [correctionAuto, setCorrectionAuto] = useState("");
  const [correctionManual, setCorrectionManual] = useState("");
  const [diabetesDate, setDiabetesDate] = useState(new Date());
  const [showDiabetesDatePicker, setShowDiabetesDatePicker] = useState(false);
  const [mealContext, setMealContext] = useState("nüchtern");
  const [diabetesNote, setDiabetesNote] = useState("");

  // --- Zielbereiche (Blutzucker) ---
  const [targetsModal, setTargetsModal] = useState(false);
  const [targets, setTargets] = useState<HealthTargets>({ sugarMin: 70, sugarMax: 140 });
  const [tSugarMin, setTSugarMin] = useState("70");
  const [tSugarMax, setTSugarMax] = useState("140");

  const MEAL_CONTEXTS = [
    "nüchtern",
    "vor dem Frühstück",
    "nach dem Frühstück",
    "vor dem Mittagessen",
    "nach dem Mittagessen",
    "vor dem Abendessen",
    "nach dem Abendessen",
    "vor dem Schlafen gehen",
  ];
  const [mealDropdownOpen, setMealDropdownOpen] = useState(false);
  const [diabetesTab, setDiabetesTab] = useState<DiabetesTab>("eintraege");

  // Lädt die gespeicherten Blutzucker-Zielwerte des Nutzers aus Firestore in Echtzeit
  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, "healthTargets", uid), (d) => {
      if (d.exists()) {
        const data = d.data() as HealthTargets;
        setTargets(data);
        setTSugarMin(String(data.sugarMin)); setTSugarMax(String(data.sugarMax));
      }
    });
    return unsub;
  }, [uid]);

  const [targetsError, setTargetsError] = useState("");

  // Speichert die Blutzucker-Zielbereiche in Firestore unter healthTargets/{uid} — mit Zod-Validierung
  const saveTargets = async () => {
    setTargetsError("");
    if (!uid) { setTargetsError("Nicht eingeloggt"); return; }
    const parsed = targetsSchema.safeParse({
      sugarMin: Number(tSugarMin),
      sugarMax: Number(tSugarMax),
    });
    if (!parsed.success) {
      setTargetsError(parsed.error.errors[0].message);
      return;
    }
    try {
      await setDoc(doc(db, "healthTargets", uid), parsed.data);
      setTargets(parsed.data);
      setTargetsModal(false);
    } catch (e: any) {
      // Nur Fehler-Code loggen, keine UIDs oder Gesundheitsdaten
      if (__DEV__) console.error("saveTargets Fehler:", (e as any)?.code ?? "unbekannt");
      setTargetsError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    }
  };

  // Prüft ob ein Blutzuckerwert im persönlichen Zielbereich liegt
  const isInSugarTarget = (val: number) =>
    val >= targets.sugarMin && val <= targets.sugarMax;

  // Abonniert alle Blutdruck-Einträge des Nutzers aus Firestore, sortiert aufsteigend nach Datum
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "bloodPressure"),
      where("userId", "==", uid)
    );
    return onSnapshot(q, (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BloodPressureEntry));
      entries.sort((a, b) => a.createdAt.toDate().getTime() - b.createdAt.toDate().getTime());
      setBpEntries(entries);
    });
  }, [uid]);

  // Abonniert alle Diabetes-Einträge des Nutzers aus Firestore, sortiert aufsteigend nach Datum
  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, "diabetesDiary"),
      where("userId", "==", uid)
    );
    return onSnapshot(q, (snap) => {
      const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DiabetesEntry));
      entries.sort((a, b) => a.createdAt.toDate().getTime() - b.createdAt.toDate().getTime());
      setDiabetesEntries(entries);
    });
  }, [uid]);

  // Öffnet das Blutdruck-Modal im Bearbeitungsmodus und befüllt alle Felder mit dem vorhandenen Eintrag
  const openBPEdit = (entry: BloodPressureEntry) => {
    setEditingBP(entry);
    setSystolic(String(entry.systolic));
    setDiastolic(String(entry.diastolic));
    setPulse(entry.pulse ? String(entry.pulse) : "");
    setTimeOfDay(entry.timeOfDay);
    setBpNote(entry.note || "");
    try { setBpDate(entry.createdAt.toDate()); } catch { setBpDate(new Date()); }

    setBpModal(true);
  };

  // Öffnet das Blutdruck-Modal für einen neuen Eintrag (setzt alle Felder zurück)
  const openBPNew = () => {
    setEditingBP(null);
    setSystolic(""); setDiastolic(""); setPulse(""); setBpNote(""); setTimeOfDay("morgens");
    setBpDate(new Date());
    setBpModal(true);
  };

  // Speichert oder aktualisiert einen Blutdruck-Eintrag in Firestore — mit Auth-Guard und Zod-Validierung
  const saveBP = async () => {
    if (!uid) { Alert.alert("Fehler", "Nicht eingeloggt."); return; }
    const parsed = bpSchema.safeParse({
      systolic: Number(systolic),
      diastolic: Number(diastolic),
      pulse: pulse ? Number(pulse) : undefined,
    });
    if (!parsed.success) {
      Alert.alert("Ungültige Eingabe", parsed.error.errors[0].message);
      return;
    }
    const data = {
      systolic: parsed.data.systolic,
      diastolic: parsed.data.diastolic,
      pulse: parsed.data.pulse ?? 0,
      timeOfDay,
      note: bpNote.trim().slice(0, 500), // Notiz auf 500 Zeichen begrenzen
    };
    if (editingBP) {
      await updateDoc(doc(db, "bloodPressure", editingBP.id), { ...data, createdAt: Timestamp.fromDate(bpDate) });
    } else {
      await addDoc(collection(db, "bloodPressure"), { ...data, userId: uid, createdAt: Timestamp.fromDate(bpDate) });
    }
    setSystolic(""); setDiastolic(""); setPulse(""); setBpNote(""); setTimeOfDay("morgens");
    setEditingBP(null);
    setBpModal(false);
  };

  // Öffnet das Diabetes-Modal im Bearbeitungsmodus und befüllt alle Felder
  const openDiabetesEdit = (entry: DiabetesEntry) => {
    setEditingDiabetes(entry);
    setBloodSugar(String(entry.bloodSugar));
    setBolus(entry.bolus ? String(entry.bolus) : "");
    setCarbs(entry.carbs ? String(entry.carbs) : "");
    setCorrectionAuto(entry.correctionAuto ? String(entry.correctionAuto) : "");
    setCorrectionManual(entry.correctionManual ? String(entry.correctionManual) : "");
    setMealContext(entry.mealContext);
    setDiabetesNote(entry.note || "");
    try { setDiabetesDate(entry.createdAt.toDate()); } catch { setDiabetesDate(new Date()); }
    setDiabetesModal(true);
  };

  // Öffnet das Diabetes-Modal für einen neuen Eintrag (setzt alle Felder zurück)
  const openDiabetesNew = () => {
    setEditingDiabetes(null);
    setBloodSugar(""); setBolus(""); setCarbs("");
    setCorrectionAuto(""); setCorrectionManual("");
    setMealContext("nüchtern"); setDiabetesNote("");
    setDiabetesDate(new Date());
    setDiabetesModal(true);
  };

  // Speichert oder aktualisiert einen Diabetes-Eintrag in Firestore — mit Auth-Guard und Zod-Validierung
  const saveDiabetes = async () => {
    if (!uid) { Alert.alert("Fehler", "Nicht eingeloggt."); return; }
    const parsed = diabetesSchema.safeParse({
      bloodSugar:       Number(bloodSugar),
      bolus:            bolus ? Number(bolus) : undefined,
      carbs:            carbs ? Number(carbs) : undefined,
      correctionAuto:   correctionAuto ? Number(correctionAuto) : undefined,
      correctionManual: correctionManual ? Number(correctionManual) : undefined,
    });
    if (!parsed.success) {
      Alert.alert("Ungültige Eingabe", parsed.error.errors[0].message);
      return;
    }
    try {
      const data = {
        bloodSugar:       parsed.data.bloodSugar,
        bolus:            parsed.data.bolus ?? 0,
        carbs:            parsed.data.carbs ?? 0,
        correctionAuto:   parsed.data.correctionAuto ?? 0,
        correctionManual: parsed.data.correctionManual ?? 0,
        mealContext,
        note: diabetesNote.trim().slice(0, 500), // Notiz auf 500 Zeichen begrenzen
      };
      if (editingDiabetes) {
        await updateDoc(doc(db, "diabetesDiary", editingDiabetes.id), { ...data, createdAt: Timestamp.fromDate(diabetesDate) });
      } else {
        await addDoc(collection(db, "diabetesDiary"), { ...data, userId: uid, createdAt: Timestamp.fromDate(diabetesDate) });
      }
      setBloodSugar(""); setBolus(""); setCarbs("");
      setCorrectionAuto(""); setCorrectionManual("");
      setMealContext("nüchtern"); setDiabetesNote("");
      setEditingDiabetes(null);
      setDiabetesModal(false);
    } catch (e: any) {
      // Nur Fehler-Code loggen, keine sensiblen Daten oder UIDs
      if (__DEV__) console.error("saveDiabetes Fehler:", (e as any)?.code ?? "unbekannt");
      const msg = Platform.OS === "web" ? window.alert : Alert.alert.bind(null, "Fehler");
      (msg as any)("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    }
  };

  // Löscht einen Blutdruck-Eintrag direkt ohne Bestätigungsdialog
  const deleteBP = (id: string) => deleteDoc(doc(db, "bloodPressure", id));
  // Löscht einen Diabetes-Eintrag direkt ohne Bestätigungsdialog
  const deleteDiabetes = (id: string) => deleteDoc(doc(db, "diabetesDiary", id));

  // Formatiert einen Firestore-Timestamp für die Anzeige (dd.MM.yyyy HH:mm)
  const formatDate = (ts: Timestamp) => {
    try {
      return format(ts.toDate(), "dd.MM.yyyy HH:mm", { locale: de });
    } catch {
      return "";
    }
  };

  // Filtert die heutigen Blutdruck-Einträge für die Tagesübersicht (Morgens/Abends)
  const todayBP = bpEntries.filter((e) => {
    try {
      const d = e.createdAt.toDate();
      return format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
    } catch { return false; }
  });
  const morgenBP = todayBP.find((e) => e.timeOfDay === "morgens");
  const abendsBP = todayBP.find((e) => e.timeOfDay === "abends");

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.title}>❤️ Gesundheit</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {activeTab === "diabetes" && diabetesTab !== "dashboard" && (
            <TouchableOpacity style={styles.targetButton} onPress={() => {
              setTSugarMin(String(targets.sugarMin)); setTSugarMax(String(targets.sugarMax));
              setTargetsModal(true);
            }}>
              <Text style={styles.targetButtonText}>🎯 Ziele</Text>
            </TouchableOpacity>
          )}
          {(activeTab === "blutdruck" || diabetesTab === "eintraege") && (
            <TouchableOpacity style={styles.addButton} onPress={() => activeTab === "blutdruck" ? openBPNew() : openDiabetesNew()}>
              <Text style={styles.addButtonText}>+ Eintrag</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === "blutdruck" && styles.tabActive]}
          onPress={() => setActiveTab("blutdruck")}
        >
          <Text style={[styles.tabText, activeTab === "blutdruck" && styles.tabTextActive]}>🩺 Blutdruck</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === "diabetes" && styles.tabActive]}
          onPress={() => setActiveTab("diabetes")}
        >
          <Text style={[styles.tabText, activeTab === "diabetes" && styles.tabTextActive]}>🩸 Diabetes</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {activeTab === "blutdruck" && (
          <>
            {/* Today summary */}
            <View style={styles.todayCard}>
              <Text style={styles.todayTitle}>Heute</Text>
              <View style={styles.todayRow}>
                <View style={styles.todayItem}>
                  <Text style={styles.todayLabel}>🌅 Morgens</Text>
                  {morgenBP ? (
                    <>
                      <Text style={styles.todayValue}>{morgenBP.systolic}/{morgenBP.diastolic}</Text>
                      <Text style={[styles.todayStatus, { color: getBPStatus(morgenBP.systolic, morgenBP.diastolic).color }]}>
                        {getBPStatus(morgenBP.systolic, morgenBP.diastolic).label}
                      </Text>
                    </>
                  ) : <Text style={styles.todayEmpty}>Noch nicht gemessen</Text>}
                </View>
                <View style={styles.todayDivider} />
                <View style={styles.todayItem}>
                  <Text style={styles.todayLabel}>🌙 Abends</Text>
                  {abendsBP ? (
                    <>
                      <Text style={styles.todayValue}>{abendsBP.systolic}/{abendsBP.diastolic}</Text>
                      <Text style={[styles.todayStatus, { color: getBPStatus(abendsBP.systolic, abendsBP.diastolic).color }]}>
                        {getBPStatus(abendsBP.systolic, abendsBP.diastolic).label}
                      </Text>
                    </>
                  ) : <Text style={styles.todayEmpty}>Noch nicht gemessen</Text>}
                </View>
              </View>
            </View>


            {bpEntries.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🩺</Text>
                <Text style={styles.emptyText}>Noch keine Einträge</Text>
              </View>
            ) : (
              bpEntries.map((entry) => {
                const status = getBPStatus(entry.systolic, entry.diastolic);
                return (
                  <View key={entry.id} style={styles.entryCard}>
                    <View style={[styles.statusBar, { backgroundColor: status.color }]} />
                    <View style={styles.entryContent}>
                      <View style={styles.entryTop}>
                        <Text style={styles.entryMain}>{entry.systolic}/{entry.diastolic} mmHg</Text>
                        <Text style={[styles.entryStatus, { color: status.color }]}>{status.label}</Text>
                      </View>
                      <View style={styles.entryMeta}>
                        {entry.pulse > 0 && <Text style={styles.metaText}>💓 {entry.pulse} bpm</Text>}
                        <Text style={styles.metaText}>{entry.timeOfDay === "morgens" ? "🌅 Morgens" : "🌙 Abends"}</Text>
                        <Text style={styles.metaText}>{formatDate(entry.createdAt)}</Text>
                      </View>
                      {entry.note ? <Text style={styles.entryNote}>{entry.note}</Text> : null}
                    </View>
                    <View style={styles.entryActions}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => openBPEdit(entry)}>
                        <Text style={styles.actionEdit}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => deleteBP(entry.id)}>
                        <Text style={styles.actionDelete}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </>
        )}

        {activeTab === "diabetes" && (
          <>
            {/* Sub-Tabs */}
            <View style={styles.subTabs}>
              <TouchableOpacity style={[styles.subTab, diabetesTab === "eintraege" && styles.subTabActive]} onPress={() => setDiabetesTab("eintraege")}>
                <Text style={[styles.subTabText, diabetesTab === "eintraege" && styles.subTabTextActive]}>📋 Einträge</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.subTab, diabetesTab === "dashboard" && styles.subTabActive]} onPress={() => setDiabetesTab("dashboard")}>
                <Text style={[styles.subTabText, diabetesTab === "dashboard" && styles.subTabTextActive]}>📊 Graph</Text>
              </TouchableOpacity>
            </View>

            {diabetesTab === "dashboard" && (
              diabetesEntries.length >= 2
                ? <DiabetesDashboard entries={diabetesEntries} targets={targets} />
                : <View style={styles.empty}><Text style={styles.emptyEmoji}>📊</Text><Text style={styles.emptyText}>Noch zu wenig Daten</Text><Text style={styles.emptyHint}>Mindestens 2 Einträge erforderlich</Text></View>
            )}

            {diabetesTab === "eintraege" && diabetesEntries.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyEmoji}>🩸</Text>
                <Text style={styles.emptyText}>Noch keine Einträge</Text>
              </View>
            ) : diabetesTab === "eintraege" ? (
              diabetesEntries.map((entry) => {
                const status = getSugarStatus(entry.bloodSugar);
                return (
                  <View key={entry.id} style={styles.entryCard}>
                    <View style={[styles.statusBar, { backgroundColor: status.color }]} />
                    <View style={styles.entryContent}>
                      <View style={styles.entryTop}>
                        <Text style={styles.entryMain}>{entry.bloodSugar} mg/dL</Text>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[styles.entryStatus, { color: status.color }]}>{status.label}</Text>
                          {isInSugarTarget(entry.bloodSugar) && <Text style={styles.inTarget}>✓ Im Zielbereich</Text>}
                        </View>
                      </View>
                      <View style={styles.entryMeta}>
                        {entry.carbs > 0 && <Text style={styles.metaText}>🍞 {entry.carbs} g KH</Text>}
                        {entry.bolus > 0 && <Text style={styles.metaText}>💉 {entry.bolus} IE Bolus</Text>}
                        {entry.correctionAuto > 0 && <Text style={styles.metaText}>🤖 {entry.correctionAuto} IE Auto</Text>}
                        {entry.correctionManual > 0 && <Text style={styles.metaText}>✋ {entry.correctionManual} IE Korr.</Text>}
                        <Text style={styles.metaText}>🍽️ {entry.mealContext}</Text>
                        <Text style={styles.metaText}>{formatDate(entry.createdAt)}</Text>
                      </View>
                      {entry.note ? <Text style={styles.entryNote}>{entry.note}</Text> : null}
                    </View>
                    <View style={styles.entryActions}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => openDiabetesEdit(entry)}>
                        <Text style={styles.actionEdit}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => deleteDiabetes(entry.id)}>
                        <Text style={styles.actionDelete}>🗑️</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            ) : null}
          </>
        )}

      </ScrollView>

      {/* Blood Pressure Modal */}
      <Modal visible={bpModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>{editingBP ? "🩺 Blutdruck bearbeiten" : "🩺 Blutdruck messen"}</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            <View style={styles.dateRow}>
              {Platform.OS === "web" ? (
                <>
                  <TouchableOpacity onPress={() => bpDateInputRef.current?.showPicker()} style={styles.dateIconBtn}>
                    <Text style={{ fontSize: 22 }}>📅</Text>
                  </TouchableOpacity>
                  <input
                    ref={bpDateInputRef}
                    type="datetime-local"
                    value={format(bpDate, "yyyy-MM-dd'T'HH:mm")}
                    onChange={(e) => setBpDate(new Date(e.target.value))}
                    style={{ flex: 1, padding: 6, fontSize: 13, borderRadius: 8, border: "1px solid #E2E8F0", backgroundColor: "#F7FAFC", marginLeft: 6 }}
                  />
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={() => setShowBpDatePicker(true)} style={styles.dateIconBtn}>
                    <Text style={{ fontSize: 22 }}>📅</Text>
                  </TouchableOpacity>
                  <Text style={styles.dateInlineText}>{format(bpDate, "dd.MM.yyyy HH:mm", { locale: de })}</Text>
                  {showBpDatePicker && (
                    <DateTimePicker value={bpDate} mode="datetime" display="default" onChange={(_, d) => { setShowBpDatePicker(false); if (d) setBpDate(d); }} />
                  )}
                </>
              )}
            </View>

            <View style={styles.timeToggle}>
              {(["morgens", "abends"] as TimeOfDay[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.toggleBtn, timeOfDay === t && styles.toggleBtnActive]}
                  onPress={() => setTimeOfDay(t)}
                >
                  <Text style={[styles.toggleText, timeOfDay === t && styles.toggleTextActive]}>
                    {t === "morgens" ? "🌅 Morgens" : "🌙 Abends"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.inputRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.formLabel}>Systolisch *</Text>
                <TextInput style={styles.input} placeholder="z.B. 120" value={systolic} onChangeText={setSystolic} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>Diastolisch *</Text>
                <TextInput style={styles.input} placeholder="z.B. 80" value={diastolic} onChangeText={setDiastolic} keyboardType="number-pad" />
              </View>
            </View>

            <Text style={styles.formLabel}>Puls (optional)</Text>
            <TextInput style={styles.input} placeholder="z.B. 72" value={pulse} onChangeText={setPulse} keyboardType="number-pad" />

            <Text style={styles.formLabel}>Notiz (optional)</Text>
            <TextInput style={styles.input} placeholder="z.B. nach Sport" value={bpNote} onChangeText={setBpNote} />

            <TouchableOpacity style={styles.saveButton} onPress={saveBP}>
              <Text style={styles.saveButtonText}>Speichern</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setBpModal(false); setEditingBP(null); }}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>

            <View style={styles.legendTable}>
              <View style={styles.legendTableHeader}>
                <Text style={[styles.legendCol, { flex: 2 }]}>Status</Text>
                <Text style={[styles.legendCol, { flex: 1.5, textAlign: "center" }]}>Systolisch</Text>
                <Text style={[styles.legendCol, { flex: 1.5, textAlign: "center" }]}>Diastolisch</Text>
              </View>
              {[
                { label: "Niedrig",           sys: "< 105",     dia: "< 65",     color: "#2563EB" },
                { label: "Optimal",           sys: "< 120",     dia: "< 80",     color: "#16A34A" },
                { label: "Normal",            sys: "< 130",     dia: "< 85",     color: "#92400E" },
                { label: "Hochnormal",        sys: "130 – 139", dia: "85 – 89",  color: "#CA8A04" },
                { label: "Hypertonie Grad 1", sys: "140 – 159", dia: "90 – 99",  color: "#EA580C" },
                { label: "Hypertonie Grad 2", sys: "160 – 179", dia: "100 – 109",color: "#DC2626" },
                { label: "Hypertonie Grad 3", sys: "≥ 180",     dia: "≥ 110",    color: "#7C3AED" },
              ].map((row, i) => (
                <View key={row.label} style={[styles.legendRow, i % 2 === 0 && styles.legendRowAlt]}>
                  <View style={[styles.legendColorBar, { backgroundColor: row.color }]} />
                  <Text style={[styles.legendRowLabel, { flex: 2 }]}>{row.label}</Text>
                  <Text style={[styles.legendRowValue, { flex: 1.5, textAlign: "center" }]}>{row.sys}</Text>
                  <Text style={[styles.legendRowValue, { flex: 1.5, textAlign: "center" }]}>{row.dia}</Text>
                </View>
              ))}
              <Text style={styles.legendNote}>Angaben in mmHg</Text>
            </View>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Diabetes Modal */}
      <Modal visible={diabetesModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>{editingDiabetes ? "🩸 Eintrag bearbeiten" : "🩸 Blutzucker eintragen"}</Text>

            <View style={styles.dateRow}>
              {Platform.OS === "web" ? (
                <>
                  <TouchableOpacity onPress={() => diabetesDateInputRef.current?.showPicker()} style={styles.dateIconBtn}>
                    <Text style={{ fontSize: 22 }}>📅</Text>
                  </TouchableOpacity>
                  <input
                    ref={diabetesDateInputRef}
                    type="datetime-local"
                    value={format(diabetesDate, "yyyy-MM-dd'T'HH:mm")}
                    onChange={(e) => setDiabetesDate(new Date(e.target.value))}
                    style={{ flex: 1, padding: 6, fontSize: 13, borderRadius: 8, border: "1px solid #E2E8F0", backgroundColor: "#F7FAFC", marginLeft: 6 }}
                  />
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={() => setShowDiabetesDatePicker(true)} style={styles.dateIconBtn}>
                    <Text style={{ fontSize: 22 }}>📅</Text>
                  </TouchableOpacity>
                  <Text style={styles.dateInlineText}>{format(diabetesDate, "dd.MM.yyyy HH:mm", { locale: de })}</Text>
                  {showDiabetesDatePicker && (
                    <DateTimePicker value={diabetesDate} mode="datetime" display="default" onChange={(_, d) => { setShowDiabetesDatePicker(false); if (d) setDiabetesDate(d); }} />
                  )}
                </>
              )}
            </View>

            <Text style={styles.formLabel}>Blutzucker (mg/dL) *</Text>
            <TextInput style={styles.input} placeholder="z.B. 95" value={bloodSugar} onChangeText={setBloodSugar} keyboardType="number-pad" autoFocus />

            <View style={styles.inputRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.formLabel}>🍞 KH (g, optional)</Text>
                <TextInput style={styles.input} placeholder="z.B. 45" value={carbs} onChangeText={setCarbs} keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>💉 Bolus (IE, optional)</Text>
                <TextInput style={styles.input} placeholder="z.B. 4" value={bolus} onChangeText={setBolus} keyboardType="number-pad" />
              </View>
            </View>

            <View style={styles.inputRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.formLabel}>🤖 Autokorrektur Pumpe (IE)</Text>
                <TextInput style={styles.input} placeholder="z.B. 1.5" value={correctionAuto} onChangeText={setCorrectionAuto} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.formLabel}>✋ Manuelle Korrektur (IE)</Text>
                <TextInput style={styles.input} placeholder="z.B. 2" value={correctionManual} onChangeText={setCorrectionManual} keyboardType="decimal-pad" />
              </View>
            </View>

            <Text style={styles.formLabel}>Zeitpunkt</Text>
            <TouchableOpacity style={styles.dropdown} onPress={() => setMealDropdownOpen(!mealDropdownOpen)}>
              <Text style={styles.dropdownText}>{mealContext}</Text>
              <Text style={styles.dropdownArrow}>{mealDropdownOpen ? "▲" : "▼"}</Text>
            </TouchableOpacity>
            {mealDropdownOpen && (
              <View style={styles.dropdownList}>
                {MEAL_CONTEXTS.map((ctx) => (
                  <TouchableOpacity
                    key={ctx}
                    style={[styles.dropdownItem, mealContext === ctx && styles.dropdownItemActive]}
                    onPress={() => { setMealContext(ctx); setMealDropdownOpen(false); }}
                  >
                    <Text style={[styles.dropdownItemText, mealContext === ctx && styles.dropdownItemTextActive]}>{ctx}</Text>
                    {mealContext === ctx && <Text style={styles.dropdownCheck}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.formLabel}>Notiz (optional)</Text>
            <TextInput style={styles.input} placeholder="z.B. nach dem Joggen" value={diabetesNote} onChangeText={setDiabetesNote} />

            <TouchableOpacity style={styles.saveButton} onPress={saveDiabetes}>
              <Text style={styles.saveButtonText}>Speichern</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setDiabetesModal(false); setEditingDiabetes(null); }}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Targets Modal */}
      <Modal visible={targetsModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>🎯 Blutzucker-Zielbereich</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.targetSection}>🩸 Blutzucker (mg/dL)</Text>
              <View style={styles.inputRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.formLabel}>Ziel Min</Text>
                  <TextInput style={styles.input} value={tSugarMin} onChangeText={setTSugarMin} keyboardType="number-pad" placeholder="70" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.formLabel}>Ziel Max</Text>
                  <TextInput style={styles.input} value={tSugarMax} onChangeText={setTSugarMax} keyboardType="number-pad" placeholder="140" />
                </View>
              </View>

              {targetsError ? <Text style={{ color: "#E53E3E", marginBottom: 8, fontSize: 13 }}>{targetsError}</Text> : null}
              <TouchableOpacity style={styles.saveButton} onPress={saveTargets}>
                <Text style={styles.saveButtonText}>Speichern</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setTargetsModal(false)}>
                <Text style={styles.cancelText}>Abbrechen</Text>
              </TouchableOpacity>
            </ScrollView>
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
  addButton: { backgroundColor: "#E53E3E", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addButtonText: { color: "#fff", fontWeight: "bold", fontSize: 14 },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E2E8F0" },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#E53E3E" },
  tabText: { fontSize: 15, color: "#718096", fontWeight: "600" },
  tabTextActive: { color: "#E53E3E" },
  todayCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  todayTitle: { fontSize: 13, fontWeight: "bold", color: "#718096", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  todayRow: { flexDirection: "row", alignItems: "center" },
  todayItem: { flex: 1, alignItems: "center" },
  todayDivider: { width: 1, height: 50, backgroundColor: "#E2E8F0", marginHorizontal: 8 },
  todayLabel: { fontSize: 13, color: "#718096", marginBottom: 4 },
  todayValue: { fontSize: 22, fontWeight: "bold", color: "#2D3748" },
  todayStatus: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  todayEmpty: { fontSize: 12, color: "#CBD5E0", fontStyle: "italic" },
  legendHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#fff", borderRadius: 10, padding: 14, marginBottom: 4 },
  legendHeaderText: { fontSize: 14, fontWeight: "bold", color: "#2D3748" },
  legendChevron: { fontSize: 12, color: "#718096" },
  legendTable: { backgroundColor: "#fff", borderRadius: 10, marginBottom: 12, overflow: "hidden" },
  legendTableHeader: { flexDirection: "row", backgroundColor: "#EDF2F7", padding: 10, paddingHorizontal: 12 },
  legendCol: { fontSize: 12, fontWeight: "bold", color: "#4A5568" },
  legendRow: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 12 },
  legendRowAlt: { backgroundColor: "#F7FAFC" },
  legendColorBar: { width: 4, height: 18, borderRadius: 2, marginRight: 8 },
  legendRowLabel: { fontSize: 13, color: "#2D3748", fontWeight: "500" },
  legendRowValue: { fontSize: 13, color: "#4A5568" },
  legendNote: { fontSize: 11, color: "#A0AEC0", textAlign: "right", padding: 8, paddingHorizontal: 12 },
  empty: { alignItems: "center", paddingTop: 60 },
  emptyEmoji: { fontSize: 50, marginBottom: 12 },
  emptyText: { fontSize: 16, color: "#718096" },
  entryCard: { flexDirection: "row", backgroundColor: "#fff", borderRadius: 12, marginBottom: 10, overflow: "hidden", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  statusBar: { width: 5 },
  entryContent: { flex: 1, padding: 14 },
  entryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  entryMain: { fontSize: 18, fontWeight: "bold", color: "#2D3748" },
  entryStatus: { fontSize: 13, fontWeight: "600" },
  entryMeta: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metaText: { fontSize: 12, color: "#718096" },
  entryNote: { fontSize: 13, color: "#4A5568", marginTop: 6, fontStyle: "italic" },
  editHint: { fontSize: 11, color: "#CBD5E0", marginTop: 6 },
  inTarget: { fontSize: 11, color: "#38A169", fontWeight: "600", marginTop: 2 },
  targetButton: { backgroundColor: "#EBF4FF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  targetButtonText: { color: "#3182CE", fontWeight: "bold", fontSize: 14 },
  targetSection: { fontSize: 15, fontWeight: "bold", color: "#2D3748", marginBottom: 10, marginTop: 4 },
  dashboardCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  dashboardTitle: { fontSize: 16, fontWeight: "bold", color: "#2D3748", marginBottom: 12 },
  dashboardRow: { flexDirection: "row", justifyContent: "space-around", marginBottom: 16 },
  dashboardStat: { alignItems: "center", flex: 1 },
  dashboardStatValue: { fontSize: 24, fontWeight: "bold", color: "#2D3748" },
  dashboardStatLabel: { fontSize: 11, color: "#718096", marginTop: 2 },
  dashboardDivider: { width: 1, backgroundColor: "#E2E8F0" },
  targetBarContainer: { marginBottom: 16 },
  targetBarBg: { height: 10, backgroundColor: "#EDF2F7", borderRadius: 5, overflow: "hidden", marginBottom: 4 },
  targetBarFill: { height: 10, borderRadius: 5 },
  targetBarLabel: { fontSize: 11, color: "#718096", textAlign: "right" },
  chartTitle: { fontSize: 13, fontWeight: "600", color: "#4A5568", marginBottom: 4 },
  barLegend: { flexDirection: "row", gap: 16, marginBottom: 4 },
  barLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  barLegendDot: { width: 10, height: 10, borderRadius: 2 },
  barLegendText: { fontSize: 12, color: "#4A5568" },
  barNote: { fontSize: 11, color: "#A0AEC0", marginTop: 4, textAlign: "right" },
  hba1cBox: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, padding: 16, marginTop: 16, borderWidth: 1, borderColor: "#E2E8F0" },
  hba1cTitle: { fontSize: 15, fontWeight: "bold", color: "#2D3748" },
  hba1cSub: { fontSize: 12, color: "#718096", marginTop: 2 },
  hba1cValue: { fontSize: 18, fontWeight: "bold" },
  hba1cBadge: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  hba1cTable: { backgroundColor: "#fff", borderRadius: 12, marginTop: 12, borderWidth: 1, borderColor: "#E2E8F0", overflow: "hidden" },
  hba1cTableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#F7FAFC" },
  hba1cTableHeader: { backgroundColor: "#F7FAFC" },
  hba1cTableHeaderText: { fontSize: 11, fontWeight: "bold", color: "#718096" },
  hba1cTableCell: { flex: 1, fontSize: 12, color: "#4A5568" },
  hba1cTableCellWide: { flex: 1.6 },
  rangeSelector: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 },
  rangeBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0" },
  rangeBtnActive: { backgroundColor: "#E53E3E", borderColor: "#E53E3E" },
  rangeBtnText: { fontSize: 13, fontWeight: "600", color: "#718096" },
  rangeBtnTextActive: { color: "#fff" },
  subTabs: { flexDirection: "row", backgroundColor: "#EDF2F7", borderRadius: 10, padding: 4, marginBottom: 12 },
  subTab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  subTabActive: { backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  subTabText: { fontSize: 13, color: "#718096", fontWeight: "600" },
  subTabTextActive: { color: "#E53E3E" },
  dateButton: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, marginBottom: 14 },
  dateButtonText: { fontSize: 15, color: "#2D3748" },
  dateRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  dateInlineButton: { flex: 1, marginLeft: 6, backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  dateInlineText: { fontSize: 13, color: "#2D3748", marginLeft: 8 },
  dateIconBtn: { padding: 4 },
  dropdown: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, marginBottom: 4 },
  dropdownText: { fontSize: 15, color: "#2D3748" },
  dropdownArrow: { fontSize: 12, color: "#718096" },
  dropdownList: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, marginBottom: 14, overflow: "hidden" },
  dropdownItem: { padding: 12, paddingHorizontal: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#F7FAFC" },
  dropdownItemActive: { backgroundColor: "#FFF5F5" },
  dropdownItemText: { fontSize: 15, color: "#2D3748" },
  dropdownItemTextActive: { color: "#E53E3E", fontWeight: "600" },
  dropdownCheck: { fontSize: 14, color: "#E53E3E" },
  entryActions: { flexDirection: "column", justifyContent: "center", paddingRight: 10, gap: 8 },
  actionBtn: { padding: 6 },
  actionEdit: { fontSize: 18 },
  actionDelete: { fontSize: 18 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: "90%" },
  modalTitle: { fontSize: 20, fontWeight: "bold", color: "#2D3748", marginBottom: 16 },
  timeToggle: { flexDirection: "row", gap: 8, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", alignItems: "center" },
  toggleBtnActive: { backgroundColor: "#E53E3E", borderColor: "#E53E3E" },
  toggleText: { fontSize: 14, color: "#4A5568", fontWeight: "600" },
  toggleTextActive: { color: "#fff" },
  inputRow: { flexDirection: "row" },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#4A5568", marginBottom: 6 },
  input: { backgroundColor: "#F7FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 12, fontSize: 15, marginBottom: 14 },
  saveButton: { backgroundColor: "#E53E3E", borderRadius: 10, padding: 16, alignItems: "center", marginBottom: 12 },
  saveButtonText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  cancelText: { textAlign: "center", color: "#718096", fontSize: 15 },
});
