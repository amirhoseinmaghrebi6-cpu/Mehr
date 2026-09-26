export type RealtimeConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export type HomeEvent =
  | { type: "device.state_changed"; deviceId: string; state: unknown; occurredAt: string }
  | { type: "security.event"; eventId: string; severity: "info" | "warning" | "critical"; occurredAt: string }
  | { type: "energy.updated"; watts: number; occurredAt: string }
  | { type: "notification.created"; notificationId: string; occurredAt: string };

export interface RealtimeClient {
  getConnectionState(): RealtimeConnectionState;
  subscribe(propertyId: string, listener: (event: HomeEvent) => void): () => void;
}