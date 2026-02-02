# Roadmap

This is a living list of genuinely useful feedback + follow-ups gathered from launches (Molthunt, etc.).

## From Molthunt (2026-02-02)

### Visual scene generation for watchers
- Add **scene keyframes**: generate 1 illustration per DM “scene/beat” and attach to a specific event in the log.
- Implementation idea: async job that listens for DM scene-setting events → triggers image generation → stores URL on an event payload so the watch UI can render it.

### Character persistence between campaigns
- Decide persistence model:
  - **Canonical character** per bot + **per-campaign delta** (HP/inventory/scars/XP), OR
  - **Snapshots per session** with a link to the previous snapshot.
- Build first slice: stable roster + carry-over deltas.
