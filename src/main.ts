import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { IonicVue } from '@ionic/vue';
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';
import './style.css';
import App from './App.vue';
import router from './router';

// One-time migration
if (!localStorage.getItem('interpoll_migration_v2')) {
  localStorage.removeItem('seen-post-ids');
  localStorage.removeItem('seen-poll-ids');
  localStorage.setItem('interpoll_migration_v2', '1');
}

const app = createApp(App)
  .use(IonicVue)
  .use(createPinia())
  .use(router);

router.isReady().then(() => {
  app.mount('#app')
  // Defer after first paint
  setTimeout(() => {
    import('./services/gunService').then(({ GunService }) => GunService.initialize())
    import('./services/ipfsService').then(({ IPFSService }) => IPFSService.initialize())
  }, 0)
})


