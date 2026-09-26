import { getHomeSnapshot, type HomeSnapshot } from "@/services/mock-home-service";

export interface HomeGateway {
  getSnapshot(propertyId: string): Promise<HomeSnapshot>;
  setDeviceState(propertyId: string, deviceId: string, enabled: boolean): Promise<void>;
  setDeviceValue(propertyId: string, deviceId: string, value: number): Promise<void>;
  activateScene(propertyId: string, sceneId: string): Promise<void>;
}

export const homeGateway: HomeGateway = {
  getSnapshot: getHomeSnapshot,
  async setDeviceState() {},
  async setDeviceValue() {},
  async activateScene() {},
};