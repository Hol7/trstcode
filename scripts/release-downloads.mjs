const repository = process.argv[2] || process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;

if (!repository || !repository.includes("/")) {
  console.error("Usage: npm run release:stats -- OWNER/REPOSITORY");
  process.exit(1);
}

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "trstcode-release-stats",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, { headers });
if (!response.ok) {
  console.error(`GitHub returned ${response.status}. ${token ? "Check token access." : "Use GITHUB_TOKEN for a private repository."}`);
  process.exit(1);
}

const releases = await response.json();
let total = 0;
for (const release of releases) {
  const assets = release.assets || [];
  const releaseTotal = assets.reduce((sum, asset) => sum + asset.download_count, 0);
  total += releaseTotal;
  console.log(`${release.tag_name.padEnd(14)} ${String(releaseTotal).padStart(7)} downloads`);
  for (const asset of assets) {
    console.log(`  ${String(asset.download_count).padStart(7)}  ${asset.name}`);
  }
}
console.log(`\nTotal installer downloads: ${total}`);
