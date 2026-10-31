import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.interpoll.app',
  appName: 'InterPoll',
  webDir: 'dist',
  server: {
    // https scheme gives the WebView a secure context, which crypto.subtle
    // (encryptionService, voteTracker, chat) requires. Do not change to http.
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#e7e9ec',
      showSpinner: false
    }
  }
};

export default config;
