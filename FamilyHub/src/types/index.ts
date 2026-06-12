export interface User {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  photoURL?: string;
  familyId?: string;
  role: "admin" | "member" | "child";
  birthday?: string;
}

export interface Family {
  id: string;
  name: string;
  members: string[];
  inviteCode: string;
  createdAt: string;
}

export interface ShoppingList {
  id: string;
  name: string;
  familyId: string;
  items: ShoppingItem[];
  createdBy: string;
  createdAt: string;
}

export interface ShoppingItem {
  id: string;
  name: string;
  quantity?: string;
  category?: string;
  checked: boolean;
  addedBy: string;
}

export interface BudgetEntry {
  id: string;
  familyId: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  addedBy: string;
  receiptUrl?: string;
}

export interface MealPlan {
  id: string;
  familyId: string;
  weekStart: string;
  days: MealDay[];
}

export interface MealDay {
  date: string;
  breakfast?: string;
  lunch?: string;
  dinner?: string;
}

export interface Birthday {
  id: string;
  familyId: string;
  name: string;
  date: string;
  relation?: string;
}

export interface BloodPressureEntry {
  id: string;
  userId: string;
  systolic: number;
  diastolic: number;
  pulse: number;
  time: "morning" | "evening";
  date: string;
  note?: string;
}

export interface DiabetesEntry {
  id: string;
  userId: string;
  bloodSugar: number;
  measurement: "fasting" | "before_meal" | "after_meal" | "bedtime";
  insulin?: number;
  date: string;
  note?: string;
}

export interface SOSAlert {
  id: string;
  userId: string;
  familyId: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  resolved: boolean;
}
