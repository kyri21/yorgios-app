import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Couvre le client ET les fonctions Cloud : la date math est dupliquée
    // des deux côtés (pas d'import cross-package dans ce projet) et les deux
    // copies doivent rester d'accord.
    include: ['src/**/*.test.ts', 'functions/src/**/*.test.ts'],
    environment: 'node',
  },
})
