---
name: pr-tours
description: Create, revise, or open a guided PR review in BB's PR Tours plugin. Use when the user asks for a PR tour or a guided walkthrough of a pull request. Ordinary PR reviews do not require a tour.
---

# PR Tours

Use `bb pr-tours` from any checkout. The plugin stores snapshots, tours, revisions, and reviewer drafts on the selected BB machine, outside worktrees and thread cleanup. The machine needs an authenticated `gh` CLI. No viewer server is needed.

## Create or reopen

1. Run `bb pr-tours prepare <PR URL | owner/repo#number>`. The current thread selects the machine and is associated with the review. Outside a thread, pass `--thread <id>` or `--host <id>` when needed. Keep the returned review ID, host ID, and directory. Read its `pr.json` and `diff.json`; `diff.patch` contains the pinned diff. Surface preparation warnings, especially a truncated diff.
2. Run `bb pr-tours tours <review-id>`. Reuse a valid tour for the current commit unless the user requested a new take. If the user's tour is outdated and they requested an update, revise it.
3. Run `bb pr-tours new-tour <review-id> --model <actual model ID> --agent <agent name>`. This records the authenticated user as author and prints the file to write.
4. Read [writing-tours.md](references/writing-tours.md) before reviewing or composing. Review the complete change, then author `tour.json` in the current thread storage or workspace on the reported machine. Run `bb pr-tours write-tour <review-id> --tour <tour-id> --file /absolute/path/to/tour.json`. This validates and saves it into plugin storage without requiring the agent to write there directly. A remote path belongs to that host, not the BB server.
5. Run `bb pr-tours validate <review-id> --tour <tour-id>` and correct validation errors. Every hunk must be covered and explained. Validation also refreshes the plugin library.
6. Tell the user to open **PR Tours** in BB's sidebar, or select **PR Tours** in the thread panel's new-tab actions. Summarize substantive findings in chat without duplicating the tour. They can accept/dismiss findings, comment, select a decision, and mark the review ready there.

To bring an existing standalone review into the plugin, run `bb pr-tours import /absolute/review/directory`. It copies the whole revision history into persistent plugin storage, preserving the original. Pass `--host` or `--thread` to select the source machine. Import refuses to overwrite an existing review. Use `bb pr-tours list` to find registered reviews.

## Revise

Run prepare again on the same host, then `bb pr-tours revise <review-id> --tour <id>`. Only the author can revise a tour. Read the previous revision and the new `changes.json`, and author a complete tour for the new snapshot and save it with `write-tour`. Keep IDs for unchanged sections and findings. Every previous finding must either remain or appear in `followUp` with a resolved/outdated explanation. Resolved findings must point to changed hunks. Validate again.

## Export and sync

The viewer toolbar offers **Export HTML**, a standalone reading copy without private drafts or unposted decisions. It cannot edit reviews or post to GitHub. Export includes PR code, so use the user's intended audience.

Only sync when the user asks to post and has marked the review ready. Run `bb pr-tours sync <review-id> --tour <id> --dry-run` first and inspect the event and comments, then run without `--dry-run` under the user's existing authorization. Report the posted review URL. A ready draft alone is not authorization to post. Sync refuses closed or outdated PRs, invalid self-reviews, and already-posted drafts.

Only edit the latest `tour.json`. The CLI owns metadata and snapshots; the viewer owns drafts. Never manufacture authorship, copy another author's findings into a reviewer's comments, or work around sync refusals.
