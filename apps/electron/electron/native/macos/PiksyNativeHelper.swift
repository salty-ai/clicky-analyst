import AVFoundation
import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit

struct PermissionSnapshot: Codable {
    let microphone: String
    let accessibility: String
    let screenRecording: String
    let screenContent: String
}

struct CapturedDisplay: Codable {
    let screenIndex: Int
    let displayId: UInt32
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let label: String
    let isCursorScreen: Bool
    let screenshotWidthInPixels: Int
    let screenshotHeightInPixels: Int
    let mediaType: String
    let data: String
}

func writeJSON<T: Encodable>(_ value: T) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    FileHandle.standardOutput.write(data)
}

func permissionSnapshot(promptAccessibility: Bool = false, promptScreen: Bool = false)
    -> PermissionSnapshot
{
    if promptScreen {
        _ = CGRequestScreenCaptureAccess()
    }

    let microphone =
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized ? "granted" : "denied"
    let accessibility =
        AXIsProcessTrustedWithOptions(
            promptAccessibility
                ? [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
                    as CFDictionary : nil
        ) ? "granted" : "denied"
    let screenRecording = CGPreflightScreenCaptureAccess() ? "granted" : "denied"

    return PermissionSnapshot(
        microphone: microphone,
        accessibility: accessibility,
        screenRecording: screenRecording,
        screenContent: screenRecording
    )
}

func requestMicrophone() {
    let semaphore = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .audio) { _ in
        semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 60)
}

func nsScreensByDisplayID() -> [CGDirectDisplayID: NSScreen] {
    var screens: [CGDirectDisplayID: NSScreen] = [:]
    for screen in NSScreen.screens {
        if let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
            as? CGDirectDisplayID
        {
            screens[screenNumber] = screen
        }
    }
    return screens
}

func fallbackCaptureDisplays() throws {
    throw NSError(
        domain: "PiksyNativeHelper.ScreenCapture",
        code: -3,
        userInfo: [
            NSLocalizedDescriptionKey: "ScreenCaptureKit screenshots require macOS 13.0 or later."
        ]
    )
}

func captureLabel(index: Int, count: Int, isCursorScreen: Bool) -> String {
    if count == 1 {
        return "user's screen (cursor is here)"
    }
    if isCursorScreen {
        return "screen \(index + 1) of \(count) - cursor is on this screen (primary focus)"
    }
    return "screen \(index + 1) of \(count) - secondary screen"
}

func captureDisplays() async throws {
    guard CGPreflightScreenCaptureAccess() else {
        fputs("Screen recording permission has not been granted.\n", stderr)
        exit(2)
    }

    if #available(macOS 13.0, *) {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)
        guard !content.displays.isEmpty else {
            try writeJSON([CapturedDisplay]())
            return
        }

        let mouseLocation = NSEvent.mouseLocation
        let screens = nsScreensByDisplayID()
        let ownBundleIdentifier = Bundle.main.bundleIdentifier
        let ownAppWindows = content.windows.filter { window in
            window.owningApplication?.bundleIdentifier == ownBundleIdentifier
        }
        let sortedDisplays = content.displays.sorted { left, right in
            let leftFrame = screens[left.displayID]?.frame ?? left.frame
            let rightFrame = screens[right.displayID]?.frame ?? right.frame
            let leftContainsCursor = leftFrame.contains(mouseLocation)
            let rightContainsCursor = rightFrame.contains(mouseLocation)
            if leftContainsCursor != rightContainsCursor { return leftContainsCursor }
            return leftFrame.minX < rightFrame.minX
        }

        var captures: [CapturedDisplay] = []
        for (index, display) in sortedDisplays.enumerated() {
            let displayFrame = screens[display.displayID]?.frame ?? display.frame
            let isCursorScreen = displayFrame.contains(mouseLocation)
            let filter = SCContentFilter(display: display, excludingWindows: ownAppWindows)
            let configuration = SCStreamConfiguration()
            let maxDimension = 1280
            let aspectRatio = CGFloat(display.width) / CGFloat(max(1, display.height))
            if display.width >= display.height {
                configuration.width = maxDimension
                configuration.height = Int(CGFloat(maxDimension) / aspectRatio)
            } else {
                configuration.height = maxDimension
                configuration.width = Int(CGFloat(maxDimension) * aspectRatio)
            }

            let image = try await SCScreenshotManager.captureImage(
                contentFilter: filter, configuration: configuration)
            guard
                let jpegData = NSBitmapImageRep(cgImage: image).representation(
                    using: .jpeg, properties: [.compressionFactor: 0.8])
            else {
                continue
            }

            captures.append(
                CapturedDisplay(
                    screenIndex: index,
                    displayId: display.displayID,
                    x: displayFrame.origin.x,
                    y: displayFrame.origin.y,
                    width: displayFrame.width,
                    height: displayFrame.height,
                    label: captureLabel(
                        index: index, count: sortedDisplays.count, isCursorScreen: isCursorScreen),
                    isCursorScreen: isCursorScreen,
                    screenshotWidthInPixels: configuration.width,
                    screenshotHeightInPixels: configuration.height,
                    mediaType: "image/jpeg",
                    data: jpegData.base64EncodedString()
                ))
        }

        try writeJSON(captures)
        return
    }

    try fallbackCaptureDisplays()
}

final class KeyboardHook {
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var isShortcutPressed = false

    func start() {
        let eventTypes: [CGEventType] = [.flagsChanged, .keyDown, .keyUp]
        let eventMask = eventTypes.reduce(CGEventMask(0)) { mask, eventType in
            mask | (CGEventMask(1) << eventType.rawValue)
        }
        let callback: CGEventTapCallBack = { _, eventType, event, userInfo in
            guard let userInfo else { return Unmanaged.passUnretained(event) }
            let hook = Unmanaged<KeyboardHook>.fromOpaque(userInfo).takeUnretainedValue()
            hook.handle(eventType: eventType, event: event)
            return Unmanaged.passUnretained(event)
        }

        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap,
                place: .headInsertEventTap,
                options: .listenOnly,
                eventsOfInterest: eventMask,
                callback: callback,
                userInfo: Unmanaged.passUnretained(self).toOpaque()
            )
        else {
            fputs("Failed to create macOS keyboard event tap.\n", stderr)
            exit(3)
        }

        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap)
            fputs("Failed to create macOS keyboard event tap source.\n", stderr)
            exit(3)
        }

        eventTap = tap
        runLoopSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        FileHandle.standardOutput.write(Data("READY\n".utf8))
        fflush(stdout)
        CFRunLoopRun()
    }

    private func handle(eventType: CGEventType, event: CGEvent) {
        if eventType == .tapDisabledByTimeout || eventType == .tapDisabledByUserInput {
            if let eventTap {
                CGEvent.tapEnable(tap: eventTap, enable: true)
            }
            return
        }

        guard eventType == .flagsChanged else {
            return
        }

        let modifierFlags = NSEvent.ModifierFlags(rawValue: UInt(event.flags.rawValue))
            .intersection(.deviceIndependentFlagsMask)
        let isShortcutCurrentlyPressed = modifierFlags.contains([.control, .option])

        if isShortcutCurrentlyPressed && !isShortcutPressed {
            isShortcutPressed = true
            FileHandle.standardOutput.write(Data("SHORTCUT_DOWN\n".utf8))
            fflush(stdout)
            return
        }

        if !isShortcutCurrentlyPressed && isShortcutPressed {
            isShortcutPressed = false
            FileHandle.standardOutput.write(Data("SHORTCUT_UP\n".utf8))
            fflush(stdout)
        }
    }
}

let command = CommandLine.arguments.dropFirst().first ?? "--help"

do {
    switch command {
    case "--permissions":
        try writeJSON(permissionSnapshot())
    case "--request-microphone":
        requestMicrophone()
        try writeJSON(permissionSnapshot())
    case "--request-accessibility":
        try writeJSON(permissionSnapshot(promptAccessibility: true))
    case "--request-screen":
        try writeJSON(permissionSnapshot(promptScreen: true))
    case "--capture-screens":
        try await captureDisplays()
    case "--keyboard-hook":
        KeyboardHook().start()
    default:
        print(
            "Usage: piksy-native-helper --permissions|--request-microphone|--request-accessibility|--request-screen|--capture-screens|--keyboard-hook"
        )
    }
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}
