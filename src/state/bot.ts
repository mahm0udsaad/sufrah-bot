// Global bot state management
let globalBotEnabled = true;
const welcomedUsers = new Set<string>();

export function getGlobalBotEnabled(): boolean {
  return globalBotEnabled;
}

export function setGlobalBotEnabled(enabled: boolean): void {
  globalBotEnabled = enabled;
}

export function hasWelcomed(phoneNumber: string): boolean {
  return welcomedUsers.has(phoneNumber);
}

export function markWelcomed(phoneNumber: string): void {
  welcomedUsers.add(phoneNumber);
}

export function getWelcomedUsersCount(): number {
  return welcomedUsers.size;
}
