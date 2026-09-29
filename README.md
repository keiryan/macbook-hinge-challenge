# MacBook hinge challenge

A live MacBook lid-angle reader and a small physical-interaction experiment: move the screen to three random angles and hold near each one.

The demo supports direct browser access through WebHID and an optional Swift helper for more frequent reads. All readings stay on the Mac. No third-party runtime packages or accounts are required.

## Hosted page

Open [the hosted demo](https://macbook-hinge-challenge-min3.vercel.app/) in a browser with WebHID support, such as desktop Chrome or Edge, to try direct sensor access on a compatible MacBook. Browser support and hardware availability are checked separately; opening the page alone does not grant access to a sensor.

The faster native mode runs **locally on your Mac**, using the setup below. Vercel serves the web page; it cannot run the Swift helper against your laptop's hardware. The hosted page includes local setup instructions for native mode and browsers without WebHID, including Safari.

To deploy your own copy on Vercel, import this repository with **Root Directory left at the repository root** and **Framework Preset: Other**. The checked-in `vercel.json` disables the build command and publishes `web/`, so `web/index.html` becomes `/`. Do not set Root Directory to `web` as well. No Python server, Swift compiler, functions, or environment variables are required on Vercel. After changing an existing project's settings, redeploy it.

A deployment can be Ready yet return 404 at `/` if the published directory has no `index.html`. If `/web/index.html` works instead, the repository root was published rather than `web/`.

## Run locally

You need a compatible MacBook and Python 3. Native mode also needs the Swift compiler included with Xcode or its Command Line Tools. The script checks prerequisites; it does not install software or use `sudo`.

```sh
git clone https://github.com/keiryan/macbook-hinge-challenge.git
cd macbook-hinge-challenge
./scripts/run.sh
```

Open **http://127.0.0.1:8768/** in your browser and choose **Use native reader**. The helper opens the sensor only when that button is selected. Stop the server with Control-C.

For direct WebHID without compiling the native helper:

```sh
./scripts/run.sh --browser-only
```

Open the same URL in a browser with WebHID support, such as desktop Chrome or Edge, choose **Connect browser sensor**, and grant access to the lid sensor. If WebHID is unavailable, a modern browser can instead use the locally served native bridge.

Use `--port 8770` if the default port is occupied. The server accepts loopback connections only.

## What to expect

| Mode | Data path | Observed behavior |
| --- | --- | --- |
| Browser | Lid sensor → WebHID input report → page | Around one report per second on the tested Mac, which makes motion appear delayed. |
| Native | Lid sensor → IOKit feature-report read → local Python stream → page | Requests up to 60 reads/s; around 50 reads/s were observed during development. |

The user physically moved the screen and confirmed that native mode followed it smoothly. That is a hands-on observation, **not a measured latency benchmark**. Read frequency is not necessarily the sensor's physical measurement frequency; repeated reads can contain the same value. The page displays received integer angles without smoothing or invented samples.

This uses an undocumented, model-dependent sensor interface. A MacBook may lack the expected sensor or expose different reports. Compatibility across models and macOS releases is unverified. If no sensor appears, the demo cannot provide a reading. Move the screen gently within its normal range; never force the hinge.

## The challenge

Start after a fresh reading arrives. Three targets between 65° and 110° are generated using browser cryptographic randomness, each at least 12° from the preceding angle. Each step needs received readings within ±3° spanning at least 500 ms. There is a 60-second limit.

The demo rejects stale native packets, resets interrupted holds, and stops a challenge when the page is hidden or the sensor connection changes. It requires reports received after the current prompt. Offline tests cover these rules; a complete three-target physical challenge has **not** been verified.

This is an experiment in adding a physical obstacle for agents limited to ordinary browser interaction. **It is not a secure CAPTCHA or remote proof of human presence.** A client controlled by an attacker can modify JavaScript or outgoing claims. Neither WebHID nor this native helper produces a cryptographically signed hinge measurement. The local session token protects access to the bridge; it does not attest the sensor or prove a human moved it. See [design and boundaries](docs/architecture.md).

## Checks

Node.js 18 or newer is needed only for the offline tests. Tests use synthetic inputs and never open a sensor.

```sh
node --test tests/*.test.js
python3 -m py_compile scripts/serve.py
bash -n scripts/run.sh
```

To compile the native reader without running it:

```sh
mkdir -p .build/module-cache
xcrun swiftc -O -module-cache-path .build/module-cache native/lid-reader.swift -o .build/lid-reader
```

## Sources

Sensor discovery and report-format research were informed by [TANG617/LidPerspective](https://github.com/TANG617/LidPerspective), especially its [WebHID findings](https://github.com/TANG617/LidPerspective/blob/main/web/README.md), and [samhenrigold/LidAngleSensor](https://github.com/samhenrigold/LidAngleSensor). See [attribution](docs/attribution.md).

## License

[Apache-2.0](LICENSE). Research credits are recorded in [NOTICE](NOTICE); upstream projects retain their own licenses.
