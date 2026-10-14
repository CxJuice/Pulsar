import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const nodeRequire = createRequire(import.meta.url)
const nitroCacheDriverPath = join(dirname(nodeRequire.resolve('@nuxt/nitro-server')), 'runtime', 'utils', 'cache-driver.mjs')
const nitroCacheDriverUrl = pathToFileURL(nitroCacheDriverPath).href

export default defineNuxtConfig({
  ssr: false,
  spaLoadingTemplate: 'spa-loading-template.html',
  devtools: { enabled: false },
  nitro: {
    rollupConfig: {
      plugins: [{
        name: 'resolve-nitro-cache-driver-file-url',
        resolveId(id) {
          return id === nitroCacheDriverUrl ? nitroCacheDriverPath : null
        },
      }],
    },
  },
  css: ['~/assets/editor.css', '~/assets/motion-tokens.css', '~/assets/motion.css', '~/assets/select.css', '~/assets/onboarding.css', '~/assets/terms.css', '~/assets/quality.css', '~/assets/submissions.css'],
  app: {
    head: {
      title: 'Pulsar · 翻译工作台',
      htmlAttrs: { lang: 'zh-CN' },
      meta: [{ name: 'description', content: 'ParaTranz 桌面翻译工作台' }],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/Pulsar.svg' }],
    },
  },
  typescript: { strict: true },
  compatibilityDate: '2026-10-11',
})
