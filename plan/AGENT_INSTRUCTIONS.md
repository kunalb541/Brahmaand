# AGENT_INSTRUCTIONS — read this first

You are an AI engineer (or human) about to implement a web-based 3D/VR astronomy app from this
repository. **As of writing there is NO application code** — only this blueprint: research dumps,
design docs, and phase-by-phase runbooks. This file is the contract for *how* to work here. Read it
fully before touching anything.

---

## 1. Mission

Build, in order, a **desktop-first, VR-ready** astronomy app on **TypeScript + Vite + Three.js +
WebXR**, fed entirely by public data services, with **no backend in v1**:

1. **Real-imagery sky** — survey photography (DSS2, Pan-STARRS, SDSS, 2MASS, Mellinger, Rubin) as
   HiPS tiles on an inside-out celestial sphere.
2. **Real-distance 3D flythrough** — millions of Gaia DR3 stars at Bailer-Jones distances,
   preprocessed offline into compact binary chunks, rendered as a custom point/impostor field.
3. **Live transient layer** — "what changed tonight" from public Rubin/LSST alert brokers.

Plus object info/search (SIMBAD/VizieR/Sesame/hips2fits, all browser-direct), a WebXR "Enter VR"
mode (developed headset-free via the Immersive Web Emulator), and $0/month static hosting.

The end state and feature detail live in [docs/00-vision.md](../docs/00-vision.md). The "why" behind
every technical choice lives in the research dumps under [docs/research/](../docs/research/).

---

## 2. Read order

1. **This file** (AGENT_INSTRUCTIONS.md) — how to work.
2. [ROADMAP.md](../ROADMAP.md) — milestones M0–M8, dependency graph, effort/risk. Pick the
   lowest-numbered incomplete milestone.
3. [docs/00-vision.md](../docs/00-vision.md) and [docs/01-architecture.md](../docs/01-architecture.md)
   — the what and the shape (modules, scene graph, coordinate frames, protocol seams).
4. **The current phase's runbook** in `plan/` (see §3 for the canonical mapping) — your step-by-step
   for this milestone.
5. The **design docs that runbook cites** (`docs/02`…`docs/08`), and the **research dumps** those
   cite, when you need the primary evidence behind a decision.

Don't read everything up front. Read this file + ROADMAP + vision + architecture once, then work
phase-by-phase, pulling in each phase's cited docs as you reach it.

---

## 3. Canonical phase numbering (IMPORTANT)

**Milestone Mn maps 1:1 to `plan/PHASE-n-*.md`.** This is the source of truth. (An earlier draft of
the README/ROADMAP used a different compressed mapping; the reconciled, canonical scheme is below
and is what every phase file's `milestone:` tag follows.)

| Milestone | Phase file | What it delivers |
|---|---|---|
| M0 | [PHASE-0-setup.md](PHASE-0-setup.md) | Repo scaffold + Three.js engine skeleton |
| M1 | [PHASE-1-sky-sphere.md](PHASE-1-sky-sphere.md) | Static sky sphere, look controls, coordinate plumbing, survey registry |
| M2 | [PHASE-2-hips-engine.md](PHASE-2-hips-engine.md) | HiPS streaming engine (LOD, tile cache, Allsky, failover, survey switch) |
| M3 | [PHASE-3-starfield.md](PHASE-3-starfield.md) | 3D star-field flythrough (day-1 ATHYG data, camera-relative, shaders) |
| M4 | [PHASE-4-gaia-pipeline.md](PHASE-4-gaia-pipeline.md) | Offline Gaia DR3 → GSC1 chunk pipeline (swaps ATHYG → Gaia) |
| M5 | [PHASE-5-data-layer.md](PHASE-5-data-layer.md) | Object info, name search & cutouts (SIMBAD/VizieR/Sesame/hips2fits) |
| M6 | [PHASE-6-webxr.md](PHASE-6-webxr.md) | WebXR VR mode (additive, headset-free dev) + phone magic-window |
| M7 | [PHASE-7-transients-lsst.md](PHASE-7-transients-lsst.md) | Rubin/LSST transient layer + LSST-readiness |
| M8 | [PHASE-8-ship.md](PHASE-8-ship.md) | Performance hardening, mobile, service worker, deploy, v1.0 release gate |

Dependency notes that break strict sequence:
- **M4 (Gaia pipeline) is offline work** — it can be built in parallel with M1/M2/M3 by a second
  person. It is numbered after M3 only because M3 defines the chunk format M4 must emit, and M3
  already runs on day-1 ATHYG data so it is not blocked.
- **M2 splits the "HiPS" concept** that the prose ROADMAP narrates as one idea into PHASE-1
  (static sphere + frame plumbing) and PHASE-2 (the streaming engine). Build PHASE-1 green first.

---

## 4. Standing rules (non-negotiable)

1. **TypeScript strict.** `tsconfig` strict mode on; no `any` without a `// VERIFY:` justification.
2. **No backend in v1.** Everything runs in the browser or in the offline Python pipeline. The only
   conditional server is a ~15-line stateless caching proxy for alert brokers, and *only* if their
   CORS turns out closed (PHASE-7 VERIFY). If you find yourself wanting a server, stop and re-read
   the non-goals in [docs/00-vision.md](../docs/00-vision.md).
3. **Never present unverified data as fact.** Scientific honesty is a product principle: real data
   only; label anything simulated, modelled, or uncertain in the UI.
4. **Pin dependencies exactly.** No `^`/`~` ranges. The versions in [README.md](../README.md) "Tech
   stack" and each phase file are pinned for a reason (Three.js has no semver; r-version churn
   breaks `examples/jsm` imports — see [docs/07-pitfalls.md](../docs/07-pitfalls.md)).
5. **Performance budgets are gates, not suggestions.** The tables in
   [docs/06-performance.md](../docs/06-performance.md) (and echoed in each phase) must hold. A phase
   isn't done if it's over budget.
6. **Every phase ends green before the next begins:** all of the phase's acceptance-test table
   passes, **plus** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` clean. Do not start
   PHASE-(n+1) on a red PHASE-n.
7. **Commit per numbered step-group** with conventional-commit messages
   (`feat(sky): …`, `test(healpix): …`, `chore(ci): …`). Small, reviewable commits.
8. **License hygiene:** **never copy code from GPL/AGPL/LGPL projects** (Aladin Lite, Stellarium Web
   Engine — reference/learning only). Only WWT and OpenSpace (MIT) are copy-from sources. See
   [docs/research/existing-projects.md](../docs/research/existing-projects.md) for the license gate.
9. **Zero steady-state allocation in the frame loop.** Preallocate scratch objects; no `new`,
   spreads, or closures inside `setAnimationLoop`. Verified with the DevTools allocation timeline.
10. **Attribution is mandatory.** Display `obs_copyright` from HiPS `properties`; credit
    ESA/Gaia/DPAC, Bailer-Jones, ATHYG, Rubin, CDS, and the brokers (PHASE-8 §5).

---

## 5. How to handle `VERIFY:` markers

The docs separate **VERIFIED** facts (live-probed 2026-06-11, with source URLs) from `VERIFY:`
items — claims that need a runtime test before you rely on them. Every `VERIFY:` carries a fallback.

When you reach a `VERIFY:` in a phase:
1. **Test the claim first** (run the probe / write the unit test / check the API responds).
2. If it holds: proceed; note "verified <date>" in the relevant doc.
3. If it fails: take the documented fallback and record what you found.
4. **Update the doc in place** — these docs are living. Don't leave a resolved `VERIFY:` as if still
   open, and don't silently delete one you couldn't resolve.

Treat a `VERIFY:` as a required test, never an assumption. The big blocking ones are flagged in
their phases (e.g. PHASE-2's HiPS tile UV orientation, the HEALPix library correctness spike).

---

## 6. Decision log

Append every non-trivial decision to **`docs/DECISIONS.md`** (create it on first decision; a seed
file already exists). One line per decision: date, what, why, alternatives rejected. Examples you'll
hit early: the HiPS UV-orientation winner (PHASE-2 §6), the HEALPix library choice (PHASE-2 §0), the
Gaia+ATHYG ShareAlike resolution (PHASE-8 §7.2). When you resolve a cross-doc contradiction, fix
*all* affected docs to agree and log the choice here.

---

## 7. When research is stale

The research dumps were live-verified **2026-06-11**. URLs, npm versions, CORS headers, and broker
endpoints drift. Before you *pin* a dependency or *rely* on an endpoint in code:
- Re-fetch the URL (a one-line `curl -I` / `fetch`), re-check the npm version, re-probe CORS.
- If it moved, update the doc and the pin, and log it in `docs/DECISIONS.md`.
The "What could change this plan" table in [ROADMAP.md](../ROADMAP.md) lists the watch items most
likely to have shifted (LSST access timing, broker CORS, Three.js WebGPU-XR maturity, Gaia DR4).

---

## 8. When to stop and ask the human

Escalate (don't guess) when:
- **Money:** anything that costs money (paid hosting tier, a domain purchase, paid API).
- **Accounts/credentials:** creating an ESA Gaia account, broker accounts, Cloudflare account,
  storing secrets. (The Gaia `full` preset *requires* a free ESA account — flag it, don't invent
  credentials.)
- **Licensing ambiguity:** any copy-from decision you're unsure is permissively licensed; the
  Gaia+ATHYG ShareAlike-on-the-bundle question before commercial use.
- **Irreversible/outward-facing actions:** deploying to a public production URL the first time,
  emailing CDS, anything that publishes data externally.
- **Stuck > ~2 hours** on one problem with no converging fallback — surface the blocker, what you
  tried, and the options, rather than thrashing.

---

## 9. Current status & next action

- **Phase:** planning complete; **implementation not started.**
- **All nine phase runbooks (PHASE-0 … PHASE-8) and all design docs exist.**
- **Next action:** open [plan/PHASE-0-setup.md](PHASE-0-setup.md) and do **step 1**.

Work the milestones in order (respecting the §3 parallelism notes), end each one green, log
decisions, keep every `VERIFY:` honest. Build something real and true to the data.
