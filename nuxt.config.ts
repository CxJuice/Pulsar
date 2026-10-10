export default defineNuxtConfig({
  ssr: false,
  spaLoadingTemplate: 'spa-loading-template.html',
  devtools: { enabled: false },
  css: ['~/assets/editor.css', '~/assets/motion-tokens.css', '~/assets/motion.css', '~/assets/select.css', '~/assets/onboarding.css', '~/assets/terms.css', '~/assets/quality.css'],
  app: {
    head: {
      title: 'ScTranslateKit · 翻译工作台',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [{ name: 'description', content: 'ParaTranz 桌面翻译工作台' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    },
  },
  typescript: { strict: true },
  compatibilityDate: '2026-10-11',
})
