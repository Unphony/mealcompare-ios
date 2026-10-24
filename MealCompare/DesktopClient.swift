import SwiftUI
import Security

private struct DesktopCredential: Codable { let endpoint: String; let token: String }
private enum DesktopKeychain {
    static let service = "mealcompare.desktop.pairing"
    static func read() -> DesktopCredential? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecReturnData as String: true]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(DesktopCredential.self, from: data)
    }
    static func write(_ credential: DesktopCredential) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        let data = try JSONEncoder().encode(credential)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw DesktopError("无法保存配对信息") }
        } else if update != errSecSuccess { throw DesktopError("无法更新配对信息") }
    }
    static func clear() { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service] as CFDictionary) }
}
private struct DesktopError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
struct DesktopRecord: Decodable, Identifiable {
    let id: String
    let platform: String
    let observedAt: String
    let totalCents: Int
    let etaText: String
    let note: String
}
struct DesktopJob: Decodable, Identifiable {
    struct Input: Decodable { let platform: String; let kind: String; let query: String }
    let id: String
    let input: Input
    let state: String
    let message: String
    let updatedAt: String
}
struct DesktopHistory: Decodable {
    struct Entry: Decodable {
        struct Item: Decodable { let name: String; let specs: String?; let quantity: Int }
        let storeName: String
        let items: [Item]
    }
    let platform: String
    let entry: Entry
}
struct DesktopStatus: Decodable {
    let version: String
    let jobs: [DesktopJob]
    let records: [DesktopRecord]
    let history: [DesktopHistory]
}
struct DesktopFrame: Decodable {
    let id: String
    let image: String
    let width: Int
    let height: Int
    let origin: String
    var uiImage: UIImage? { Data(base64Encoded: image).flatMap(UIImage.init(data:)) }
}

@MainActor final class DesktopConnection: ObservableObject {
    @Published var endpoint = ""
    @Published var code = ""
    @Published var message = "请先连接电脑"
    @Published private(set) var connected = false
    @Published private(set) var paired = false
    @Published private(set) var busy = false
    @Published private(set) var snapshot: DesktopStatus?
    @Published private(set) var lastSync = ""
    @Published var frame: DesktopFrame?
    @Published private(set) var controlling = false
    private var credential: DesktopCredential?
    private var socket: URLSessionWebSocketTask?
    private var eventTask: Task<Void, Never>?
    private var sessionGeneration = UUID()
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 90
        return URLSession(configuration: configuration)
    }()
    init() {
        credential = DesktopKeychain.read()
        endpoint = credential?.endpoint ?? ""
        paired = credential != nil
        if paired, UserDefaults.standard.string(forKey: "desktopCacheEndpoint") == endpoint,
           let data = UserDefaults.standard.data(forKey: "desktopCache") {
            snapshot = try? JSONDecoder().decode(DesktopStatus.self, from: data)
            lastSync = UserDefaults.standard.string(forKey: "desktopLastSync") ?? ""
        }
    }
    private func base(_ value: String) throws -> URL {
        guard var parts = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme == "https", let host = parts.host, host.hasSuffix(".ts.net"),
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { throw DesktopError("请填写电脑端显示的 https://…ts.net:8443 私人地址") }
        parts.path = ""
        guard let url = parts.url else { throw DesktopError("电脑地址无效") }
        return url
    }
    private func request(_ path: String, body: [String: Any]? = nil, pairing: Bool = false) async throws -> Data {
        let target = try base(pairing ? endpoint : (credential?.endpoint ?? ""))
        var request = URLRequest(url: target.appendingPathComponent(path))
        request.httpMethod = body == nil ? "GET" : "POST"
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if !pairing {
            guard let credential else { throw DesktopError("请先配对电脑") }
            request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let details = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            throw DesktopError(details?["error"] as? String ?? "电脑没有完成请求，请检查配对和网络")
        }
        return data
    }
    func pair() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let data = try await request("v1/pair", body: ["code": code], pairing: true)
            struct PairReply: Decodable { let token: String }
            let reply = try JSONDecoder().decode(PairReply.self, from: data)
            let next = DesktopCredential(endpoint: try base(endpoint).absoluteString, token: reply.token)
            try DesktopKeychain.write(next)
            disconnectEvents(); credential = next; endpoint = next.endpoint; paired = true; code = ""
            snapshot = nil; lastSync = ""; clearCache()
            await refresh(); connectEvents()
        } catch { message = error.localizedDescription }
    }
    func refresh() async {
        guard paired else { return }
        let generation = sessionGeneration
        do {
            let data = try await request("v1/status")
            guard generation == sessionGeneration else { return }
            snapshot = try JSONDecoder().decode(DesktopStatus.self, from: data)
            connected = true; message = "电脑在线"; lastSync = Date().formatted(date: .abbreviated, time: .standard)
            UserDefaults.standard.set(data, forKey: "desktopCache")
            UserDefaults.standard.set(credential?.endpoint, forKey: "desktopCacheEndpoint")
            UserDefaults.standard.set(lastSync, forKey: "desktopLastSync")
        } catch {
            guard generation == sessionGeneration else { return }
            connected = false; message = "未连上电脑：请确认电脑运行、两端 Tailscale 已连接。下方仅显示上次同步记录。"
        }
    }
    func submit(platform: String, kind: String, query: String, budget: String) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        guard let amount = Decimal(string: budget), amount >= 0, amount <= 10000 else { message = "请输入有效预算"; return }
        // One identifier per user submission, never retried as a new job after a lost response.
        let id = UUID().uuidString
        do {
            _ = try await request("v1/jobs", body: ["requestID": id, "platform": platform, "kind": kind,
                "query": query, "budgetCents": NSDecimalNumber(decimal: amount * 100).intValue])
            await refresh()
        } catch { message = error.localizedDescription + "。如已提交，请刷新查看原任务，避免重复操作。" }
    }
    func takeControl(_ platform: String, active: Bool) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            _ = try await request("v1/platforms/\(platform)/takeover", body: ["active": active])
            controlling = active
            if active { try await loadFrame(platform) } else { frame = nil }
        } catch { message = error.localizedDescription }
    }
    private func loadFrame(_ platform: String) async throws {
        let data = try await request("v1/platforms/\(platform)/frame")
        frame = try JSONDecoder().decode(DesktopFrame.self, from: data)
    }
    func refreshFrame(_ platform: String) async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do { try await loadFrame(platform) } catch { message = error.localizedDescription }
    }
    func input(_ platform: String, values: [String: Any]) async {
        guard !busy, controlling, let frame else { return }; busy = true; defer { busy = false }
        var body = values; body["frameID"] = frame.id
        self.frame = nil
        do {
            _ = try await request("v1/platforms/\(platform)/input", body: body)
            try await Task.sleep(for: .milliseconds(400))
            try await loadFrame(platform)
        } catch {
            message = error.localizedDescription
            try? await loadFrame(platform)
        }
    }
    func home(_ platform: String) async {
        guard !busy, controlling else { return }; busy = true; defer { busy = false }
        do { _ = try await request("v1/platforms/\(platform)/home", body: [:]); try await loadFrame(platform) }
        catch { message = error.localizedDescription }
    }
    func connectEvents() {
        guard paired, eventTask == nil else { return }
        eventTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                do {
                    let url = try self.base(self.credential?.endpoint ?? "").appendingPathComponent("v1/events")
                    var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
                    parts.scheme = "wss"
                    var request = URLRequest(url: parts.url!)
                    request.setValue("Bearer " + (self.credential?.token ?? ""), forHTTPHeaderField: "Authorization")
                    let ws = self.session.webSocketTask(with: request); self.socket = ws; ws.resume()
                    while !Task.isCancelled { _ = try await ws.receive(); await self.refresh() }
                } catch {
                    self.socket?.cancel(with: .goingAway, reason: nil)
                    if !Task.isCancelled { await self.refresh(); try? await Task.sleep(for: .seconds(5)) }
                }
            }
        }
    }
    func disconnectEvents() {
        sessionGeneration = UUID(); eventTask?.cancel(); eventTask = nil
        socket?.cancel(with: .goingAway, reason: nil); socket = nil
    }
    func forget() {
        disconnectEvents(); DesktopKeychain.clear(); credential = nil; paired = false; connected = false
        snapshot = nil; frame = nil; controlling = false; clearCache(); message = "已忘记电脑；如需撤销旧手机权限，请在电脑解除配对"
    }
    private func clearCache() { for key in ["desktopCache", "desktopCacheEndpoint", "desktopLastSync"] { UserDefaults.standard.removeObject(forKey: key) } }
}

struct DesktopHomeView: View {
    @StateObject private var connection = DesktopConnection()
    @Environment(\.scenePhase) private var scenePhase
    @State private var platform = "meituan"
    @AppStorage("desktopQuery") private var query = "汉堡王 双层厚鸡堡4件套"
    @AppStorage("desktopBudget") private var budget = "30"
    @State private var remote = false
    @State private var legacy = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(connection.connected ? "电脑在线" : "电脑未连接", systemImage: connection.connected ? "desktopcomputer" : "wifi.slash")
                    Text(connection.message).font(.footnote).foregroundStyle(.secondary)
                    if !connection.lastSync.isEmpty { Text("上次同步：" + connection.lastSync).font(.caption) }
                }
                if !connection.paired {
                    Section("连接电脑") {
                        TextField("https://电脑名.ts.net:8443", text: $connection.endpoint).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        SecureField("电脑显示的 8 位配对码", text: $connection.code).keyboardType(.numberPad)
                        Button("配对电脑") { Task { await connection.pair() } }.disabled(connection.busy)
                        Text("先在电脑打开饭价，并让电脑与 iPhone 登录同一 Tailscale Personal 账号。查询时开启 Tailscale VPN。配对后仍需保持电脑运行。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } else {
                    Section("这一餐") {
                        Picker("平台", selection: $platform) { Text("美团").tag("meituan"); Text("淘宝闪购").tag("eleme") }
                        TextField("门店、想吃的餐品", text: $query)
                        TextField("预算（元）", text: $budget).keyboardType(.decimalPad)
                        Button("让电脑搜索") { Task { await connection.submit(platform: platform, kind: "search", query: query, budget: budget) } }.disabled(connection.busy || !connection.connected)
                        Button("接管电脑网页 · 登录与验证") { remote = true }.disabled(!connection.connected)
                        Button("检测当前结算页") { Task { await connection.submit(platform: platform, kind: "inspect", query: query, budget: budget) } }.disabled(connection.busy || !connection.connected)
                        Button("读取当前历史订单页") { Task { await connection.submit(platform: platform, kind: "history", query: query, budget: budget) } }.disabled(connection.busy || !connection.connected)
                        Text("当前先验证电脑查询和手机接管。自动选规格、用券及凑单的电脑调度尚待迁移；候选金额未核实完整购物篮，不作为正式前沿。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    if let snapshot = connection.snapshot {
                        Section("查询进度") {
                            ForEach(snapshot.jobs.prefix(8)) { job in
                                VStack(alignment: .leading, spacing: 5) {
                                    Text((job.input.platform == "meituan" ? "美团" : "淘宝闪购") + " · " + job.message)
                                    Text(job.updatedAt).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        Section("候选金额记录 · 采集时有效") {
                            ForEach(snapshot.records) { record in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("\(record.platform == "meituan" ? "美团" : "淘宝闪购") ¥\(Double(record.totalCents) / 100, specifier: "%.2f")").font(.headline)
                                    Text(record.etaText)
                                    Text(record.observedAt).font(.caption)
                                    Text(record.note).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        Section("常买摘要 · 每次重新询价") {
                            ForEach(Array(snapshot.history.enumerated()), id: \.offset) { _, history in
                                Button {
                                    platform = history.platform
                                    query = history.entry.storeName + " " + history.entry.items.map(\.name).joined(separator: " ")
                                } label: { Text(history.entry.storeName + " · " + history.entry.items.map(\.name).joined(separator: "、")) }
                            }
                        }
                    }
                    Section { Button("忘记这台电脑", role: .destructive) { connection.forget() } }
                }
                Section { Button("打开旧版手机验证工具") { legacy = true } }
            }
            .navigationTitle("饭价")
            .toolbar { Button { Task { await connection.refresh(); connection.connectEvents() } } label: { Image(systemName: "arrow.clockwise") } }
            .sheet(isPresented: $remote) { DesktopRemoteView(connection: connection, platform: platform) }
            .sheet(isPresented: $legacy) { LegacyMealView() }
            .task { await connection.refresh(); connection.connectEvents() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await connection.refresh(); connection.connectEvents() } }
                else { connection.disconnectEvents() }
            }
        }
    }
}
private struct LegacyMealView: View {
    @StateObject private var model = AppModel()
    var body: some View { ContentView(model: model) }
}
struct DesktopRemoteView: View {
    @ObservedObject var connection: DesktopConnection
    let platform: String
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var secret = true
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    Text("这是电脑上的同一网页。接管期间自动查询暂停；完成后结束接管，再检测当前页面。")
                        .font(.caption).foregroundStyle(.secondary)
                    if let frame = connection.frame, let image = frame.uiImage {
                        Text(frame.origin).font(.caption).lineLimit(1)
                        GeometryReader { geometry in
                            Image(uiImage: image).resizable().scaledToFit()
                                .contentShape(Rectangle())
                                .gesture(DragGesture(minimumDistance: 0).onEnded { value in
                                    let scale = Double(frame.width) / geometry.size.width
                                    let start = value.startLocation, end = value.location
                                    let drag = hypot(end.x - start.x, end.y - start.y) > 8
                                    let values: [String: Any] = ["type": drag ? "drag" : "tap",
                                        "x": start.x * scale, "y": start.y * scale, "endX": end.x * scale, "endY": end.y * scale]
                                    Task { await connection.input(platform, values: values) }
                                })
                        }.aspectRatio(CGFloat(frame.width) / CGFloat(frame.height), contentMode: .fit)
                    } else {
                        ContentUnavailableView(connection.busy ? "正在读取电脑画面" : "请刷新画面", systemImage: "desktopcomputer")
                    }
                    HStack {
                        Button("向上") { send(["type": "scroll", "delta": -500]) }
                        Button("向下") { send(["type": "scroll", "delta": 500]) }
                        Button("刷新") { Task { await connection.refreshFrame(platform) } }
                        Button("首页") { Task { await connection.home(platform) } }
                    }.buttonStyle(.bordered).disabled(connection.busy)
                    Group {
                        if secret { SecureField("先点网页输入框，再在这里输入", text: $text) }
                        else { TextField("先点网页输入框，再在这里输入", text: $text) }
                    }.textFieldStyle(.roundedBorder).textInputAutocapitalization(.never).autocorrectionDisabled()
                    HStack {
                        Toggle("隐藏文字", isOn: $secret)
                        Button("输入") { let value = text; text = ""; send(["type": "text", "text": value]) }
                        Button("退格") { send(["type": "key", "key": "Backspace"]) }
                    }.disabled(connection.busy)
                    Text(connection.message).font(.caption).foregroundStyle(.secondary)
                    Text("每次操作后画面刷新。画面超过 10 秒需先刷新；可直接拖动滑块。平台如拒绝远程验证，会保持暂停。饭价不提供下单或支付操作。")
                        .font(.caption).foregroundStyle(.secondary)
                }.padding()
            }
            .navigationTitle(platform == "meituan" ? "接管美团" : "接管淘宝闪购")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled()
            .toolbar { Button("结束接管") { Task { await connection.takeControl(platform, active: false); if !connection.controlling { dismiss() } } }.disabled(connection.busy) }
            .task { await connection.takeControl(platform, active: true) }
        }
    }
    private func send(_ values: [String: Any]) { Task { await connection.input(platform, values: values) } }
}
