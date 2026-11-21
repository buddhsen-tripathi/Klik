# Assemble on the Go

Point your phone at an object: the app names it live, guides you around it for a few angles, and builds a 3D model with step-by-step instructions to take it apart or put it together, in the background while you scan the next thing. Runs in the phone browser and deploys as a single Cloudflare Worker.

## How it works

```
Live camera ──(steady + new view, ~512 px frame)──► POST /api/identify ──► Gemini flash-lite: name + box
   │
   │  1-6 angles (front, left, back, right, top…), resized to 1600 px in the browser
   ▼  uploaded in the background; a tray tracks every scan
Worker (Hono)  ──►  R2 (photos, GLBs)   D1 (scans)
   │
   └─ ScanWorkflow (Cloudflare Workflows, one per scan)
        1. Gemini: reads all angles, picks the best photo, returns parts, 2D boxes on that photo,
           a rough block model ("blockout") and the steps, as JSON
        2. fal SAM 3D Objects (on the best photo): one box prompt per visible part → one combined GLB, one node per part
        3. copy the GLB into R2
```

- **Camera:** motion is checked on a 32×24 grayscale thumbnail ~3×/s. Gemini is only called when the view is steady *and* has changed, so a still scene costs one call. The stream stops when the tab is hidden. **Auto** mode takes a shot each time you rotate the object and hold still.
- The **blockout** shows up as soon as Gemini finishes, so the app still works if 3D generation fails or `FAL_KEY` isn't set.
- The **3D scan** is never loaded automatically. The user taps "Load 3D scan · N MB".
- The viewer renders **on demand** (no constant render loop), caps the pixel ratio at 1.5 and frees GPU memory when closed. three.js is only downloaded when a scan is opened.

## Run locally

```sh
npm install
cp .dev.vars.example .dev.vars    # add GEMINI_API_KEY (required) and FAL_KEY (optional)
npm run db:migrate:local
npm run dev                       # http://localhost:5173, with the API, D1, R2 and Workflows emulated
```

**Live camera needs HTTPS** (or localhost). On a phone over plain `http://192.168…` the app falls back to the photo picker. To test the camera on a phone, deploy (workers.dev is HTTPS) or tunnel the dev server, e.g. `cloudflared tunnel --url http://localhost:5173`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create assemble-db          # paste the database_id into wrangler.jsonc
npx wrangler r2 bucket create assemble-files
npm run db:migrate:remote
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put FAL_KEY
npm run deploy
```

Models are set in `wrangler.jsonc`: `GEMINI_MODEL` for the full analysis (default `gemini-4-neon`) and `IDENTIFY_MODEL` for the live camera (default `gemini-3.5-flash-lite`).

## Layout

| Path | What |
|---|---|
| `src/worker/index.ts` | API routes: create/list/get scans, serve files from R2 |
| `src/worker/workflow.ts` | The scan pipeline |
| `src/worker/gemini.ts` | Gemini prompt, JSON schema and output clean-up |
| `src/worker/fal.ts` | fal queue client for SAM 3D |
| `src/shared/types.ts` | Types shared by Worker and app |
| `src/components/CameraScreen.tsx` | Live camera: identify overlay, rotate guide, auto capture |
| `src/camera.ts` | Camera stream hook and cheap motion detection |
| `src/jobs.ts`, `src/components/JobTray.tsx` | Background upload/processing queue and tray |
| `src/components/Capture.tsx` | Photo-picker fallback (no camera / no HTTPS) |
| `src/components/ScanPage.tsx` | Progress, viewer and steps |
| `src/components/Viewer3D.tsx` | Blockout and scanned model, exploded-view animation |
| `src/explode.ts` | Which parts are out / highlighted at each step |

## Known gaps

- No auth or rate limiting: anyone with the URL can spend your Gemini/fal credits. Add Cloudflare Turnstile or a passcode before sharing it publicly.
- The SAM 3D part split assumes the combined GLB has one node per box prompt, in order. If it doesn't, the viewer shows the scan as one piece (steps still work on the blockout).
- Scans sometimes come back sideways. Use the "Rotate scan" button.
