import { create } from "zustand";
import { User } from "../types";

interface AuthState {
  user: User | null;
  familyId: string | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setFamilyId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  familyId: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  setFamilyId: (familyId) => set({ familyId }),
  setLoading: (isLoading) => set({ isLoading }),
}));
