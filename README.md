# Dave's Vet Station

The cattle consultation page is `vet.html`. It calls the same DAVE service
at `https://dave.sagewire.dev/vet/ask` as the HerdMate field client.

The conversation update preserves chat, photos, optional animal context,
and spoken replies. It adds an explicit New case action and session IDs,
retains the presenting complaint in longer conversations, and lets users
review/extend dictated text before tapping ASK DAVE. Browser speech pauses
no longer automatically submit unfinished questions.

Failed HTTP requests keep the question and attached photo for retry without
adding a failed turn to model history. Answer formatting escapes model HTML,
and source links permit HTTP(S) only. Prior conversations are labeled as
unverified, rather than presented as confirmed clinical cases. Spoken replies
are no longer truncated at an arbitrary character boundary.

The companion DAVE service update enables session-aware memory and validated
citation provenance. The client also remains compatible with the older API,
but evidence relevance and clinical accuracy are not established by this UI.
This change affects DAVE's cattle page; Alice, Joe, and Hazel are separate
services and are not altered.

## Validation

- `node tests/vet-runtime.test.cjs`: offline VM checks of the actual page script
  with DOM, speech, file reader, and network stubs. Covers dictation, safe
  formatting/links, retry/photo retention, history, and new-case reset.
- `node tests/vet-ui.test.cjs`: Playwright browser checks, including a 390px
  viewport. Install Playwright and Chromium first; `CHROMIUM_PATH` may select
  an installed browser. `SCREENSHOT_PATH` optionally records the rendered page.

The runtime checks pass. Browser rendering, real microphone/TTS, and live API
checks remain pending; the development environment's browser download was
blocked. Synthetic tests do not establish medical accuracy.
