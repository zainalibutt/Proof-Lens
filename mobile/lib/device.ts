import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { randomUUID, getRandomBytes } from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";

const INSTALL_ID_KEY = "prooflens_install_id";
const FALLBACK_INSTALL_ID_KEY = "prooflens_install_id_fallback";

export async function getOrCreateInstallId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (existing) return existing;

    const fallbackExisting = await AsyncStorage.getItem(FALLBACK_INSTALL_ID_KEY);
    if (fallbackExisting) {
      await SecureStore.setItemAsync(INSTALL_ID_KEY, fallbackExisting).catch(() => {});
      return fallbackExisting;
    }

    const id = randomUUID();
    await SecureStore.setItemAsync(INSTALL_ID_KEY, id);
    return id;
  } catch (e) {
    console.warn("[device] SecureStore failed, fallback ID:", e);
    const fallbackExisting = await AsyncStorage.getItem(FALLBACK_INSTALL_ID_KEY).catch(() => null);
    if (fallbackExisting) return fallbackExisting;

    const fallback = `${Platform.OS}-${Date.now()}-${Array.from(getRandomBytes(8)).map(b => b.toString(16).padStart(2, '0')).join('')}`;
    await AsyncStorage.setItem(FALLBACK_INSTALL_ID_KEY, fallback).catch(() => {});
    return fallback;
  }
}
