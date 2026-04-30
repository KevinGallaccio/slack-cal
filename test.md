*Just a small caveat* (sorry to be nitpicky):

The demo I tested uses Web Speech in cloud routed mode, so privacy isn't actually guaranteed:

*On Chrome*: audio streams to Google's servers, gets transcribed, and returned.
*On Safari*: audio streams to Apple's servers, gets transcribed, and returned.

If that's acceptable, I can ship this route. No new vendor, no infra, works everywhere except Firefox.

If we want stronger privacy, two alternatives:

1. Web Speech with `processLocally`. Truly on device, but the user has to download a roughly 50MB language pack on first use, and some languages aren't supported on device at all (pain in the butt...)
2. Whisper via our existing OpenAI key. Works everywhere including Firefox, audio routed through our infra (so we control the trust boundary), no new vendor.

Happy with whichever, slight lean toward Whisper but hate to have to go through OpenAI...