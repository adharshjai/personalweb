import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        eyenova: resolve(__dirname, 'eyenova.html')
      }
    }
  }
})
