Read an agent's PR review in a guided order, with explanations beside the diff and findings attached to the relevant lines.

## What you get

- A PR Tours sidebar page and a tab beside any thread.
- Multiple tours and pinned revisions for each PR.
- Finding decisions, line comments, review summaries, and saved drafts.
- Standalone HTML downloads that open without BB or a server.

## How it works

Run `/pr-tour 123` in a BB thread, or pass a full GitHub PR URL. A bare number uses the thread’s current checkout. The bundled skill uses `bb pr-tours prepare`, `new-tour`, and `validate` to build the review. Open it in BB, review the changes, then explicitly ask the agent to sync your finished review to GitHub.

Existing standalone tours can be copied into the library with `bb pr-tours import`. Files remain on the review's BB machine, outside thread and worktree cleanup. The machine must be connected to open its tours.

## Requirements

BB 0.43 or later and an authenticated GitHub CLI on the review machine. GitHub reviews post under that CLI account. Downloads include the reviewed source code; publishing them to a hosting service is separate.
