# Continuous evidence

`scripts/evidence-tick.mjs` runs one evidence **tick**: it appends new (paper) decisions to the demo
agents' chains, re-anchors each chain on Base, and regenerates `site/evidence.html`. The runner is
**append-only** when `fresh: false`, so a recurring tick adds only genuinely new decisions (no
duplicates) and the per-agent reputation keeps growing.

Run it on a **persistent host** so the agent keys + chains in `.trackproof-demo/` survive between
ticks — they are gitignored and must not be regenerated each run (a fresh store would mint new agent
identities).

## One-off

```bash
npm install && npm run build
DEPLOYER_PRIVATE_KEY=0x... npm run evidence:tick     # omit the key to skip anchoring
```

## On a schedule (crontab, hourly)

```cron
0 * * * * cd /path/to/trackproof && DEPLOYER_PRIVATE_KEY=0x... /usr/bin/node scripts/evidence-tick.mjs >> /var/log/trackproof-tick.log 2>&1
```

## Publishing the refreshed page

To update the live site, commit + push `site/evidence.html` after each tick (Vercel redeploys on
push):

```bash
git add site/evidence.html && git commit -m "Refresh live evidence" && git push
```

Reads are keyless; only anchoring needs `DEPLOYER_PRIVATE_KEY` (a funded Base Sepolia test key).

> **CI note.** GitHub Actions runners are ephemeral, so `.trackproof-demo/` (the agent keys + chains)
> would reset every run and mint new agent identities. To run the tick in CI, persist
> `.trackproof-demo/` across runs via a cache/artifact.
