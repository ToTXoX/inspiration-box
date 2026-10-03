const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
    if (event.key === 'Home') next = tabs[0];
    if (event.key === 'End') next = tabs.at(-1);
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    next.focus();
  });
}

// Static fallback remains usable when the GitHub API is unavailable or rate-limited.
async function updateDownload() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const status = document.getElementById('release-status');
  try {
    const response = await fetch('https://api.github.com/repos/ToTXoX/inspiration-box/releases/latest', {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (response.status === 404) {
      status.textContent = '首个稳定版本尚未发布，可在 GitHub 查看发布进度。';
      for (const label of document.querySelectorAll('[data-download-label]')) label.textContent = '查看发布版本';
      return;
    }
    if (!response.ok) return;
    const release = await response.json();
    if (release.draft || release.prerelease || !Array.isArray(release.assets)) return;
    const asset = release.assets.find((item) => /^InspirationBox-.*-macos-universal\.dmg$/.test(item.name));
    if (!asset) return;
    const url = new URL(asset.browser_download_url);
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/ToTXoX/inspiration-box/releases/download/')) return;
    for (const link of document.querySelectorAll('[data-download]')) link.href = url.href;
    const size = typeof asset.size === 'number' ? ` · ${(asset.size / 1024 / 1024).toFixed(1)} MB` : '';
    status.textContent = `${release.tag_name} · macOS 13+ · 通用安装包${size}`;
  } catch {
    // Keep the links to the Releases page, without interrupting the page.
  } finally {
    clearTimeout(timeout);
  }
}
updateDownload();
