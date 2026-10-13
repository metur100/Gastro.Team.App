// GitHub Pages serves 404.html for unknown paths; copying index.html enables client-side routing.
import { copyFileSync, writeFileSync } from 'node:fs'
copyFileSync('dist/index.html', 'dist/404.html')
writeFileSync('dist/.nojekyll', '')
console.log('SPA fallback written (404.html, .nojekyll)')
