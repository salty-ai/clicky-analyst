import AVFoundation
import AppKit
import CoreGraphics
import Foundation
import QuartzCore
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
        domain: "GlideNativeHelper.ScreenCapture",
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

private let notchClosedWidth: CGFloat = 340
private let notchClosedHeight: CGFloat = 36
private let notchActiveWidth: CGFloat = 340
private let notchActiveHeight: CGFloat = 310
private let notchWindowPadding: CGFloat = 0
private let notchVerticalShadowPadding: CGFloat = 0

final class NotchIslandView: NSView {
    override var isFlipped: Bool { true }

    private var statusText = "⌥⌘"
    private var voiceState = "idle"
    private var isVisible = false
    private var isExpanded = false
    private var trackingAreaRef: NSTrackingArea?
    private var animationPhase: CGFloat = 0
    private var displayTimer: Timer?
    var onMouseEnter: (() -> Void)?
    var onMouseExit: (() -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        alphaValue = 0
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingAreaRef { removeTrackingArea(trackingAreaRef) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil)
        addTrackingArea(area)
        trackingAreaRef = area
    }

    override func mouseEntered(with event: NSEvent) { onMouseEnter?() }
    override func mouseExited(with event: NSEvent) { onMouseExit?() }

    private func notchPath(in rect: CGRect) -> CGPath {
        // Port of Atoll's NotchShape: tiny top ears + generous bottom radii.
        let top: CGFloat = 6
        let bottom: CGFloat = isExpanded ? 22 : 14
        let path = CGMutablePath()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.minX + top, y: rect.minY + top), control: CGPoint(x: rect.minX + top, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.minX + top, y: rect.maxY - bottom))
        path.addQuadCurve(to: CGPoint(x: rect.minX + top + bottom, y: rect.maxY), control: CGPoint(x: rect.minX + top, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX - top - bottom, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - top, y: rect.maxY - bottom), control: CGPoint(x: rect.maxX - top, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.maxX - top, y: rect.minY + top))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY), control: CGPoint(x: rect.maxX - top, y: rect.minY))
        path.closeSubpath()
        return path
    }

    private var accentColor: NSColor {
        switch voiceState {
        case "listening": return NSColor(calibratedRed: 0.20, green: 0.84, blue: 0.52, alpha: 1)
        case "processing": return NSColor(calibratedRed: 0.45, green: 0.60, blue: 1.0, alpha: 1)
        case "responding": return NSColor(calibratedRed: 1.0, green: 0.55, blue: 0.72, alpha: 1)
        default: return NSColor(calibratedWhite: 1, alpha: 0.32)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard isVisible, let context = NSGraphicsContext.current?.cgContext else { return }
        let rect = bounds.insetBy(dx: notchWindowPadding / 2, dy: 0)
            .offsetBy(dx: 0, dy: -notchVerticalShadowPadding)
        let path = notchPath(in: rect)

        context.saveGState()
        context.addPath(path)
        context.clip()
        let surface = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
            NSColor(calibratedWhite: 0.018, alpha: 1).cgColor,
            NSColor(calibratedWhite: 0.000, alpha: 1).cgColor,
            NSColor(calibratedRed: 0.035, green: 0.032, blue: 0.038, alpha: 1).cgColor
        ] as CFArray, locations: [0, 0.55, 1])!
        context.drawLinearGradient(surface, start: CGPoint(x: rect.midX, y: rect.minY), end: CGPoint(x: rect.midX, y: rect.maxY), options: [])

        context.restoreGState()

        drawContents(in: rect)
    }

    private func drawContents(in rect: CGRect) {
        let active = voiceState != "idle"
        let label = statusText.isEmpty ? fallbackLabel() : statusText
        if !active {
            drawIdleDot(at: CGPoint(x: rect.minX + 158, y: rect.midY))
        }

        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        paragraph.alignment = isExpanded || active ? .left : .center
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: isExpanded ? 12 : 11, weight: .medium),
            .foregroundColor: NSColor.white.withAlphaComponent(isExpanded ? 0.60 : active ? 0.70 : 0.30),
            .kern: -0.15,
            .paragraphStyle: paragraph
        ]

        if isExpanded {
            (label as NSString).draw(in: NSRect(x: rect.minX + 18, y: 9, width: 180, height: 18), withAttributes: attributes)
            ("Glide" as NSString).draw(in: NSRect(x: rect.maxX - 58, y: 9, width: 42, height: 18), withAttributes: [
                .font: NSFont.systemFont(ofSize: 12, weight: .medium),
                .foregroundColor: NSColor.white.withAlphaComponent(0.50),
                .kern: -0.15
            ])
            drawExpandedRows(in: rect)
            return
        }

        if active {
            (label as NSString).draw(in: NSRect(x: rect.minX + 18, y: rect.midY - 8, width: 170, height: 18), withAttributes: attributes)
            drawWaveform(at: CGPoint(x: rect.maxX - 38, y: rect.midY))
        }
    }

    private func drawIdleDot(at point: CGPoint) {
        NSColor.white.withAlphaComponent(0.30).setFill()
        NSBezierPath(ovalIn: NSRect(x: point.x - 3, y: point.y - 3, width: 6, height: 6)).fill()
    }

    private func drawWaveform(at point: CGPoint) {
        for index in 0..<5 {
            let wave = sin(animationPhase + CGFloat(index) * 0.85)
            let h = CGFloat(4 + max(0, wave) * 9)
            let bar = NSBezierPath(roundedRect: NSRect(x: point.x + CGFloat(index * 5), y: point.y - h / 2, width: 2.5, height: h), xRadius: 1.25, yRadius: 1.25)
            accentColor.withAlphaComponent(0.62 + max(0, wave) * 0.30).setFill()
            bar.fill()
        }
    }

    private func drawExpandedRows(in rect: CGRect) {
        let rows = ["Hold ⌃⌥ to talk", "Glide cursor", "Replay Onboarding"]
        let icons = ["⌘", "⌁", "↺"]
        for index in 0..<rows.count {
            let y = rect.minY + 56 + CGFloat(index * 42)
            (icons[index] as NSString).draw(in: NSRect(x: rect.minX + 26, y: y, width: 18, height: 18), withAttributes: [
                .font: NSFont.systemFont(ofSize: 12, weight: .medium),
                .foregroundColor: NSColor(calibratedRed: 1.0, green: 0.55, blue: 0.72, alpha: index == 2 ? 0.28 : 0.60)
            ])
            (rows[index] as NSString).draw(in: NSRect(x: rect.minX + 48, y: y, width: 220, height: 18), withAttributes: [
                .font: NSFont.systemFont(ofSize: 12.5, weight: .medium),
                .foregroundColor: NSColor.white.withAlphaComponent(index == 2 ? 0.30 : 0.72),
                .kern: -0.15
            ])
        }
    }

    func setExpanded(_ expanded: Bool) { isExpanded = expanded; updateDisplayTimer(); needsDisplay = true }

    func setVisible(_ visible: Bool, animated: Bool = true) {
        isVisible = visible
        updateDisplayTimer()
        needsDisplay = true
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = visible ? 0.22 : 0.16
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0.9, 0.2, 1.0)
                self.animator().alphaValue = visible ? 1 : 0
            }
        } else { alphaValue = visible ? 1 : 0 }
    }

    func updateStatus(_ text: String) { statusText = text.isEmpty ? fallbackLabel() : text; needsDisplay = true }
    func updateVoiceState(_ voiceState: String) { self.voiceState = voiceState; statusText = fallbackLabel(); updateDisplayTimer(); needsDisplay = true }

    private func updateDisplayTimer() {
        let shouldAnimate = isVisible && (voiceState != "idle" || isExpanded)
        if shouldAnimate && displayTimer == nil {
            displayTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.animationPhase += 0.22
                self.needsDisplay = true
            }
        } else if !shouldAnimate {
            displayTimer?.invalidate()
            displayTimer = nil
        }
    }

    private func fallbackLabel() -> String {
        switch voiceState {
        case "listening": return "Listening"
        case "processing": return "Thinking"
        case "responding": return "Responding"
        default: return "⌥⌘"
        }
    }
}

final class NotchIslandController {
    private var window: NSPanel?
    private var islandView: NotchIslandView?
    private var isActive = false
    private var collapseWorkItem: DispatchWorkItem?
    private var isHovering = false

    func mount() {
        if window == nil { createWindow() }
        setWindowSize(width: notchClosedWidth + notchWindowPadding, height: notchClosedHeight + notchVerticalShadowPadding, animated: false)
        window?.orderFrontRegardless()
        islandView?.setVisible(false, animated: false)
    }

    func show(hover: Bool = false) {
        if window == nil { createWindow() }
        islandView?.setExpanded(hover)
        setWindowSize(width: (hover ? notchActiveWidth : notchClosedWidth) + notchWindowPadding, height: (hover ? notchActiveHeight : notchClosedHeight) + notchVerticalShadowPadding, animated: true)
        window?.orderFrontRegardless()
        islandView?.setVisible(true, animated: true)
    }

    func hide() {
        isActive = false
        collapseWorkItem?.cancel()
        collapseWorkItem = nil
        isHovering = false
        islandView?.setExpanded(false)
        setWindowSize(width: notchClosedWidth + notchWindowPadding, height: notchClosedHeight + notchVerticalShadowPadding, animated: true)
        islandView?.setVisible(true, animated: true)
        if window == nil { mount() }
    }

    func updateStatus(_ text: String) {
        if window == nil {
            createWindow()
        }
        islandView?.updateStatus(text)
    }

    func updateVoiceState(_ voiceState: String) {
        if window == nil { createWindow() }
        islandView?.updateVoiceState(voiceState)
        if voiceState == "idle" {
            isActive = false
            show(hover: isHovering)
            return
        }
        isActive = true
        show(hover: isHovering)
    }

    func setIgnoreMouse(_ ignore: Bool) {
        window?.ignoresMouseEvents = ignore
    }

    private func createWindow() {
        let width: CGFloat = notchClosedWidth + notchWindowPadding
        let height: CGFloat = notchClosedHeight + notchVerticalShadowPadding
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.ignoresMouseEvents = false

        let view = NotchIslandView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        view.onMouseEnter = { [weak self] in
            guard let self else { return }
            self.collapseWorkItem?.cancel()
            self.isHovering = true
            self.show(hover: true)
        }
        view.onMouseExit = { [weak self] in
            guard let self else { return }
            let item = DispatchWorkItem { [weak self] in
                guard let self else { return }
                self.isHovering = false
                guard !self.isActive else {
                    self.show(hover: false)
                    return
                }
                self.islandView?.setExpanded(false)
                self.setWindowSize(width: notchClosedWidth + notchWindowPadding, height: notchClosedHeight + notchVerticalShadowPadding, animated: true)
                self.islandView?.setVisible(false, animated: true)
            }
            self.collapseWorkItem = item
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: item)
        }
        view.autoresizingMask = [.width, .height]
        panel.contentView = view
        islandView = view
        window = panel
        positionWindow()
    }

    private func positionWindow() {
        guard let window, let screen = NSScreen.main else { return }
        let frame = screen.frame
        let width = window.frame.width
        let height = window.frame.height
        let x = frame.midX - width / 2
        let y = frame.maxY - height
        window.setFrameOrigin(NSPoint(x: x, y: y))
    }

    private func frameFor(width: CGFloat, height: CGFloat) -> NSRect {
        guard let screen = NSScreen.main else { return NSRect(x: 0, y: 0, width: width, height: height) }
        let screenFrame = screen.frame
        return NSRect(x: screenFrame.midX - width / 2, y: screenFrame.maxY - height, width: width, height: height)
    }

    private func setWindowSize(width: CGFloat, height: CGFloat, animated: Bool) {
        guard let window else { return }
        let target = frameFor(width: width, height: height)
        if animated {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = height > notchClosedHeight ? 0.35 : 0.30
                context.timingFunction = CAMediaTimingFunction(controlPoints: 0.25, 1.0, 0.5, 1.0)
                window.animator().setFrame(target, display: true)
            }
        } else {
            window.setFrame(target, display: true)
        }
    }
}

func runNotchIsland() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let controller = NotchIslandController()

    DispatchQueue.global(qos: .userInitiated).async {
        while let line = readLine() {
            guard let data = line.data(using: .utf8),
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let type = json["type"] as? String
            else { continue }

            DispatchQueue.main.async {
                switch type {
                case "mount":
                    controller.mount()
                case "show":
                    controller.show()
                case "hide", "close":
                    controller.hide()
                case "status":
                    let text = json["text"] as? String ?? ""
                    controller.updateStatus(text)
                    if !text.isEmpty { controller.show() }
                case "voiceState":
                    controller.updateVoiceState(json["voiceState"] as? String ?? "idle")
                case "setIgnoreMouse":
                    controller.setIgnoreMouse(json["ignore"] as? Bool ?? true)
                case "quit":
                    app.terminate(nil)
                default:
                    break
                }
            }
        }
    }

    FileHandle.standardOutput.write(Data("READY\n".utf8))
    fflush(stdout)
    app.run()
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
    case "--notch-island":
        runNotchIsland()
    default:
        print(
            "Usage: glide-native-helper --permissions|--request-microphone|--request-accessibility|--request-screen|--capture-screens|--keyboard-hook|--notch-island"
        )
    }
} catch {
    fputs("\(error.localizedDescription)\n", stderr)
    exit(1)
}
