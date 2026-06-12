import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function BudgetScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>💰 Budget</Text>
      <Text style={styles.subtitle}>Wird in Phase 2 ausgebaut</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F7FAFC" },
  title: { fontSize: 24, fontWeight: "bold", color: "#2D3748" },
  subtitle: { fontSize: 14, color: "#718096", marginTop: 8 },
});
