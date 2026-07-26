import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.quadreal.rtuqr',
  appName: 'RTU QR Audit',
  webDir: 'www',
  server: {
    // Allow http live-reload URLs on Android during development.
    cleartext: true,
    androidScheme: 'https',
  },
};

export default config;
