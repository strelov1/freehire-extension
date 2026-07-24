import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    // Pins a deterministic extension id (…chromiumapp.org redirect) for dev auth.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2GECbcIeOfNjo0xv8Q4bMKgLHN5qKCOQSYfVr3aTTHlIk1VliYT/Kb+xZiCyR34tBHFYlTaJATBWLIqmoTqQghXPMvM2LmNPo6ttNKuRdiNJNFvMz5M8RE7Qfgawj8EJo2dCTzWbSdRet2HLTKTBDLsZ/9F4RpXnDQrWVaqQqDvNO9CXT99UqBuzpuTXq3WyWJYcnSjDETND62jkW2kUKj0YpybpxMYDjC1NwoXGgI2f6z3gy2FB/ld3yiaYwVu2NwZGTILgmKLQKGrutHQktnVc27qoeBVvO0s8VMnJkf3kFJPPNmJktGAbnvdiGlx4wBEGBqVEqFBhBaj0GlE1dwIDAQAB',
    name: 'freehire',
    description: 'Your job-application agent, on any page.',
    permissions: ['storage', 'tabs', 'sidePanel', 'scripting', 'activeTab', 'identity'],
    host_permissions: ['<all_urls>'],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    action: {},
  },
});
