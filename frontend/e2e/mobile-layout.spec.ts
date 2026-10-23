import { expect, test, type Page } from '@playwright/test'

import type { AlbumPageData, ArtistItem, ArtistPageData, DiscographyAlbum, MusicRequest, TopTrack } from '../src/api/types'

const artist: ArtistItem = {
  mbid: 'mobile-artist', name: 'The Orchestra of Incredibly Long Artist Names and Friends', image: '', in_library: true,
}
const quota = { limit: 10, used: 2, remaining: 8, period: 'week' as const, resets_at: '2026-10-30T12:00:00Z' }
const album: DiscographyAlbum = {
  mbid: 'mobile-album', title: 'An Album with a Very Long Title for Small Screens', primary_type: 'Album',
  secondary_types: [], date: '2026-10-23', listen_count: 100, cover: '',
  library: { state: 'available', percent: 100, lidarr_id: null }, request: null,
}
const tracks: TopTrack[] = [{
  title: 'A Long Track Title That Must Leave Room for the Duration', preview: '/test-preview.mp3',
  duration: 245, album_title: album.title, cover: '', explicit: true,
}]
const request: MusicRequest = {
  id: 1, kind: 'album', release_group_mbid: album.mbid, artist_mbid: artist.mbid, title: album.title,
  artist_name: artist.name, album_type: 'Album', release_date: album.date, cover_url: '', status: 'pending_approval',
  requested_at: '2026-10-23T12:00:00Z', decided_at: null, rejection_reason: '', submitted_at: null,
  completed_at: null, progress: 0, error_code: '', user: { id: 1, username: 'operator', display_name: 'Operator' },
}
const permissions = { quota, requests_enabled: true, requires_approval: false, dry_run: false, blocked: null, request: null }
const artistPage: ArtistPageData = {
  artist: { ...artist, type: 'Group', country: 'IT', disambiguation: '', begin: '2000', end: '', tags: ['rock'], track_file_count: 1 },
  sources: { listenbrainz: true, deezer: true }, ...permissions,
}
const albumPage: AlbumPageData = {
  album: { ...album, artist_mbid: artist.mbid, artist_name: artist.name, artist_image: '' },
  tracks: tracks.map((track, index) => ({ ...track, disc: 1, position: index + 1, length_ms: track.duration * 1000 })),
  library: album.library, ...permissions,
}

/** Real local backend/session; only catalogue and integration data are simulated. */
async function fixtures(page: Page) {
  const responses: Record<string, unknown> = {
    '/api/discover': {
      rows: [
        { id: 'for_you', kind: 'artists', title_key: '', items: Array.from({ length: 8 }, (_, i) => ({ ...artist, mbid: `${artist.mbid}-${i}` })) },
        { id: 'trending_albums', kind: 'albums', title_key: '', items: [{ ...album, artist_name: artist.name }] },
      ], library_size: 10, has_seeds: true, requests_enabled: true,
    },
    [`/api/artists/${artist.mbid}`]: artistPage,
    [`/api/artists/${artist.mbid}/discography`]: { albums: [album] },
    [`/api/artists/${artist.mbid}/popular`]: { albums: [album] },
    [`/api/artists/${artist.mbid}/similar`]: { artists: [artist] },
    [`/api/artists/${artist.mbid}/top-tracks`]: { tracks },
    [`/api/albums/${album.mbid}`]: albumPage,
    '/api/search/artists': [{ ...artist, type: 'Group', country: 'IT', disambiguation: '', score: 100, tags: ['rock'] }],
    '/api/search/albums': [{ ...album, artist_mbid: artist.mbid, artist_name: artist.name, first_release_date: album.date }],
    '/api/genres/artists': { artists: [artist], related: ['pop', 'alternative rock'], ranked: true },
    '/api/genres/albums': { albums: [{ ...album, artist_name: artist.name }], available: true },
    '/api/requests/mine': [request],
    '/api/admin/requests': [request],
    '/api/settings/webhook': { path: '/api/webhooks/lidarr', username: 'nexbeat', password: 'test-webhook-password', events: ['Download'] },
    '/api/settings/lidarr/options': {
      root_folders: [{ path: '/music/a-long-root-folder-for-mobile-tests', accessible: true, free_space: null }],
      quality_profiles: [{ id: 1, name: 'Lossless' }],
      metadata_profiles: [{ id: 1, name: 'Studio albums', primary: ['Album'], secondary: [], statuses: ['Official'], studio_only: true }],
    },
  }
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname in responses) return route.fulfill({ json: responses[pathname] })
    if (pathname === '/api/auth/me' && route.request().method() === 'GET') {
      const response = await route.fetch()
      return route.fulfill({ json: { ...await response.json(), seen_version: '1.4.1' } })
    }
    if (pathname === '/api/settings' && route.request().method() === 'GET') {
      const response = await route.fetch()
      return route.fulfill({ json: {
        ...await response.json(), request_mode: 'arr', public_url: `https://${'long-public-address-'.repeat(4)}example.test`,
        lidarr_url: 'http://127.0.0.1:9', lidarr_api_key_set: true, lidarr_root_folder: '/music',
        lidarr_quality_profile_id: 1, lidarr_metadata_profile_id: 1,
      } })
    }
    return route.continue()
  })
  await page.route(/https?:\/\/(?!127\.0\.0\.1:8036\/)/, (route) => route.abort())
}

async function checkLayout(page: Page, mobile: boolean) {
  await expect(page.locator('main h1')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Wird geladen|Loading/ })).toHaveCount(0)
  // Allow entrance animations to finish before measuring transformed boxes.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  const outside = await page.locator('main').evaluate((main) => {
    return [...main.querySelectorAll<HTMLElement>('*')].filter((element) => {
      if (!element.getClientRects().length || element.closest('[aria-hidden="true"], .pointer-events-none')) return false
      for (let parent = element.parentElement; parent && parent !== main; parent = parent.parentElement) {
        // Shelves intentionally scroll; decorative backgrounds intentionally extend past their clip.
        if (getComputedStyle(parent).overflowX === 'auto') return false
      }
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1)
    }).map((element) => `${element.tagName}: ${element.textContent?.slice(0, 70)}`)
  })
  expect(outside).toEqual([])
  if (mobile) {
    const smallTargets = await page.locator('button, a[href], input[type="checkbox"]').evaluateAll((elements) => elements.flatMap((element) => {
      if (!element.getClientRects().length) return []
      const target = element instanceof HTMLInputElement ? element.closest('label') ?? element : element
      const rect = target.getBoundingClientRect()
      return rect.width < 44 || rect.height < 44 ? [`${element.tagName}: ${element.textContent?.trim()} (${rect.width}×${rect.height})`] : []
    }))
    expect(smallTargets).toEqual([])
  }
  if (page.viewportSize()!.width < 640) {
    const smallInputs = await page.locator('input:not([type="checkbox"]), select, textarea').evaluateAll((elements) => elements
      .filter((element) => element.getClientRects().length && parseFloat(getComputedStyle(element).fontSize) < 16)
      .map((element) => element.outerHTML))
    expect(smallInputs).toEqual([])
  }
}

const routes = [
  '/', '/suche?q=orchestra', `/kuenstler/${artist.mbid}`, `/album/${album.mbid}`, '/genre/rock', '/anfragen', '/admin/anfragen',
  ...['adresse', 'mail', 'anmeldung', 'lidarr', 'quellen', 'benutzer', 'kontingente'].map((tab) => `/admin/einstellungen?reiter=${tab}`),
  '/profil', '/ueber',
]

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 767, height: 915 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1280, height: 900 }]) {
  test(`layout at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await fixtures(page)
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const problems: string[] = []
    page.on('pageerror', (error) => problems.push(error.message))
    for (const path of routes) {
      await test.step(path, async () => {
        await page.goto(path)
        // All local API calls and lazy sections must settle, so empty/loading pages cannot pass.
        await page.waitForLoadState('networkidle')
        await checkLayout(page, viewport.width < 768)
        if (path.startsWith('/kuenstler/') || path.startsWith('/album/')) {
          await expect(page.getByText('4:05', { exact: true })).toBeVisible()
        }
        if (path.endsWith('reiter=lidarr')) {
          const url = page.locator('code').filter({ hasText: 'long-public-address' })
          await expect(url).toBeVisible()
          expect(await url.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
          await page.getByRole('button', { name: 'Zeigen', exact: true }).click()
          await expect(page.getByText('test-webhook-password', { exact: true })).toBeVisible()
          await expect(page.getByRole('button', { name: 'Kopieren', exact: true })).toHaveCount(3)
          await url.locator('..').getByRole('button', { name: 'Kopieren', exact: true }).click()
          await expect(url.locator('..').getByRole('button', { name: 'Kopiert', exact: true })).toBeVisible()
          expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await url.textContent())
          await checkLayout(page, viewport.width < 768)
        }
      })
    }
    expect(problems).toEqual([])
  })
}
