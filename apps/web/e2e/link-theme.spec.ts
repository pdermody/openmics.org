import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { themes } from '../src/theme'

for (const theme of themes) {
  for (const mode of ['light', 'dark']) {
    test(`links follow ${theme.id}/${mode} while preserving component styles`, async ({ page }) => {
      const stylesheet = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
      await page.setContent(`
        <main class="app">
          <p class="field-hint media-gallery-dashboard-note">
            <a href="#gallery">View the public gallery</a>
          </p>
          <p><a href="#account">Add your city</a></p>
          <a class="primary-button" href="#register">Register</a>
          <a class="quiet-button" href="#manage">Manage media</a>
          <a class="secondary-button" href="#more">More</a>
          <a class="brand" href="#home">Home</a>
          <a class="dashboard-header-link" href="#dashboard">Dashboard</a>
          <a class="back-link" href="#back">Back</a>
          <article class="dashboard-series-card"><h2><a href="#series">Series</a></h2></article>
          <div class="media-attribution"><a href="#performer">Performer</a></div>
          <span id="accent" style="color: var(--accent)"></span>
          <span id="ink" style="color: var(--ink)"></span>
          <span id="accent-ink" style="color: var(--accent-ink)"></span>
          <span id="muted" style="color: var(--muted)"></span>
          <span id="focus" style="color: var(--focus)"></span>
        </main>
      `)
      await page.addStyleTag({ content: stylesheet })
      await page.addStyleTag({ content: '.app { transition: none; }' })
      const gallery = page.getByRole('link', { name: 'View the public gallery' })

      await page.locator('main').evaluate((element, selection) => {
        element.dataset.theme = selection.theme
        element.dataset.mode = selection.mode
      }, { theme: theme.id, mode })
      const colors = await page.locator('main').evaluate((element) => {
        const color = (id: string) => getComputedStyle(element.querySelector(`#${id}`)!).color
        return { accent: color('accent'), ink: color('ink'), accentInk: color('accent-ink'), muted: color('muted'), focus: color('focus') }
      })

      await expect(gallery, `${theme.id}/${mode}: gallery link`).toHaveCSS('color', colors.accent)
      await expect(gallery).toHaveCSS('text-decoration-line', 'underline')
      await expect(page.getByRole('link', { name: 'Add your city' })).toHaveCSS('color', colors.accent)
      await expect(page.getByRole('link', { name: 'Register', exact: true })).toHaveCSS('color', colors.accentInk)
      await expect(page.getByRole('link', { name: 'Manage media' })).toHaveCSS('color', colors.ink)
      await expect(page.getByRole('link', { name: 'More', exact: true })).toHaveCSS('color', colors.ink)
      await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveCSS('color', colors.ink)
      await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCSS('color', colors.muted)
      await expect(page.getByRole('link', { name: 'Back', exact: true })).toHaveCSS('color', colors.accent)
      await expect(page.getByRole('link', { name: 'Series', exact: true })).toHaveCSS('color', colors.ink)
      await expect(page.getByRole('link', { name: 'Performer', exact: true })).toHaveCSS('color', 'rgb(255, 255, 255)')
      for (const name of ['Register', 'Manage media', 'More']) {
        await expect(page.getByRole('link', { name, exact: true })).toHaveCSS('text-decoration-line', 'none')
      }

      await gallery.hover()
      await expect(gallery).toHaveCSS('color', colors.ink)
      await page.getByRole('link', { name: 'Register', exact: true }).hover()
      await expect(page.getByRole('link', { name: 'Register', exact: true })).toHaveCSS('color', colors.accentInk)
      await page.mouse.move(0, 0)
      await gallery.focus()
      await expect(gallery).toHaveCSS('outline-color', colors.focus)
      await expect(gallery).toHaveCSS('outline-style', 'solid')
      await expect(gallery).toHaveCSS('outline-width', '3px')
    })
  }
}
