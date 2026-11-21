# Private QR downloads (Feature 7)

The desktop app serves completed session files from a loopback-only HTTP service on port `47625`. A configured Cloudflare Tunnel can expose that service through HTTPS so guests on mobile data can reach it. The service validates random per-session tokens, enforces event expiry, serves no-index/no-store responses, applies an in-memory request limit, and streams a ZIP for Download all without saving a ZIP copy.

There is no R2 bucket or real cloud file upload configured. Photo bytes pass through the tunnel provider on request; photo files remain on the booth PC. Links are unavailable while the booth app or tunnel is offline. Keep tunnel credentials on the booth PC and do not commit them.

## Feature 8 upload queue (mock-only)

Completed sessions enqueue generated download copies when present and the finished layout in SQLite. Original photo files are deliberately excluded. Queue rows survive restarts; interrupted `uploading` rows recover to `pending`. The injectable uploader interface supports deterministic success/failure/retry tests, but the desktop app has no network uploader and does not transmit queued files. The start screen reports how many items are waiting and the latest error. A real provider, private bucket credentials, signed URLs, and guest-page integration remain deferred until explicitly planned and approved.
