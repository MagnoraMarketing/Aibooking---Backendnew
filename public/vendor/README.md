# Vendored assets

## twilio-voice-sdk.min.js

The official Twilio Voice JS SDK browser bundle (`@twilio/voice-sdk`,
`dist/twilio.min.js`), copied here because Twilio stopped serving this SDK
via CDN as of v2.0 — see their README:
https://github.com/twilio/twilio-voice.js#readme

Loaded by `public/widget.js` for `mode: "twilio_relay"` widgets (see
`lib/widgets/config.ts`). Exposes the browser global `Twilio.Device`.

To update: bump the `@twilio/voice-sdk` devDependency in the repo root
`package.json`, `npm install`, then re-copy:

```bash
cp node_modules/@twilio/voice-sdk/dist/twilio.min.js public/vendor/twilio-voice-sdk.min.js
```
