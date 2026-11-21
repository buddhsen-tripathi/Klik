# KLIK

**Point your phone at an object and get a 3D model of it, plus step-by-step instructions to take it apart or put it back together, with a voice coach that watches through the camera while you work.**

It runs in the phone browser (no app to install) and deploys as a single Cloudflare Worker.

Live demo: https://assemble-on-the-go.buddhsen-work.workers.dev

---

## Features

- **Live camera scan.** The app names what it sees in real time and guides you around the object for a few angles. Shots are taken automatically when you rotate the object and hold it still.
- **A 3D model that keeps the real shape.** Each visible part is reconstructed from your photos with SAM 3D, keeping its texture and curves. The model is then sized against the estimated real dimensions as a sanity check, not reshaped.
- **Parts that move on their own.** Every part is a separate object. Next / Back lift each part out and set it down in a parts tray in front of the model (taking apart), or move it back into place (putting together).
- **Hidden parts from reference photos.** Parts the camera can't see (an inner chassis, axles) are looked up with web image search. A close photo is used only when a strict check says it shows exactly that part. Otherwise the part stays a simple block. Your scan is never replaced, and every reference photo is credited with a link to its source.
- **Agents that check each other.** The step writers run in parallel and leave handoff notes for each other. A reviewer checks the combined plan for missing or duplicate parts, steps with no tool, and order conflicts. It re-runs only the writer that got it wrong, and every fix shows up in the traces and under "What the AI saw".
- **Steps that improve with use.** When you say a step is wrong or confusing, or the live coach keeps catching the same mistake on a step (or a progress check finds one), the step is rewritten to prevent it and saved, so the next person gets the better version. Before rewriting, the model checks the complaint is actually about that step. The step card shows what changed and why.
- **Real specs.** Screws, sizes and tools come from the object's manual and spec pages found on the web, not from guesses.
- **Voice helper.** Talk to the app hands-free: "next step", "show me the left wheel", "what size is that screw?". It drives the whole app through tools.
- **Live coach.** The camera and the voice helper watch you work. The coach advances the steps when you finish one, warns you when something looks wrong or unsafe, and otherwise stays quiet.
- **Buy what you need.** Tap a tool, or a part's "Find a replacement" / "Buy spares", to see matching products from [Shop](https://shop.dev) (Shopify's catalog). The voice helper can do it too: "I lost a screw, where can I get one?"
- **Fix the plan.** Went off-script? Show the camera (or a photo) and it works out what's done, what's wrong, writes fix-up steps and tells you where to carry on.
- **Background processing.** Scan the next thing while the last one builds; a tray tracks every job.
- **Observability.** Every scan, API request, voice session and tool call is sent to Clonvo Traces as OpenTelemetry spans.
- **Mobile first.** The 3D view stays pinned at the top, the steps scroll below it, and Back / Next plus the voice controls sit in a bottom dock in thumb reach. Rendering is on-demand and three.js loads lazily, so it stays light on phones.

## How it works

```
Phone camera ── steady + new view ──► /api/identify ──► Gemini: "what is this?" + box
   │
   │  1-6 angles, resized in the browser, uploaded in the background
   ▼
Worker (Hono) ──► R2 (photos, GLB models)   D1 (scans, timings, fix plans)
   │
   └─ ScanWorkflow (Cloudflare Workflows, one per scan; independent steps run in parallel)
        1. Gemini reads all angles: parts, 2D boxes, size estimate, a block model
        2. Clonvo web search: manual / spec pages for real fastener sizes and tools
        3. Step-writer agents, one per subassembly, in parallel; each leaves handoff notes
           → plan reviewer: code checks (missing/duplicate parts, tools, order), re-runs only a
             broken writer with the others' notes, reorders groups from the notes
        4. fal SAM 3D Objects: one job per visible part → GLBs
           + hidden parts: Clonvo image search → strict Gemini pick → SAM 3D on that photo
        5. Save to R2, export the trace to Clonvo

Browser ──(ephemeral token)──► Gemini Live (voice + camera frames, tool calls)
        └─ live coach: Gemini Decisions API checks each step against the camera
```

## Run it locally

You need Node 20+ and a Cloudflare account (only for deploying).

```sh
npm install
cp .dev.vars.example .dev.vars    # fill in the keys below
npm run db:migrate:local
npm run dev                       # http://localhost:5173 with the API, D1, R2 and Workflows emulated
```

| Key | Needed? | What for |
|---|---|---|
| `GEMINI_API_KEY` | required | Analysis, steps, live camera, voice helper |
| `FAL_KEY` | optional | 3D scans with SAM 3D. Without it you get the block model only |
| `CLONVO_API_KEY` | optional | Web specs, reference photos and Clonvo Traces |

The live camera needs HTTPS (or localhost). To try it on a phone, deploy it (workers.dev is HTTPS) or tunnel the dev server, e.g. `cloudflared tunnel --url http://localhost:5173`.

## Deploy

```sh
npx wrangler login
npx wrangler d1 create assemble-db           # put the database_id in wrangler.jsonc
npx wrangler r2 bucket create assemble-files
npm run db:migrate:remote
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put FAL_KEY              # optional
npx wrangler secret put CLONVO_API_KEY       # optional
npm run deploy
```

Models and limits are set in `wrangler.jsonc` (`GEMINI_MODEL`, `STEPS_MODEL`, `IDENTIFY_MODEL`, `LIVE_MODEL`, `ANALYSIS_THINKING`, `MAX_3D_JOBS`).

## Project layout

| Path | What |
|---|---|
| `src/worker/index.ts` | API routes and per-request tracing |
| `src/worker/workflow.ts` | The scan pipeline |
| `src/worker/gemini.ts`, `decisions.ts` | Gemini prompts and schemas, Decisions API client |
| `src/worker/fal.ts` | fal queue client for SAM 3D |
| `src/worker/clonvo.ts`, `referenceImage.ts` | Web specs, image search and the reference-photo check |
| `src/worker/shop.ts` | Product search on Shop MCP (tools, spares, replacement parts) |
| `src/worker/recovery.ts` | "Fix the plan" from a photo of your progress |
| `src/worker/otel.ts`, `tracing.ts` | OpenTelemetry export to Clonvo Traces |
| `src/components/camera/` | Live camera, identify overlay, live step check |
| `src/components/scan/` | Scan page, workbench layout, toolbar, dock buttons |
| `src/components/viewer/` | 3D viewer: scanned model, block model, parts tray, auto framing |
| `src/components/steps/` | Steps panel, step card, progress bar, dock |
| `src/components/agent/` | Voice helper and live coach (Gemini Live over WebSocket) |
| `src/components/recovery/` | Progress check and fix plan UI |
| `src/explode.ts` | Where each part is at each step |
| `src/shared/types.ts` | Types shared by the Worker and the app |

## Known limitations

- There is no auth or rate limiting, so anyone with the URL can spend your API credits. Add Cloudflare Turnstile or a passcode before sharing it widely.
- SAM 3D works from a single photo per part, so the backs of parts are inferred.
- Scans occasionally come back sideways. Use the 90° button to fix it.

## Contributing

Issues and pull requests are welcome. Before you open a PR, run `npm run build` and `npm run lint`, and keep new UI in small per-feature components.

## Credits

This project is built on these open-source projects:

| Project | Used for | License |
|---|---|---|
| [React](https://github.com/facebook/react) | UI | MIT |
| [three.js](https://github.com/mrdoob/three.js) | 3D rendering | MIT |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber) and [@react-three/drei](https://github.com/pmndrs/drei) (Poimandres) | React renderer for three.js, GLTF loading, controls | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) (`lucide-react`) | UI icons | ISC |
| [Hono](https://github.com/honojs/hono) | Worker API routing | MIT |
| [Vite](https://github.com/vitejs/vite) and [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | Dev server and build | MIT |
| [Cloudflare workers-sdk](https://github.com/cloudflare/workers-sdk) (Wrangler, `@cloudflare/vite-plugin`) | Local emulation and deploys | MIT / Apache-2.0 |
| [TypeScript](https://github.com/microsoft/TypeScript) | Types | Apache-2.0 |
| [Oxc / oxlint](https://github.com/oxc-project/oxc) | Linting | MIT |
| [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) (Meta AI) | Photo → 3D part reconstruction, run via fal | [SAM License](https://github.com/facebookresearch/sam-3d-objects/blob/main/LICENSE) |

These hosted services power it:

- [Google Gemini API](https://ai.google.dev/) for analysis, step writing, the Decisions API and Gemini Live voice.
- [fal.ai](https://fal.ai/) for hosting SAM 3D Objects inference.
- [Clonvo](https://clonvo.com/) for web search, image search and Traces.
- [Shop MCP](https://shop.dev/) (Shopify) for product search: tools, spare screws and replacement parts.
- [Cloudflare](https://www.cloudflare.com/) for Workers, Workflows, D1 and R2.

Reference photos used for hidden parts belong to their owners. The app shows the source link next to each part that uses one.

## License

[MIT](LICENSE)
