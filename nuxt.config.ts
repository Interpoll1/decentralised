// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
  ],

  devtools: { enabled: false },

  css: ['~/assets/css/main.css'],

  // Remove prerender — we want live SSR from MySQL
  routeRules: {
    '/api/**': { cors: true },
  },

  runtimeConfig: {
    // Server-only (MySQL creds from .env)
    mysqlHost:     process.env.MYSQL_HOST     || '',
    mysqlUser:     process.env.MYSQL_USER     || '',
    mysqlPassword: process.env.MYSQL_PASSWORD || '',
    mysqlDatabase: process.env.MYSQL_DATABASE || '',
    mysqlPort:     process.env.MYSQL_PORT     || '3306',
    // Public (accessible in browser too)
    public: {
      appUrl:      process.env.APP_URL      || 'https://endless.sbs',
      siteUrl:     process.env.SITE_URL     || 'https://interpoll.endless.sbs',
      relayUrl:    process.env.RELAY_URL    || 'https://interpoll.endless.sbs',
      gunRelayUrl: process.env.GUN_RELAY_URL || 'https://interpoll2.endless.sbs',
    },
  },

  compatibilityDate: '2025-01-15',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs',
      },
    },
  },
})
