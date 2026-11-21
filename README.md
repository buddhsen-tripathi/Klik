# Assemble on the Go

Take a photo of an object, get a 3D model and step-by-step instructions to take it apart or put it together. Runs in the phone browser and deploys as a single Cloudflare Worker.

## How it works

```
Phone browser (React + react-three-fiber)
   │  photo (resized to 1600 px in the browser)
   ▼
Worker (Hono)  ──►  R2 (photos, GLBs)   D1 (scans)
   │
   └─ ScanWorkflow (Cloudflare Workflows, one per scan)
        1. Gemini: parts, 2D boxes, a rough block model ("blockout") and the steps, as JSON
        2. fal SAM 3D Objects: one box prompt per visible part → one combined GLB, one node per part
        3. copy the GLB into R2
```

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

To try it on your phone, run `npm run dev -- --host` and open the network URL it prints (both devices on the same Wi-Fi).

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

Change the Gemini model in `wrangler.jsonc` (`GEMINI_MODEL`, default `gemini-4-neon`).

## Layout

| Path | What |
|---|---|
| `src/worker/index.ts` | API routes: create/list/get scans, serve files from R2 |
| `src/worker/workflow.ts` | The scan pipeline |
| `src/worker/gemini.ts` | Gemini prompt, JSON schema and output clean-up |
| `src/worker/fal.ts` | fal queue client for SAM 3D |
| `src/shared/types.ts` | Types shared by Worker and app |
| `src/components/Capture.tsx` | Camera / upload screen |
| `src/components/ScanPage.tsx` | Progress, viewer and steps |
| `src/components/Viewer3D.tsx` | Blockout and scanned model, exploded-view animation |
| `src/explode.ts` | Which parts are out / highlighted at each step |

## Known gaps

- No auth or rate limiting: anyone with the URL can spend your Gemini/fal credits. Add Cloudflare Turnstile or a passcode before sharing it publicly.
- The SAM 3D part split assumes the combined GLB has one node per box prompt, in order. If it doesn't, the viewer shows the scan as one piece (steps still work on the blockout).
- Scans sometimes come back sideways. Use the "Rotate scan" button.
