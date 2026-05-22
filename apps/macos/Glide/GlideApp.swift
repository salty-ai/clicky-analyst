import ServiceManagement
import SwiftUI
import Sparkle

@main
struct GlideApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) var appDelegate

    var body: some Scene {
        
        
        
        Settings {
            EmptyView()
        }
    }
}



@MainActor
final class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    private var menuBarPanelManager: MenuBarPanelManager?
    private let companionManager = CompanionManager()
    private var sparkleUpdaterController: SPUStandardUpdaterController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("Glide: Starting...")
        print("Glide: Version \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown")")

        UserDefaults.standard.register(defaults: ["NSInitialToolTipDelay": 0])

        GlideAnalytics.configure()
        GlideAnalytics.trackAppOpened()

        menuBarPanelManager = MenuBarPanelManager(companionManager: companionManager)
        companionManager.start()

        // Keep the notch island visible like the Electron app so the
        // Listening / Thinking / Speaking state is always surfaced.
        menuBarPanelManager?.showPanelOnLaunch()

        registerAsLoginItemIfNeeded()
        
    }

    func applicationWillTerminate(_ notification: Notification) {
        companionManager.stop()
    }

    
    
    
    private func registerAsLoginItemIfNeeded() {
        let loginItemService = SMAppService.mainApp
        if loginItemService.status != .enabled {
            do {
                try loginItemService.register()
                print("Glide: Registered as login item")
            } catch {
                print("Glide: Failed to register as login item: \(error)")
            }
        }
    }

    private func startSparkleUpdater() {
        let updaterController = SPUStandardUpdaterController(
            startingUpdater: false,
            updaterDelegate: nil,
            userDriverDelegate: nil
        )
        self.sparkleUpdaterController = updaterController

        do {
            try updaterController.updater.start()
        } catch {
            print("Glide: Sparkle updater failed to start: \(error)")
        }
    }
}
