const KEY = "travel-log-github-settings";

export type GithubSettings = {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  pagesUrl: string;
};

export function loadSettings(): GithubSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<GithubSettings>;
    if (!data.token || !data.owner || !data.repo) return null;
    return {
      token: data.token,
      owner: data.owner.trim(),
      repo: data.repo.trim(),
      branch: (data.branch || "main").trim(),
      pagesUrl: (data.pagesUrl || "").trim(),
    };
  } catch {
    return null;
  }
}

export function saveSettings(settings: GithubSettings): void {
  localStorage.setItem(
    KEY,
    JSON.stringify({
      token: settings.token,
      owner: settings.owner.trim(),
      repo: settings.repo.trim(),
      branch: (settings.branch || "main").trim(),
      pagesUrl: settings.pagesUrl.trim(),
    }),
  );
}

export function clearSettings(): void {
  localStorage.removeItem(KEY);
}
