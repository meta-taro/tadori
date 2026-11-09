// tadori のサイト：見ている PC に合うインストーラーを示し、GitHub のリリースから版の一覧を作る。
// GitHub から読んだ文字は、そのまま HTML に入れない（textContent で入れる）。
// 文言は <html lang> で選ぶ（ja なら日本語、それ以外は英語）。
const REPO = 'meta-taro/tadori'
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases?per_page=50`
const RELEASES_PAGE = `https://github.com/${REPO}/releases`

const LANG = document.documentElement.lang === 'ja' ? 'ja' : 'en'

/** 画面に出す文言。どちらの言語も同じ鍵を持つ */
const TEXT = {
  ja: {
    locale: 'ja-JP',
    macArm: 'macOS（Apple シリコン）',
    macIntel: 'macOS（Intel）',
    winX64: 'Windows（x64・Intel / AMD）',
    winArm: 'Windows（ARM）',
    dmg: 'ディスクイメージ（.dmg）',
    msi: 'インストーラー（.msi）',
    exe: 'セットアップ（.exe）',
    fetchFailed: status => `GitHub から読めませんでした（${status}）`,
    thisPc: 'この PC',
    pickFromReleases: message => `${message}。GitHub のリリースのページから選んでください。`,
    noReleaseYet: 'まだ公開した版はありません。最初の版を準備しています。',
    latest: (name, date) => `最新の版：${name}（${date}）`,
    notInRelease: 'この版には入っていません',
    seeReleases: message => `${message}。GitHub のリリースのページをご覧ください。`,
    noReleases: 'まだ公開した版はありません。',
    prerelease: '試し版',
    releaseNotes: 'この版の説明（GitHub）',
    noInstallers: 'インストーラーはありません',
  },
  en: {
    locale: 'en-US',
    macArm: 'macOS (Apple silicon)',
    macIntel: 'macOS (Intel)',
    winX64: 'Windows (x64, Intel / AMD)',
    winArm: 'Windows (ARM)',
    dmg: 'Disk image (.dmg)',
    msi: 'Installer (.msi)',
    exe: 'Setup (.exe)',
    fetchFailed: status => `Could not read from GitHub (${status})`,
    thisPc: 'This PC',
    pickFromReleases: message => `${message}. Please pick one from the GitHub releases page.`,
    noReleaseYet: 'No version has been published yet. The first one is being prepared.',
    latest: (name, date) => `Latest version: ${name} (${date})`,
    notInRelease: 'Not included in this version',
    seeReleases: message => `${message}. Please see the GitHub releases page.`,
    noReleases: 'No version has been published yet.',
    prerelease: 'Pre-release',
    releaseNotes: 'Release notes (GitHub)',
    noInstallers: 'No installers',
  },
}
const T = TEXT[LANG]

/** インストーラーの種類。名前は Tauri が付ける形（例：tadori_0.1.0_aarch64.dmg・tadori_0.1.0_x64-setup.exe） */
const KINDS = [
  { id: 'mac-arm', os: 'mac', label: T.macArm, test: n => /aarch64\.dmg$/i.test(n) },
  { id: 'mac-intel', os: 'mac', label: T.macIntel, test: n => /x64\.dmg$/i.test(n) },
  { id: 'win-x64', os: 'win', label: T.winX64, test: n => /x64(-setup\.exe|_[a-z-]+\.msi)$/i.test(n) },
  { id: 'win-arm', os: 'win', label: T.winArm, test: n => /arm64(-setup\.exe|_[a-z-]+\.msi)$/i.test(n) },
]

const formatOf = name => (/\.dmg$/i.test(name) ? T.dmg : /\.msi$/i.test(name) ? T.msi : T.exe)
const sizeOf = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`
const dateOf = iso => new Date(iso).toLocaleDateString(T.locale, { year: 'numeric', month: 'long', day: 'numeric' })

/** 見ている PC：OS と、分かれば CPU（Chromium 系だけが CPU を教えてくれる） */
async function detectPlatform() {
  const ua = navigator.userAgent
  const os = /Mac/i.test(ua) && !/iPhone|iPad/i.test(ua) ? 'mac' : /Windows/i.test(ua) ? 'win' : null
  let arch = null
  try {
    const data = await navigator.userAgentData?.getHighEntropyValues(['architecture'])
    if (data?.architecture) arch = data.architecture === 'arm' ? 'arm' : 'x86'
  } catch { /* 教えてもらえなければ、OS だけで決める */ }
  if (!os) return null
  if (os === 'win') return arch === 'arm' ? 'win-arm' : 'win-x64'
  return arch === 'x86' ? 'mac-intel' : 'mac-arm' // Mac で分からなければ、いま売られている Apple シリコンを先に示す
}

async function fetchReleases() {
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(T.fetchFailed(res.status))
  return (await res.json()).filter(r => !r.draft)
}

function link(asset, primary) {
  const a = document.createElement('a')
  a.className = `btn ${primary ? 'btn-primary' : 'btn-ghost'}`
  a.href = asset.browser_download_url
  const name = document.createElement('span')
  name.textContent = formatOf(asset.name)
  const size = document.createElement('small')
  size.textContent = sizeOf(asset.size)
  a.append(name, size)
  return a
}

/** ダウンロードのページ：最新の版の、OS と CPU ごとのボタン */
async function renderDownloads(root) {
  const mine = await detectPlatform()
  if (mine) root.querySelector(`[data-kind="${mine}"]`)?.classList.add('mine')
  root.querySelectorAll('[data-kind]').forEach(card => {
    if (card.dataset.kind === mine) card.querySelector('h3')?.append(Object.assign(document.createElement('span'), { className: 'badge-mine', textContent: T.thisPc }))
  })
  // 版の状態の行はページの上（root の外）に置いてあることがある
  const status = root.querySelector('[data-release-status]') ?? document.querySelector('[data-release-status]')
  let latest
  try {
    latest = (await fetchReleases()).find(r => !r.prerelease)
  } catch (error) {
    status.textContent = T.pickFromReleases(error.message)
    return
  }
  if (!latest) {
    status.textContent = T.noReleaseYet
    return
  }
  status.textContent = T.latest(latest.name || latest.tag_name, dateOf(latest.published_at))
  for (const kind of KINDS) {
    const box = root.querySelector(`[data-kind="${kind.id}"] .files`)
    if (!box) continue
    const assets = latest.assets.filter(a => kind.test(a.name))
    box.replaceChildren(...(assets.length ? assets.map((a, i) => link(a, i === 0)) : [Object.assign(document.createElement('p'), { className: 'muted', textContent: T.notInRelease })]))
  }
}

/** 過去の版のページ：版ごとに、OS と CPU ごとのボタン */
async function renderArchive(root) {
  let releases
  try {
    releases = await fetchReleases()
  } catch (error) {
    root.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: T.seeReleases(error.message) }))
    return
  }
  if (!releases.length) {
    root.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: T.noReleases }))
    return
  }
  root.replaceChildren(...releases.map(release => {
    const article = document.createElement('article')
    article.className = 'release'
    const header = document.createElement('header')
    const title = Object.assign(document.createElement('h3'), { textContent: release.name || release.tag_name })
    const time = Object.assign(document.createElement('time'), { textContent: dateOf(release.published_at), dateTime: release.published_at })
    header.append(title, time)
    if (release.prerelease) header.append(Object.assign(document.createElement('span'), { className: 'chip wait', textContent: T.prerelease }))
    const assets = document.createElement('div')
    assets.className = 'assets'
    for (const kind of KINDS) {
      for (const asset of release.assets.filter(a => kind.test(a.name))) {
        const a = link(asset, false)
        a.prepend(Object.assign(document.createElement('b'), { textContent: kind.label }))
        assets.append(a)
      }
    }
    const notes = Object.assign(document.createElement('a'), { href: release.html_url, textContent: T.releaseNotes })
    article.append(header, assets.childElementCount ? assets : Object.assign(document.createElement('p'), { className: 'muted', textContent: T.noInstallers }), notes)
    return article
  }))
}

/** トップの「ダウンロード」ボタンに、見ている PC の名前を添える */
async function labelHeroButton(button) {
  const mine = await detectPlatform()
  const kind = KINDS.find(k => k.id === mine)
  if (kind) button.querySelector('small').textContent = kind.label
}

const downloads = document.querySelector('[data-downloads]')
if (downloads) renderDownloads(downloads)
const archive = document.querySelector('[data-archive]')
if (archive) renderArchive(archive)
document.querySelectorAll('[data-hero-download]').forEach(labelHeroButton)
export { RELEASES_PAGE }
