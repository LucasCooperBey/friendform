import { stopFakeFromPidFile } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  await stopFakeFromPidFile();
}
