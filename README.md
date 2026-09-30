# MacBook hinge challenge

A live MacBook lid-angle reader and a small physical-interaction experiment: move the screen to three random angles and hold near each one.

The demo supports direct browser access through WebHID and an optional Swift helper for more frequent reads. All readings stay on the Mac. No third-party runtime packages or accounts are required.

The instrument fills the browser window with the live angle. Once connected, arrival rates, timing, and raw readings appear along the bottom. Open **Menu** for the full-screen **Hinge challenge**, sensor connections, and diagnostics. The welcome guide appears once per tab session and can always be reopened through **Menu → About & setup**.

Dark mode opens by default, with a light option in the header or **Menu → Appearance**. Your choice is saved in this browser. The background draws your lid in profile: the footer rule is the keyboard deck, a hinge sits at its center, and a line swings to each fresh reading while screen light fills the opening and lights the dial ticks inside it. The lid sweeps open when readings start or return after a pause, then fades when readings go stale or the sensor disconnects. Its short visual transitions do not smooth or alter the numeric angle. With reduced motion enabled, the live view hides the moving decoration; the challenge keeps an unanimated pointer for guidance. The welcome guide includes a Safari compass with a red X to highlight that direct browser access requires Chrome or Edge; Safari can use the local native reader.

> **For smoother tracking, use native mode.** On the tested Mac, native mode delivered about **50 sensor reads per second**, compared with about **one browser report per second**: roughly **50× more frequent readings**. [Run the native reader locally](#run-locally). These are observed read rates; results vary by Mac. See [what to expect](#what-to-expect) for the measurement limits.

## Compatibility

**You need a MacBook running macOS with a readable built-in lid-angle sensor.** The sensor must expose the interface used by this demo and return angle readings as the screen moves. A simple lid-open/lid-closed switch is not enough.

These are candidate hardware families to try, subject to the check below. The linked Apple repair manuals document the sensor in their starting models:

| Hardware guide | Evidence of a lid-angle sensor |
| --- | --- |
| 14- or 16-inch MacBook Pro, 2021 or later | Apple's [14-inch (2021)](https://support.apple.com/en-us/100555) and [16-inch (2021)](https://support.apple.com/en-us/100574) sensor replacement procedures. |
| MacBook Air with M2 or later | Apple's [M2 (2022) repair manual](https://support.apple.com/en-us/100603) lists the Lid Angle Sensor. |

**Sensor presence alone does not guarantee support.** Apple's manuals document the hardware; this demo also depends on an undocumented HID interface. Later models still need the same check.

- **Browser mode:** use current desktop Chrome or Edge with WebHID enabled, over HTTPS or localhost, and grant sensor access. See [Chrome's WebHID documentation](https://developer.chrome.com/docs/capabilities/hid). Safari lacks WebHID ([WebKit documentation](https://webkit.org/tracking-prevention/#anti-fingerprinting)).
- **Native mode:** use the [local setup](#run-locally) with Python 3 and the Swift compiler from Xcode or its Command Line Tools. The locally served page can be used in Safari.

Development readings in both modes were observed on an **M3 Max MacBook Pro (`Mac15,8`) running macOS 27.0**; native movement was confirmed by hand. This is one tested configuration, not a minimum macOS version. Broader model and OS coverage remains unverified.

<details>
<summary>Check whether your Mac exposes the expected sensor</summary>

Run this read-only command in Terminal; it requires no download or administrator access:

```sh
hidutil list --matching '{"VendorID":1452,"ProductID":33028,"PrimaryUsagePage":32,"PrimaryUsage":138}'
```

A matching device row means macOS exposes the identifiers used by [both readers](docs/architecture.md#sensor-access): vendor `0x05ac`, product `0x8104`, usage page `0x20`, usage `0x8a`. Headers without a device row mean this demo cannot find its expected sensor. Discovery alone does not prove readable reports: connect in your chosen mode and confirm that the displayed angle changes when you gently move the screen. Browser and native access must be checked separately.

The upstream [LidAngleSensor compatibility notes](https://github.com/samhenrigold/LidAngleSensor#faq) identify the M1 MacBook Air and 13-inch M1/M2 Touch Bar MacBook Pro as problematic. They also trace the sensor to the 2019 16-inch Intel MacBook Pro, which remains unverified with this demo. Chip generation or release year alone does not establish compatibility.

</details>

## Hosted page

Open [the hosted demo](https://macbook-hinge-challenge-min3.vercel.app/) in a browser with WebHID support, such as desktop Chrome or Edge, to try direct sensor access on a [compatible MacBook](#compatibility). Browser support and hardware availability are checked separately; opening the page alone does not grant access to a sensor.

The faster native mode runs **locally on your Mac**, using the setup below. Vercel serves the web page; it cannot run the Swift helper against your laptop's hardware. The hosted page includes local setup instructions for native mode and browsers without WebHID, including Safari.

To deploy your own copy on Vercel, import this repository with **Root Directory left at the repository root** and **Framework Preset: Other**. The checked-in `vercel.json` disables the build command and publishes `web/`, so `web/index.html` becomes `/`. Do not set Root Directory to `web` as well. No Python server, Swift compiler, functions, or environment variables are required on Vercel. After changing an existing project's settings, redeploy it.

A deployment can be Ready yet return 404 at `/` if the published directory has no `index.html`. If `/web/index.html` works instead, the repository root was published rather than `web/`.

## Run locally

You need a [compatible MacBook](#compatibility) and Python 3. Native mode also needs the Swift compiler included with Xcode or its Command Line Tools. The script checks prerequisites; it does not install software or use `sudo`.

```sh
git clone https://github.com/keiryan/macbook-hinge-challenge.git
cd macbook-hinge-challenge
./scripts/run.sh
```

Open **http://127.0.0.1:8768/** in your browser, dismiss the welcome guide, and choose **Connect your MacBook → Use native reader**. The helper opens the sensor only when that button is selected. Stop the server with Control-C.

For direct WebHID without compiling the native helper:

```sh
./scripts/run.sh --browser-only
```

Open the same URL in a browser with WebHID support, such as desktop Chrome or Edge, choose **Connect your MacBook → Connect browser sensor**, and grant access to the lid sensor. If WebHID is unavailable, a modern browser can instead use the locally served native bridge.

Use `--port 8770` if the default port is occupied. The server accepts loopback connections only.

## What to expect

| Mode | Data path | Observed behavior |
| --- | --- | --- |
| Browser | Lid sensor → WebHID input report → page | Around one report per second on the tested Mac, which makes motion appear delayed. |
| Native | Lid sensor → IOKit feature-report read → local Python stream → page | Requests up to 60 reads/s; around 50 reads/s were observed during development. |

The roughly **50× difference is in reading frequency**. The user physically moved the screen and confirmed that native mode followed it smoothly. That is a hands-on observation, **not a measured latency benchmark**. Read frequency is not necessarily the sensor's physical measurement frequency; repeated reads can contain the same value. The page displays received integer angles without smoothing or invented samples.

This uses an undocumented, model-dependent sensor interface. A MacBook may lack the expected sensor or expose different reports. Compatibility across models and macOS releases is unverified. If no sensor appears, the demo cannot provide a reading. Move the screen gently within its normal range; never force the hinge.

## The challenge

For the best experience, use your browser in full screen. The challenge places three numbered targets on the background dial: guide the lid pointer to the lit point, hold while its ring fills, then continue to the next. Confirmed points become checkmarks. Nearby targets are staggered along the same angle so both remain readable.

Start after a fresh reading arrives. Three targets between 65° and 110° are generated using browser cryptographic randomness, each at least 12° from the preceding angle. Each step needs received readings within ±3° spanning at least 500 ms. There is a 60-second limit.

The demo rejects stale native packets, resets interrupted holds, and stops a challenge when the page is hidden, the sensor connection changes, you leave the challenge view, or you open a dialog. It requires reports received after the current prompt. Offline tests cover these rules; a complete three-target physical challenge has **not** been verified.

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
