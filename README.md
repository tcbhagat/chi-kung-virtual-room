# Chi Kung Virtual Room

A browser-based Qi Gong posture and shared WebXR prototype for up to 10 participants. Webcam frames remain on the device: MediaPipe extracts landmarks locally, and only compact avatar transforms are sent to the room server at 15 FPS.

## Galaxy Tab A9+ quick start

1. Open the deployed HTTPS URL in current Chrome and rotate the tablet to landscape.
2. Allow camera access and wait for all essential diagnostics to pass.
3. Tap **Continue to room**, then stand far enough back for your full body to be visible.
4. Look for **Body tracked** and **Connected** in the upper-left panel.

For a scheduled group session on Render's free tier, open the URL about two minutes early because an idle service can need roughly one minute to wake.

## Local run

Requires Node.js 18 or newer.

```bash
npm ci
npm run room
```

Open `http://localhost:8080`. Use `npm run test:10` for the 10-client telemetry harness.

## Deployment

`render.yaml` defines one free Render web service. Connect this repository as a Render Blueprint; the Node server serves the site and Socket.IO signaling from the same secure origin.

The legacy static build remains available with `npm run build`, and `npm run deploy` publishes `dist/` to GitHub Pages when a separate signaling URL is supplied.
