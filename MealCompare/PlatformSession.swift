import Foundation
import WebKit
import Combine

@MainActor
final class PlatformSession: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let platform: DeliveryPlatform
    let webView: WKWebView
    lazy var shopping = ShoppingAutomation(webView: webView, platform: platform)
    @Published var status = "尚未打开平台"
    @Published var isLoading = false
    @Published var isInspecting = false
    @Published var isSearching = false
    @Published var probe: PageProbe?
    @Published var inspectedAt: Date?
    @Published private(set) var startupCookies: CookieSummary?
    @Published private(set) var currentCookies: CookieSummary?
    @Published private(set) var searchAttempt: SearchAttempt?
    @Published var notes: ValidationNotes {
        didSet { saveNotes() }
    }
    private var pendingSearch: (query: String, id: UUID)?
    private var pendingSearchNavigation: WKNavigation?
    private var searchTask: Task<Void, Never>?
    private var activeSearchID = UUID()
    private var currentNavigationID = UUID()
    private var probeScript: String?
    private var startupCheck: Task<Void, Never>?
    private var loadGeneration = UUID()

    var captureState: String {
        if shopping.isRunning { return "shopping" }
        if isSearching { return "searching" }
        if webView.url == nil { return "not-open" }
        if isLoading || webView.isLoading { return "loading" }
        if isInspecting { return "inspecting" }
        return probe == nil ? "unavailable" : "captured"
    }

    init(platform: DeliveryPlatform) {
        self.platform = platform
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: platform.profileID)
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: config)
        if let data = UserDefaults.standard.data(forKey: "validation.\(platform.rawValue)"),
           let value = try? JSONDecoder().decode(ValidationNotes.self, from: data) {
            notes = value
        } else {
            notes = ValidationNotes()
        }
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        if let url = Bundle.main.url(forResource: "Probe", withExtension: "js") {
            probeScript = try? String(contentsOf: url, encoding: .utf8)
        }
        // Measure WebKit's existing store before any platform page gets a chance to change it.
        startupCheck = Task { [weak self] in
            guard let self else { return }
            self.startupCookies = await self.cookieSummary()
        }
    }

    private func saveNotes() {
        if let data = try? JSONEncoder().encode(notes) {
            UserDefaults.standard.set(data, forKey: "validation.\(platform.rawValue)")
        }
    }

    func openHome() {
        cancelSearch()
        status = "正在打开官方网页"
        isLoading = true
        loadAfterStartupCheck(platform.homeURL)
    }

    private func loadAfterStartupCheck(_ url: URL, searchID: UUID? = nil) {
        let generation = UUID()
        loadGeneration = generation
        Task {
            await startupCheck?.value
            guard generation == loadGeneration else { return }
            let navigation = webView.load(URLRequest(url: url))
            if let searchID, searchID == activeSearchID {
                pendingSearchNavigation = navigation
            }
        }
    }

    private func cancelSearch() {
        shopping.cancel()
        activeSearchID = UUID()
        searchTask?.cancel()
        searchTask = nil
        pendingSearch = nil
        pendingSearchNavigation = nil
        loadGeneration = UUID()
        isSearching = false
    }

    func goBack() {
        cancelSearch()
        status = "正在返回上一页"
        webView.goBack()
    }

    func reload() {
        cancelSearch()
        status = "正在重新载入网页"
        webView.reload()
    }

    private func cookieSummary() async -> CookieSummary {
        await withCheckedContinuation { continuation in
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                let sessionOnly = cookies.filter(\.isSessionOnly).count
                continuation.resume(returning: CookieSummary(
                    measuredAt: Date(), total: cookies.count,
                    sessionOnly: sessionOnly, persistent: cookies.count - sessionOnly))
            }
        }
    }

    func openIfNeeded() {
        if webView.url == nil && !isLoading && !webView.isLoading { openHome() }
    }

    func startShopping(productName: String, quantity: Int, preferredOptions: [String],
                       budgetCents: Int, maxExtraQuantity: Int, allowedExtraNames: [String]) {
        cancelSearch()
        probe = nil
        inspectedAt = nil
        shopping.start(productName: productName, quantity: quantity, preferredOptions: preferredOptions,
                       budgetCents: budgetCents, maxExtraQuantity: maxExtraQuantity,
                       allowedExtraNames: allowedExtraNames)
    }

    func search(_ query: String) {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, query.count <= 100 else {
            status = "请填写 1–100 字的商品名称"
            return
        }
        cancelSearch()
        currentNavigationID = UUID()
        probe = nil
        inspectedAt = nil
        pendingSearch = (query: query, id: activeSearchID)
        searchAttempt = SearchAttempt(status: "opening", updatedAt: Date())
        status = "正在进入商品搜索页"
        isLoading = true
        isSearching = true
        loadAfterStartupCheck(platform.searchURL, searchID: activeSearchID)
    }

    private func performSearch(_ query: String, id: UUID) {
        let navigationID = currentNavigationID
        searchTask = Task {
            defer {
                if id == activeSearchID { isSearching = false }
            }
            do {
                // A finished navigation may still be rendering its search form.
                for attempt in 0..<12 {
                    guard !Task.isCancelled, id == activeSearchID,
                          navigationID == currentNavigationID else { return }
                    var outcome: SearchOutcome = try await runScript(action: "search", query: query)
                    guard !Task.isCancelled, id == activeSearchID,
                          navigationID == currentNavigationID else { return }
                    if outcome.status == "waiting", attempt < 11 {
                        try await Task.sleep(nanoseconds: 350_000_000)
                        continue
                    }
                    if outcome.status == "prepared" {
                        // The cancellable native task owns this wait; no click timer survives Back/Home.
                        try await Task.sleep(nanoseconds: 150_000_000)
                        guard !Task.isCancelled, id == activeSearchID,
                              navigationID == currentNavigationID else { return }
                        outcome = try await runScript(action: "submit-search", query: query)
                        guard !Task.isCancelled, id == activeSearchID else { return }
                    }
                    searchAttempt = SearchAttempt(status: outcome.status, updatedAt: Date())
                    if navigationID == currentNavigationID { status = outcome.message }
                    return
                }
            } catch is CancellationError {
                return
            } catch {
                guard id == activeSearchID, navigationID == currentNavigationID else { return }
                searchAttempt = SearchAttempt(status: "failed", updatedAt: Date())
                status = "尚未完成自动搜索，请待网页稳定后重试。\(error.localizedDescription)"
            }
        }
    }

    func inspect() {
        Task { _ = await inspectCurrentPage() }
    }

    @discardableResult
    func inspectCurrentPage() async -> Bool {
        guard !isInspecting, !isSearching, !shopping.isRunning, !isLoading, !webView.isLoading, webView.url != nil else { return false }
        isInspecting = true
        probe = nil
        inspectedAt = nil
        let navigationID = currentNavigationID
        defer { isInspecting = false }
        do {
            let result: PageProbe = try await runScript(action: "inspect")
            let cookies = await cookieSummary()
            guard navigationID == currentNavigationID else { return false }
            currentCookies = cookies
            probe = result
            inspectedAt = Date()
            if result.addressRequired == true {
                status = "平台仍提示选择收货地址；请确认地址后重新检测，当前金额不能用于同地址比价"
            } else {
                status = result.checkoutLikely
                    ? "检测到可能的结算页面；请核对餐品、地址、优惠和金额"
                    : "页面检测完成，可以继续登录、搜索或进入结算页"
            }
            return true
        } catch {
            guard navigationID == currentNavigationID else { return false }
            status = "暂未读到页面信息，可稍后再次检测。\(error.localizedDescription)"
            return false
        }
    }

    private func runScript<T: Decodable>(action: String, query: String = "") async throws -> T {
        guard let probeScript else { throw SessionError.missingScript }
        guard let scheme = webView.url?.scheme, ["https", "http"].contains(scheme) else {
            throw SessionError.noWebpage
        }
        let data = try JSONSerialization.data(withJSONObject: ["action": action, "query": query])
        let request = String(decoding: data, as: UTF8.self)
        let code = probeScript.replacingOccurrences(of: "__MEAL_COMPARE_REQUEST__", with: request)
        let result = try await webView.evaluateJavaScript(code)
        guard let json = result as? String, let resultData = json.data(using: .utf8) else {
            throw SessionError.invalidResult
        }
        return try JSONDecoder().decode(T.self, from: resultData)
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if let expected = pendingSearchNavigation, navigation !== expected { cancelSearch() }
        currentNavigationID = UUID()
        isLoading = true
        probe = nil
        inspectedAt = nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isLoading = false
        let navigationID = currentNavigationID
        Task {
            // Give client-rendered pages a chance to insert their first controls.
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard navigationID == currentNavigationID else { return }
            if let pending = pendingSearch {
                guard pending.id == activeSearchID, let expected = pendingSearchNavigation,
                      navigation === expected else { return }
                pendingSearch = nil
                pendingSearchNavigation = nil
                performSearch(pending.query, id: pending.id)
            } else if !isSearching && !shopping.isRunning {
                inspect()
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail(error)
    }

    private func fail(_ error: Error) {
        // A replaced navigation must not erase the next navigation's queued query.
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        isLoading = false
        cancelSearch()
        searchAttempt = SearchAttempt(status: "failed", updatedAt: Date())
        status = "网页未能加载：\(error.localizedDescription)"
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        currentNavigationID = UUID()
        cancelSearch()
        isLoading = false
        probe = nil
        inspectedAt = nil
        status = "网页进程已结束，请重新载入"
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if ["https", "http", "about"].contains(url.scheme ?? "") {
            decisionHandler(.allow)
        } else {
            status = "网页要求打开外部 App（\(url.scheme ?? "未知")）。此步骤的本机网页流程尚未通过验证。"
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil,
           let scheme = navigationAction.request.url?.scheme,
           ["https", "http"].contains(scheme) {
            cancelSearch()
            webView.load(navigationAction.request)
        }
        return nil
    }
}

private enum SessionError: LocalizedError {
    case missingScript, noWebpage, invalidResult
    var errorDescription: String? {
        switch self {
        case .missingScript: return "页面检测资源缺失。"
        case .noWebpage: return "请先打开平台网页。"
        case .invalidResult: return "网页没有返回可识别的检测结果。"
        }
    }
}
