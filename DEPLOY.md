# Deploying and releasing

CI lives in [`.github/workflows`](.github/workflows):

- **`ci.yml`**: on every push and pull request to `main`, `pnpm build`, `pnpm check` (format,
  lint, typecheck, tests, depcruise, knip, agent skill, generated native files), and
  `pnpm test:packages` (packed exports, SSR imports, and isolated web / Skia 2 / Skia 3 consumers).
  It also installs Chromium and runs the browser lifecycle smoke tests.
  On a push to `main` it deploys the studio
  to Cloudflare Pages if the Cloudflare secrets are set.
- **`release.yml`**: on a push to `main` that touches packages, changesets, native sources or
  release tooling,
  [Changesets](https://github.com/changesets/changesets) opens a "Version Packages" PR from any
  pending changesets; merging that PR publishes the bumped `@orb3d/*` packages to npm over
  OIDC / Trusted Publishing.
- **`native.yml`**: reusable Swift build/tests and Android library/sample builds, called by both
  workflows. Releases wait for these jobs at the same commit, check generated native files,
  and smoke-test tarballs before running the publisher.

Both need one-time account setup, below. Until then CI stays green: it skips the deploy, and the
release workflow manages Version PRs without attempting to publish.

## 0. The public repo

The repo must exist publicly at `github.com/Amir-Abushanab/orb3d` before the first publish:
npm provenance points at it. The packages publish under the `@orb3d` scope, so create the `orb3d`
organisation on npm first (free for public packages).

## 1. Deploy the studio to Cloudflare Pages

`pnpm --filter orb-studio build` produces `apps/studio/dist`, deployed to Cloudflare Pages as
project **`orb-studio`**.

One-time:

1. **Create a Cloudflare API token.** Dashboard, My Profile, API Tokens, Create Token, template
   "Edit Cloudflare Workers" (or a custom token with Account, Cloudflare Pages, Edit). Copy it.
2. **Get your Account ID** from the Cloudflare dashboard (Workers & Pages overview, or the
   dashboard URL).
3. **Add two GitHub repo secrets** (repo Settings, Secrets and variables, Actions):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. Optional. The workflow creates the project on its first deploy. To do it by hand:
   ```sh
   pnpm dlx wrangler login
   pnpm dlx wrangler pages project create orb-studio --production-branch=main
   ```

Then push to `main`: CI builds and deploys. The live URL is `https://orb-studio-6ak.pages.dev`
until you add a custom domain.

The deploy preflight checks that both secrets are set and skips the deploy with a notice when
either is missing. The check job uploads the studio build as a workflow artifact, and the deploy
job deploys that artifact rather than building again.

### Custom domain

In the Cloudflare Pages project, Custom domains, add the domain (and `www`). If its DNS is on
Cloudflare it is a click; otherwise add the CNAME it shows you.

## 2. Publish the packages to npm

The `@orb3d` packages publish through Changesets. `@orb3d/core`, `@orb3d/react`,
`@orb3d/element` and `@orb3d/react-native` are a **fixed** group and always share one version. The studio
(`orb-studio`) is private and takes no changesets.

### Recording a change

Whenever you change a published package, add a changeset. It drives the next version bump and
changelog:

```sh
pnpm changeset          # pick the packages, the bump (patch/minor/major), write a summary
```

Commit the generated `.changeset/*.md` file alongside your change.

### First release (one-time, from your laptop)

The packages start at 0.1.0. Pending changesets drive the next version after the bootstrap.
npm cannot do a package's first publish over OIDC, so publish the initial version by hand. First
create the free **`@orb3d` organization** on [npmjs.com](https://www.npmjs.com/org/create)
(the scope is public; `.changeset/config.json` sets `access: "public"`), then:

```sh
npm login               # uses your account's 2FA; nothing is stored in the repo
pnpm install
pnpm release            # checks, builds, smoke-tests and publishes all four @orb3d packages
```

After that, changesets as normal: each merged changeset feeds the next Version Packages PR.

Until 0.1.0 is on npm, `release.yml`'s preflight gate sees `@orb3d/core` absent from the
registry and manages Version PRs only, so earlier runs stay green.

### Enable tokenless CI releases (one-time, right after the first publish)

On each package's npm page: Settings, Trusted Publisher, add provider **GitHub Actions**,
repository **`Amir-Abushanab/orb3d`**, workflow **`release.yml`** (leave Environment blank).
CI then publishes over OIDC with no `NPM_TOKEN`, and every release carries provenance.
On that same form, enable **Allow `npm publish`** under Allowed actions; the workflow publishes
directly rather than staging a release for later approval.

GitHub also needs **Allow GitHub Actions to create and approve pull requests** enabled in the
repository's Settings, Actions, General page so Changesets can open its version PRs. The API
combines creation and approval in one setting; the release workflow only creates PRs.

### Adding a new package

A new package needs the same bootstrap. The preflight gate keys off `@orb3d/core`, so once
that exists CI will try to publish the newcomer, and fails on it until you bootstrap by hand:

1. `npm login`, then `pnpm release` from your laptop. This publishes the new package's first
   version plus any pending bumps.
2. Add its Trusted Publisher on npmjs.com with the same values as above.

### Ongoing releases (automated)

1. Merge PRs that include changesets into `main`.
2. Changesets opens or updates a **"Version Packages"** PR (bumps the shared version, writes
   `CHANGELOG.md`, and syncs the agent skill's `library_version`).
3. Merge that PR. CI publishes the new version, tags it and cuts a GitHub Release.

`pnpm release` runs [`scripts/publish-if-needed.mjs`](scripts/publish-if-needed.mjs) rather than
`changeset publish`. The script publishes only the versions the registry confirms are missing,
creates each git tag locally, and writes the NDJSON git-tag events that `changesets/action` v2
reads to push the tags and create the releases. It exists because `@changesets/cli` 2.31 misreads
npm 11 (which the workflow installs for OIDC), tries to publish over an already-published version
and crashes on the E403 after the packages have reached npm, leaving a red run with no tags. It
also restores a tag that a past run published but never pushed. Pass `--dry-run` to preview what
it would publish.

> **Benign red run:** merging the Version PR while an older Release run is still in flight can
> fail that older run with "The pull request cannot be reopened". The run for the Version PR's own
> merge commit does the real work. The workflow's self-heal step reports the real API status rather
> than the bare `HttpError` the action surfaces.

> **Fallback:** if OIDC publishing 404s, create a granular `NPM_TOKEN` (scoped to `@orb3d`,
> read-write, no IP allowlist) and add it as `NODE_AUTH_TOKEN` in `release.yml`'s changesets step.

## 3. The Swift package and the Android library

**Swift.** SwiftPM resolves the package from this repository by plain semver tags. When the release
script publishes `@orb3d/core`, it also tags the commit with the bare version (`0.1.0`), which
changesets/action pushes with the other tags, so
`.package(url: "https://github.com/Amir-Abushanab/orb3d", from: "0.1.0")` resolves as soon as the
release lands. There is nothing to upload.

**Android.** `native/android/orb3d` has `maven-publish` set up:
`./gradlew :orb3d:publishReleasePublicationToMavenLocal` produces
`io.github.amirabushanab:orb3d:<core version>` (AAR, sources, POM). Where it is published from is
not wired up yet. Maven Central needs a Sonatype account with the `io.github.amirabushanab`
namespace verified and signing keys in the release workflow; JitPack would need a `jitpack.yml`
that builds from `native/android`.

Until remote distribution is configured, Android is a source preview. The studio's Android
export and [Android README](native/android/README.md) use a locally built
`orb3d-release.aar`, with `implementation(files("libs/orb3d-release.aar"))` in the consuming app.

## The pre-commit hook

`pnpm install` sets `core.hooksPath` to `.githooks` through the `prepare` script. The hook formats and lints the staged files. CI runs the full
`pnpm check` gate.

## What is not wired up here

- **A gallery** of community orbs, as the sibling projects have.
- **Video and GIF export** from the studio; the embed page is the moving export for now.
- **A WebGPU engine.** WebGL2 runs everywhere an orb needs to, so there is no second engine.
