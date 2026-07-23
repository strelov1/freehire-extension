import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'freehire',
    description: 'Your job-application agent, on any page.',
    permissions: ['storage', 'tabs', 'sidePanel', 'scripting', 'activeTab'],
    host_permissions: ['<all_urls>'],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    action: {},
  },
});
