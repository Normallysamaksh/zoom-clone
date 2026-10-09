# Validation - 8 October 2026

The completed app was checked locally with the real FastAPI backend and SQLite. Python checks were repeated in a clean virtual environment with the pinned runtime requirements.

| Check | Result |
| --- | --- |
| Backend workflow and database tests | 33 passed |
| Browser end-to-end tests | 5 passed |
| TypeScript | Passed |
| Production Next.js build | Passed |
| Production smoke test | API health, dashboard, meeting list, and invitation route passed |
| Python dependency consistency | Passed |
| Frontend code formatting and Python static checks | Passed |
| Design PDF | 26 pages, 25 screenshots; all pages rendered and visually inspected |

The live-call test launched two independent Chrome processes and verified inbound audio and video statistics on both peers. It also checked chat delivery, screen-share sender replacement, host mute-all disabling the guest's actual audio track, participant removal, and ending the meeting. Generated canvas frames and audio tones supplied the test inputs; WebRTC negotiation, encoding, network transfer, and decoding were real.

Other browser checks covered persisted scheduling, invalid meeting IDs, invitation-link joining, instant creation, mobile overflow, preferences, denied camera/microphone access, leaving a meeting, and skipping the preview with a saved preference.

Backend tests covered both local SQLite and a faithful in-process hosted HTTP protocol adapter, including foreign-key enforcement, rollback, cross-room token and signaling isolation, host permissions, stale presence, and atomic capacity under concurrent joins.

A public Vercel deployment, live Turso connectivity, physical camera/microphone devices, and calls across separate networks were not exercised. Configure hosted SQLite and a TURN relay, then perform the two-device deployment check described in README.md before submission.
