# Design and boundaries

`web/index.html` supplies the interface; `web/app.js` handles input, freshness checks, and rendering. `web/hinge-challenge.js` contains the independent challenge state machine. The page does not interpolate angles.

## Sensor access

Both paths look for Apple vendor `0x05ac`, product `0x8104`, HID usage page `0x20`, usage `0x8a`.

Direct mode listens for WebHID Input Report 1. The expected payload is two little-endian bytes representing whole degrees. Opening the device requires browser permission. This interface is undocumented and may change or be unavailable.

Native mode uses `IOHIDDeviceGetReport` for Feature Report 1 through the read-only Swift helper. The expected bytes contain report ID 1 followed by a little-endian angle. The helper requests up to 60 reads/s and emits newline-delimited JSON. Actual timing depends on the device and host.

The native helper records read-completion times, sequence numbers, and request duration. These are not hardware capture timestamps. The page rejects replayed or backward sequences, packets more than 150 ms old, and reads completed before the page resumed or the current challenge prompt appeared. Native and browser timestamps describe different parts of the path; neither proves that every returned angle is a new physical measurement.

## Local bridge

`scripts/serve.py` serves only the demo files and two endpoints on `127.0.0.1`. It checks the Host, Origin, and browser fetch metadata, requires a custom request header, and issues a per-process random token. `/sensor` requires that token and allows one native stream at a time. Disconnecting the stream terminates its reader process. The server enables no cross-origin access.

These checks limit unwanted access from other web pages. They do not defend against another process already controlling the Mac. No readings are sent to a remote server.

## What completion means

The state machine requires multiple accepted reports in tolerance over time; elapsed display time alone cannot complete a target. Random targets and freshness gates make old recordings less useful in the unmodified demo. All verification still runs locally.

No sensor-signed message or remote verifier exists here. Hardware API access does not by itself authenticate a measurement to a server. A future remote design would need server-issued challenges, replay protection, and a carefully evaluated trust mechanism for its client. Even client attestation would not automatically become cryptographic attestation of the physical hinge reading.

For a public verification flow, hardware coverage and an accessible alternative would also be necessary. This demo only explores compatible MacBooks.
