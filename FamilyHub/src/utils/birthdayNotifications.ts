import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { Birthday } from "../types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("birthdays", {
      name: "Geburtstage",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

// Storniert alle bestehenden Geburtstags-Benachrichtigungen und plant neue für jedes Jahr
export async function scheduleBirthdayNotifications(birthdays: Birthday[]): Promise<void> {
  if (Platform.OS === "web") return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const toCancel = scheduled.filter((n) => n.identifier.startsWith("bday-"));
  await Promise.all(toCancel.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));

  for (const birthday of birthdays) {
    const date = new Date(birthday.date);
    const bdayMonth = date.getMonth() + 1;
    const bdayDay = date.getDate();

    // Benachrichtigung am Geburtstag um 9 Uhr (jährlich wiederkehrend)
    await Notifications.scheduleNotificationAsync({
      identifier: `bday-${birthday.id}`,
      content: {
        title: "🎂 Geburtstag heute!",
        body: `${birthday.name} hat heute Geburtstag!`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        month: bdayMonth,
        day: bdayDay,
        hour: 9,
        minute: 0,
        repeats: true,
      },
    });

    // Erinnerung 7 Tage vorher um 9 Uhr (Monats-/Jahreswechsel wird automatisch behandelt)
    const sevenBefore = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7);
    await Notifications.scheduleNotificationAsync({
      identifier: `bday-soon-${birthday.id}`,
      content: {
        title: "🎂 Geburtstag in 7 Tagen",
        body: `${birthday.name} hat in einer Woche Geburtstag!`,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        month: sevenBefore.getMonth() + 1,
        day: sevenBefore.getDate(),
        hour: 9,
        minute: 0,
        repeats: true,
      },
    });
  }
}
