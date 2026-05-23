import AppKit
import AVFoundation
import Combine
import SwiftUI

// MARK: - Window

private final class GlideDynamicIslandWindow: NSPanel {
    override init(contentRect: NSRect, styleMask: NSWindow.StyleMask, backing: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: styleMask, backing: backing, defer: flag)
        isFloatingPanel = true
        isOpaque = false
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        backgroundColor = .clear
        isMovable = false
        collectionBehavior = [.fullScreenAuxiliary, .stationary, .canJoinAllSpaces, .ignoresCycle]
        isReleasedWhenClosed = false
        level = .mainMenu + 3
        hasShadow = false
        isExcludedFromWindowsMenu = true
        hidesOnDeactivate = false
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - Notch Shape

private struct GlideNotchShape: Shape {
    var topRadius: CGFloat = 8
    var bottomRadius: CGFloat = 20

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { .init(topRadius, bottomRadius) }
        set { topRadius = newValue.first; bottomRadius = newValue.second }
    }

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.minY))
        p.addQuadCurve(
            to: CGPoint(x: rect.minX + topRadius, y: rect.minY + topRadius),
            control: CGPoint(x: rect.minX + topRadius, y: rect.minY)
        )
        p.addLine(to: CGPoint(x: rect.minX + topRadius, y: rect.maxY - bottomRadius))
        p.addQuadCurve(
            to: CGPoint(x: rect.minX + topRadius + bottomRadius, y: rect.maxY),
            control: CGPoint(x: rect.minX + topRadius, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.maxX - topRadius - bottomRadius, y: rect.maxY))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX - topRadius, y: rect.maxY - bottomRadius),
            control: CGPoint(x: rect.maxX - topRadius, y: rect.maxY)
        )
        p.addLine(to: CGPoint(x: rect.maxX - topRadius, y: rect.minY + topRadius))
        p.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY),
            control: CGPoint(x: rect.maxX - topRadius, y: rect.minY)
        )
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        return p
    }
}


@MainActor
final class GlideDynamicIslandManager {
    private var window: NSPanel?
    private let companionManager: CompanionManager
    private var cancellable: AnyCancellable?

    // The window is sized to the largest possible notch (expanded state).
    // The inner SwiftUI content animates between the collapsed and expanded
    // widths; the outer window stays this fixed size so we don't have to
    // resize the NSPanel on hover.
    private static let containerSize = CGSize(width: 440, height: 310)

    init(companionManager: CompanionManager) {
        self.companionManager = companionManager

        // Match the Electron notch: if voice activity starts while the island
        // is hidden, bring it back so Listening / Thinking is visible.
        cancellable = companionManager.$voiceState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] voiceState in
                guard voiceState != .idle else { return }
                self?.show(expanded: false)
            }
    }

    func toggle() {
        if let window, window.isVisible { hide() } else { show(expanded: false) }
    }

    /// Shows the island. It stays visible like the Electron notch indicator.
    func show(expanded: Bool = false) {
        if window == nil { createWindow() }
        window?.setFrame(Self.frame(for: Self.containerSize), display: true, animate: false)
        window?.orderFrontRegardless()
    }

    func hide() { window?.orderOut(nil) }

    private func createWindow() {
        let view = GlideIslandRoot(companionManager: companionManager)
        let hostingView = NSHostingView(rootView: view)
        hostingView.frame = NSRect(origin: .zero, size: Self.containerSize)
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = .clear

        let panel = GlideDynamicIslandWindow(
            contentRect: Self.frame(for: Self.containerSize),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        panel.contentView = hostingView
        window = panel
    }

    private static func frame(for size: CGSize) -> NSRect {
        let screen = NSScreen.main ?? NSScreen.screens.first
        let frame = screen?.frame ?? .zero
        return NSRect(x: frame.midX - size.width / 2, y: frame.maxY - size.height, width: size.width, height: size.height)
    }
}

// MARK: - Root View

private struct GlideIslandRoot: View {
    @ObservedObject var companionManager: CompanionManager
    @State private var isOpen = false
    @State private var hoverCloseTask: Task<Void, Never>?

    // The notch widens horizontally on hover so there's more room for the
    // header / permissions / ready content to breathe. The hosting NSPanel
    // stays a fixed (wider) size so the SwiftUI animation can run inside
    // it without resizing the window.
    private static let collapsedNotchWidth: CGFloat = 340
    private static let expandedNotchWidth: CGFloat = 440
    private static let containerHeight: CGFloat = 310

    private var isActive: Bool {
        companionManager.voiceState != .idle
    }

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 0) {
                if isOpen {
                    expandedBody
                } else {
                    collapsedBar
                }
            }
            .frame(width: isOpen ? Self.expandedNotchWidth : Self.collapsedNotchWidth)
            .background(.black)
            .clipShape(GlideNotchShape(topRadius: 8, bottomRadius: isOpen ? 22 : 14))
            .contentShape(GlideNotchShape(topRadius: 8, bottomRadius: isOpen ? 22 : 14))
            .onHover { hovering in
                hoverCloseTask?.cancel()
                if hovering {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                        isOpen = true
                    }
                } else {
                    hoverCloseTask = Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        guard !Task.isCancelled else { return }
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.9)) {
                            isOpen = false
                        }
                    }
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isOpen)
            .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isActive)

            Spacer(minLength: 0)
        }
        .frame(width: Self.expandedNotchWidth, height: Self.containerHeight, alignment: .top)
        .allowsHitTesting(true)
    }

    // MARK: - Collapsed (notch bar showing state)

    private var collapsedBar: some View {
        HStack(spacing: 0) {
            if isActive {
                Text(stateLabel)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(1)
                    .transition(.opacity.combined(with: .move(edge: .leading)))

                Spacer(minLength: 0)

                activeStateBars
                    .transition(.opacity.combined(with: .scale))
            } else {
                Spacer(minLength: 0)
                Circle()
                    .stroke(.white.opacity(0.3), lineWidth: 1.5)
                    .frame(width: 7, height: 7)
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 18)
        .frame(maxWidth: .infinity)
        .frame(height: 36)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: companionManager.voiceState)
    }

    private var activeStateBars: some View {
        HStack(spacing: 2) {
            ForEach(0..<4, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1, style: .continuous)
                    .fill(stateColor.opacity(0.7))
                    .frame(width: 2, height: stateBarHeight(at: index))
            }
        }
    }

    // MARK: - Expanded

    private var expandedBody: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                HStack(spacing: 6) {
                    stateIcon
                    Text(stateLabel)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.6))
                }
                Spacer()
                Text("Glide")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
            }
            .padding(.horizontal, 18)
            .frame(height: 32)

            // Content
            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 0) {
                    if !companionManager.allPermissionsGranted || !companionManager.hasInputMonitoringPermission {
                        permissionsView
                    } else if !companionManager.hasCompletedOnboarding {
                        onboardingView
                    } else {
                        readyView
                    }
                }
                .padding(.horizontal, 14)
                .padding(.top, 6)
                .padding(.bottom, 16)
            }
        }
    }

    // MARK: - State

    @ViewBuilder
    private var stateIcon: some View {
        switch companionManager.voiceState {
        case .idle:
            Image(systemName: "circle")
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(.white.opacity(0.3))
        case .listening:
            Image(systemName: "waveform")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.green.opacity(0.9))
                .symbolEffect(.variableColor.iterative, isActive: true)
        case .processing:
            Image(systemName: "ellipsis")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(DS.Colors.pink300.opacity(0.8))
                .symbolEffect(.pulse, isActive: true)
        case .responding:
            Image(systemName: "speaker.wave.2")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.purple.opacity(0.8))
                .symbolEffect(.variableColor.iterative, isActive: true)
        }
    }

    private var stateLabel: String {
        switch companionManager.voiceState {
        case .idle: "Idle"
        case .listening: "Listening"
        case .processing: "Thinking"
        case .responding: "Speaking"
        }
    }

    private var stateColor: Color {
        switch companionManager.voiceState {
        case .idle: .white.opacity(0.3)
        case .listening: .green.opacity(0.9)
        case .processing: DS.Colors.pink300.opacity(0.9)
        case .responding: .purple.opacity(0.9)
        }
    }

    private func stateBarHeight(at index: Int) -> CGFloat {
        switch companionManager.voiceState {
        case .listening:
            let profile: [CGFloat] = [4, 8, 10, 6]
            return profile[index] + companionManager.currentAudioPowerLevel * 4
        case .processing:
            let profile: [CGFloat] = [3, 6, 8, 5]
            return profile[index]
        case .responding:
            let profile: [CGFloat] = [5, 8, 6, 9]
            return profile[index]
        case .idle:
            return 3
        }
    }

    // MARK: - Permissions

    private var permissionsView: some View {
        VStack(spacing: 0) {
            perm("mic.fill", "Microphone", companionManager.hasMicrophonePermission) {
                AVCaptureDevice.requestAccess(for: .audio) { _ in }
            }
            perm("hand.raised.fill", "Accessibility", companionManager.hasAccessibilityPermission) {
                WindowPositionManager.requestAccessibilityPermission()
            }
            perm("record.circle", "Screen Recording", companionManager.hasScreenRecordingPermission) {
                WindowPositionManager.requestScreenRecordingPermission()
            }
            perm("rectangle.dashed", "Screen Content", companionManager.hasScreenContentPermission, disabled: !companionManager.hasScreenRecordingPermission) {
                companionManager.requestScreenContentPermission()
            }
            perm("command", "Keyboard Shortcut", companionManager.hasInputMonitoringPermission) {
                if #available(macOS 10.15, *) { _ = CGRequestListenEventAccess() }
                companionManager.globalPushToTalkShortcutMonitor.start()
            }
        }
    }

    private func perm(_ sfIcon: String, _ title: String, _ granted: Bool, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        HStack(spacing: 10) {
            Image(systemName: granted ? "checkmark.circle.fill" : sfIcon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(granted ? .green : DS.Colors.pink300.opacity(0.7))
                .frame(width: 16)

            Text(title)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundStyle(.white.opacity(disabled ? 0.25 : 0.8))

            Spacer()

            if !granted {
                Button(action: action) {
                    Text("Grant")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Capsule(style: .continuous).fill(.white.opacity(0.1)))
                }
                .buttonStyle(.plain)
                .disabled(disabled)
                .opacity(disabled ? 0.35 : 1)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Onboarding

    private var onboardingView: some View {
        Button("Start Onboarding") { companionManager.triggerOnboarding() }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(.white.opacity(0.9))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(Capsule(style: .continuous).fill(DS.Colors.pink400.opacity(0.2)))
            .buttonStyle(.plain)
    }

    // MARK: - Ready

    private var readyView: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "command")
                    .font(.system(size: 10))
                    .foregroundStyle(DS.Colors.pink300.opacity(0.6))
                Text("Hold ⌃⌥ to talk")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.7))
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            HStack {
                Text("Glide cursor")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.8))
                Spacer()
                Toggle("", isOn: Binding(
                    get: { companionManager.isGlideCursorEnabled },
                    set: { companionManager.setGlideCursorEnabled($0) }
                ))
                .toggleStyle(.switch)
                .tint(DS.Colors.pink400)
                .scaleEffect(0.75)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Button("Replay Onboarding") { companionManager.replayOnboarding() }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.3))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .buttonStyle(.plain)
        }
    }
}
