import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function SOSScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>🆘 SOS</Text>
      <Text style={styles.subtitle}>Notfallknopf mit GPS — Phase 5</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#F7FAFC" },
  title: { fontSize: 24, fontWeight: "bold", color: "#E53E3E" },
  subtitle: { fontSize: 14, color: "#718096", marginTop: 8 },
});
