# Reviewing and writing a tour

## Pass 1: review

Review the PR the way you would if nobody else were going to read your notes. Go in whatever order helps you understand the code, and keep your notes in your scratch space rather than in `tour.json`.

1. **Gather context.** Read `pr.json`, the PR description and `diff.patch`. Find the linked stories from Shortcut links and `sc-<number>` references in the PR title, description and branch name (`title`, `body` and `headRef` in `pr.json`). Fetch each one with whatever Shortcut access you have, such as an MCP server, a CLI or the REST API. You need the complete description, its tasks and all of its comments. If your tool returns a summary or truncates, fetch the raw story instead. If a linked story is unavailable, state that limitation and do not claim its requirements are verified. When no story is linked, use the PR description and available design context as the stated intent. Read the full post-change version of each touched file at `headSha`, not just the hunks, along with the callers and tests the change relies on.
2. **List the requirements.** Turn the story into concrete requirements with IDs `R1`, `R2` and so on. Include acceptance criteria and anything the comments added or changed.
3. **Explain every coverage unit.** For each hunk, write down what it does, why it's there, and anything wrong with it. In a long hunk, also note which parts hold load-bearing or non-obvious logic and how they work. The why is one of these:
   - `requirement`: it is part of how one or more requirements are met.
   - `supporting`: another hunk or section needs it. This includes imports, types, helpers, props threaded through, and tests for the code they test. Point at the most specific thing it supports.
   - `mechanical`: it doesn't change behavior. This includes formatting, renames, generated files, lockfiles and import order. A change that alters behavior is never mechanical.
   - `unexplained`: you can't trace it to the story, its comments, the PR description or another hunk. Before choosing this, look at all of those. Don't invent a reason for the change.
4. **Verify each requirement against the code**, not the PR description. Mark a requirement `met` only when you can name the hunks that satisfy it. Use `unclear` when you can't check it yourself (for example, something that needs a Terraform plan or a production run), and say what would settle it. Anything the story asks for that no hunk does is `unmet` or `partial`.
5. **Look for what's missing:** error and empty states, callers that weren't updated, tests the change needs, and coverage that was removed.

## Pass 2: compose

The tour is for a human reading from top to bottom. The goal is that they never have to work out for themselves why a change is in the PR. When the agent can't explain a change, the tour should say so plainly, so the reviewer can ask the author or get the story updated.

- Order the sections the way you would explain the change to a colleague. Start with the core idea, such as the new type, table or contract. Then cover what builds on it, then callers, then tests and configuration.
- A section groups hunks that share one idea, even across files. Its `narrative` says which requirements the section serves and how it connects to the sections before it.
- Each hunk's `note` says what the hunk does in one or two sentences. Point out anything non-obvious, but don't narrate code that is plain to see. The viewer shows the `why` next to the hunk, so the note doesn't need to repeat it.
- A long hunk, such as a new file, still gets one `note` as its overview. When part of it holds load-bearing or non-obvious logic, like a function whose rules another section relies on, explain how that part works in `ranges`. Each range note covers a span of the hunk's lines, and the viewer shows it above them. Not every function needs one: short or plain code keeps just its `note`.
- Put each hunk's `why` from pass 1 on it. `requirement` lists requirement IDs. `supporting` lists section IDs or hunk refs, and the viewer links to them.
- Keep an unexplained hunk in the section where it belongs, not in a separate section at the end. The viewer lists every unexplained hunk at the top of the tour. Each one needs a `question` finding anchored on one of its lines that asks the author why. Say what you checked, and anchor it on a `LEFT` line when the hunk only removes code.
- Put generated files, lockfiles and mechanical renames in a short final section.

Rules that `validate` enforces:

- Every coverage unit appears in exactly one section.
- `headSha` matches `pr.json`.
- Requirement IDs, section IDs and finding IDs are unique.
- Every hunk has a `why`. A `requirement` why names known requirement IDs. A `supporting` why names sections or hunks that exist, and not the hunk itself.
- Every `unexplained` hunk has a `question` finding anchored inside it. For a file with no text hunks, anchor the question on the file's path with no line.
- Every `met` or `partial` requirement is implemented by at least one hunk.
- A finding's `anchor.line` must be a line inside a diff hunk. Use `side: "RIGHT"` (the default) for new or context lines, and `"LEFT"` for removed lines. For a range, `startLine` and `line` must be in the same hunk.
- A range note's `line`, and its `startLine` if it has one, must be lines of its own hunk, with the same `side` rules as findings. Range notes in one hunk can't overlap, and a file with no text hunks can't have them.
- A `suggestion` replaces the anchored RIGHT-side line or lines exactly, so give the complete replacement text, keep the file's indentation, and don't include diff markers.
- A finding with no `line`, or one on a line outside the diff, is allowed, but it is posted in the review body under "Notes outside the diff". Anchor it to a line whenever you can.
- In a revision, every finding from the previous revision is either still in a section with the same `id` or appears once in `followUp`. A `resolved` follow-up names at least one hunk that changed since the previous revision. `followUp` must be empty in the first revision.

Findings:

- Choose `severity` honestly:
  - `blocker`: wrong behavior, data loss, a security issue, or a requirement that isn't met
  - `major`: likely bug or missing case
  - `minor`: worth fixing
  - `nit`: style
  - `question`: you need the author's intent
- `body` is written to the author in Markdown. Say what's wrong, why it matters, and how you verified it. The body is posted exactly as written, under the user's name, if they accept it.
- Include a `suggestion` whenever the fix fits on the anchored lines.
- Don't file findings for things you haven't verified. If you're unsure, use a `question`.

```json
{
  "version": 1,
  "headSha": "<pr.json headSha>",
  "summary": "Markdown: what the PR does, how it meets the story, and the overall verdict.",
  "stories": [{ "id": "sc-123", "title": "…", "url": "https://app.shortcut.com/…" }],
  "requirements": [
    { "id": "R1", "text": "…", "status": "met | partial | unmet | unclear", "notes": "…" }
  ],
  "sections": [
    {
      "id": "core",
      "title": "…",
      "narrative": "Markdown",
      "hunks": [
        {
          "ref": "src/a.ts#1",
          "note": "Markdown",
          "why": { "kind": "requirement", "requirements": ["R1"] },
          "ranges": [{ "startLine": 40, "line": 88, "note": "Markdown: how this part works" }]
        },
        {
          "ref": "src/a.ts#2",
          "note": "Markdown",
          "why": { "kind": "supporting", "supports": ["src/a.ts#1"] }
        },
        { "ref": "src/b.ts#1", "note": "Markdown", "why": { "kind": "mechanical" } },
        { "ref": "src/c.ts#1", "note": "Markdown", "why": { "kind": "unexplained" } }
      ],
      "findings": [
        {
          "id": "missing-null-check",
          "severity": "major",
          "title": "…",
          "body": "Markdown",
          "anchor": { "path": "src/a.ts", "line": 42, "side": "RIGHT" },
          "suggestion": "  if (value == null) return;"
        },
        {
          "id": "why-c-changes",
          "severity": "question",
          "title": "Why does c change?",
          "body": "The story doesn't mention this and nothing else in the PR uses it. …",
          "anchor": { "path": "src/c.ts", "line": 7, "side": "RIGHT" }
        }
      ]
    }
  ],
  "followUp": [
    {
      "finding": "<finding id from the previous revision>",
      "status": "resolved | outdated",
      "note": "Markdown: how it was fixed, or why it no longer applies.",
      "refs": ["src/a.ts#1"]
    }
  ]
}
```
