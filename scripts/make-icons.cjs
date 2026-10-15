// Génère les icônes PNG de l'application à partir de scripts/icon.svg.
// Usage : node scripts/make-icons.cjs (nécessite Playwright et Chromium)
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')
const { chromium } = require(require.resolve('playwright', { paths: [root, execSync('npm root -g').toString().trim()] }))
const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8')
const out = path.join(root, 'public', 'icons')
fs.mkdirSync(out, { recursive: true })
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  // [nom, taille, marge (fraction) : les icônes « maskable » gardent le dessin dans la zone sûre]
  const targets = [
    ['icon-192.png', 192, 0, 0.18],
    ['icon-512.png', 512, 0, 0.18],
    ['maskable-512.png', 512, 0.12, 0],
    ['apple-touch-icon.png', 180, 0.04, 0],
  ]
  for (const [name, size, pad, radius] of targets) {
    await page.setViewportSize({ width: size, height: size })
    const inner = size * (1 - 2 * pad)
    await page.setContent(
      `<body style="margin:0;background:${radius > 0 ? "transparent" : "#1c1917"};width:${size}px;height:${size}px;overflow:hidden">
        <div style="position:absolute;left:${size * pad}px;top:${size * pad}px;width:${inner}px;height:${inner}px;border-radius:${radius * inner}px;overflow:hidden">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body>`,
    )
    await page.screenshot({ path: path.join(out, name), omitBackground: radius > 0 })
  }
  await browser.close()
  console.log('Icônes générées dans public/icons')
})()
