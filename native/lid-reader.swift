import Foundation
import IOKit.hid

// Read-only feature polling. Requested polling frequency is not a guarantee
// that the underlying sensor produces a new measurement on every request.
setbuf(stdout, nil)
func emit(_ item: [String: Any]) {
    if let bytes = try? JSONSerialization.data(withJSONObject: item),
       let line = String(data: bytes, encoding: .utf8) { print(line) }
}
let options = IOOptionBits(kIOHIDOptionsTypeNone)
let manager = IOHIDManagerCreate(kCFAllocatorDefault, options)
IOHIDManagerSetDeviceMatching(manager, [kIOHIDVendorIDKey: 0x05ac, kIOHIDProductIDKey: 0x8104, kIOHIDPrimaryUsagePageKey: 0x20, kIOHIDPrimaryUsageKey: 0x8a] as CFDictionary)
IOHIDManagerOpen(manager, options)
defer { IOHIDManagerClose(manager, options) }
guard let devices = IOHIDManagerCopyDevices(manager) as? Set<IOHIDDevice>, let device = devices.first else {
    emit(["error": "No built-in lid sensor found."]); exit(1)
}
let opened = IOHIDDeviceOpen(device, options)
guard opened == kIOReturnSuccess else { emit(["error": "Sensor open failed: \(opened)"]); exit(2) }
defer { IOHIDDeviceClose(device, options) }
var failures = 0
var sequence: UInt64 = 0
while true {
    let started = ProcessInfo.processInfo.systemUptime
    var data = [UInt8](repeating: 0, count: 8)
    var length = CFIndex(data.count)
    let result = IOHIDDeviceGetReport(device, kIOHIDReportTypeFeature, 1, &data, &length)
    // These mark completion of the native read, not hardware capture time.
    let readCompletedMonoMs = ProcessInfo.processInfo.systemUptime * 1000
    let readCompletedEpochMs = Date().timeIntervalSince1970 * 1000
    let readMs = readCompletedMonoMs - started * 1000
    if result == kIOReturnSuccess && length >= 3 && data[0] == 1 {
        let angle = Int(data[1]) | (Int(data[2]) << 8)
        if angle <= 360 {
            sequence += 1
            emit(["angle": angle, "raw": Array(data.prefix(length)), "reportId": 1,
                  "sequence": sequence, "readMs": readMs,
                  "readCompletedMonoMs": readCompletedMonoMs,
                  "readCompletedEpochMs": readCompletedEpochMs])
            failures = 0
        } else { failures += 1 }
    } else { failures += 1 }
    if failures >= 10 { emit(["error": "Unable to read valid feature reports: \(result)"]); exit(3) }
    Thread.sleep(forTimeInterval: max(0.001, 1.0 / 60.0 - (ProcessInfo.processInfo.systemUptime - started)))
}
