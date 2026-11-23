import UIKit
import Capacitor
import WebKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // Dotinout indigo (#4F46E5) behind the first frame, so the app never shows a white or black screen.
        window?.backgroundColor = UIColor(red: 79/255.0, green: 70/255.0, blue: 229/255.0, alpha: 1)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // WKWebView writes cookies to storage asynchronously, so a sign-in cookie can be lost if iOS suspends or ends the
        // app right after it goes to the background. Asking the cookie store for its cookies forces a round trip to the web
        // process, and a short background task lets that finish before the app is suspended. This is best effort: it must
        // be verified on a device (force-close and reopen).
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "dio-cookie-flush") {
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { _ in
            UIApplication.shared.endBackgroundTask(task)
            task = .invalid
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
