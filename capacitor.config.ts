import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.venicssales.app',
  appName: 'Venics Sales',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      // NO custom smallIcon: a smallIcon that points to a missing drawable makes
      // Android drop notifications entirely. Re-add
      //   smallIcon: 'ic_stat_venics', iconColor: '#2563EB',
      // ONLY after ic_stat_venics.png exists in android/.../res/drawable-*/.
      sound: 'default',
    },
  },
};

export default config;
