# PR Tours for BB

Read an agent's guided PR review inside BB, accept or dismiss findings, add line comments, and keep a draft GitHub review. Download a standalone HTML copy from the viewer when you want to share it.

This plugin reuses the tour format, diff parser, validation, revision history, review construction, and React viewer from `monorepo/pr-tour`. BB supplies the UI and backend transport, so no separate viewer server is needed.

## Install

Requires BB 0.43 or later with Plugin SDK 0.5.9, and an authenticated GitHub CLI on each machine used for reviews. Development checks use Node 22 and Bun.

```sh
npm install
bun run build
bb plugin install . --yes
```

`npm install` builds the portable viewer through the package's prepare script. `bun run build` rebuilds that viewer and BB's server, frontend, and host bundles. After changing an installed checkout, build and run `bb plugin reload pr-tours`.

## Use

Ask your agent to create a PR tour. The plugin includes a `pr-tours` skill with the review and authoring workflow; new agent sessions discover it automatically.

```sh
bb pr-tours prepare https://github.com/owner/repo/pull/123
bb pr-tours new-tour <review-id> --model <model-id> --agent <agent-name>
# The agent authors tour.json in thread storage or its workspace.
bb pr-tours write-tour <review-id> --tour <tour-id> --file /absolute/path/to/tour.json
bb pr-tours validate <review-id> --tour <tour-id>
```

Open **PR Tours** in BB's sidebar for the full library, or choose **PR Tours** in a thread's new-tab actions. The thread tab shows that thread's reviews and can show the full library. Use **Refresh tours** after the agent writes or revises a tour. The tour and revision pickers stay inside BB.

To bring in an existing standalone review:

```sh
bb pr-tours import /absolute/path/to/review-directory
```

Import copies the PR snapshots, tours, revisions, and drafts into persistent plugin storage. It preserves the source and refuses to overwrite an existing imported PR. `bb pr-tours list` prints the library IDs and locations; `bb pr-tours tours <review-id>` lists a PR's tours.

Preparation uses the current thread's machine. Outside a thread it uses BB's primary machine; `--host <id>` or `--thread <id>` chooses explicitly. The reported path belongs to that machine. Tour files live in the host's plugin data directory, so deleting a worktree or thread does not remove them. The server stores a small library index and thread associations in the plugin database. The host must be connected to read or edit its tours.

## Export

Use **Export HTML** in the viewer toolbar to download the selected tour and its revision history, with bundled styles, syntax highlighting, and JavaScript. Open the file directly or put it on a static host.

The export is a reading copy. It omits private drafts, comments, and unposted decisions. Readers can track their own reading progress in their browser, but cannot edit the review or post to GitHub.

Exported files contain the reviewed source code. The plugin downloads files; uploading them to a hosting service is not included.

## Revisions and GitHub reviews

Prepare the PR again on the same machine, then run `bb pr-tours revise <review-id> --tour <id>`. Each revision keeps its own commit and diff snapshot. Earlier revisions are read-only. Already-posted findings cannot be posted again.

The viewer saves decisions under the authenticated GitHub user's numeric ID and shows that account. Only a tour's author can decide its findings; other reviewers can add their own comments. If the host's authenticated account changes while editing, saving fails until the tour is reloaded.

After marking a review ready in the viewer, ask the agent to sync it:

```sh
bb pr-tours sync <review-id> --tour <id> --dry-run
bb pr-tours sync <review-id> --tour <id>
```

Sync uses `gh` on the review's machine. It checks that the PR is open, the reviewed commit is current, the decision is allowed, and the draft has not already been posted. Posting remains an explicit CLI action; marking a draft ready does not send it to GitHub.

## Development

```sh
npm run check-types
npm run lint
npm test
bun run build
```

The inherited Bun suite tests diff parsing, validation, revisions, review payloads, and the standalone transport. Vitest uses BB's official backend, host, and frontend harnesses to test the plugin boundaries, draft saves, downloads, and error states. The frontend test harness does not check browser layout; verify layout in BB after building.

`shared/` contains portable review logic; `cli/` retains the standalone implementation and filesystem services. `host.ts` performs filesystem and GitHub operations. `server.ts` owns the library, CLI registration, RPC, and export endpoint. `app.tsx` registers the BB page and thread tab; `viewer/` is shared with the standalone export.

The host RPC transport currently limits individual responses to 8 MiB. Very large PRs or long revision histories may exceed that limit and will require paginated loading. Export is a snapshot of the prepared data; it does not fetch new commits.
