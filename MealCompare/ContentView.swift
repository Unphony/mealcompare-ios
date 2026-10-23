import SwiftUI
import WebKit

struct ContentView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var history: MealHistoryLibrary
    @State private var selectedTab = 0
    @AppStorage("desiredFood") private var desiredFood = ""
    @AppStorage("budgetText") private var budgetText = "30"
    @AppStorage("limitExtras") private var limitExtras = false
    @AppStorage("maxExtraQuantity") private var maxExtraQuantity = 2
    @AppStorage("desiredQuantity") private var desiredQuantity = 1
    @AppStorage("preferredOptions") private var preferredOptions = ""
    @AppStorage("allowedExtraNames") private var allowedExtraNames = ""
    @AppStorage("storeHint") private var storeHint = ""
    @State private var historySpecificationSummary = ""

    init(model: AppModel) {
        self.model = model
        history = model.history
    }

    private var shoppingOptions: ShoppingOptions {
        ShoppingOptions(productName: desiredFood, quantity: desiredQuantity,
                        preferredOptions: optionNames(preferredOptions),
                        budgetCents: budgetCents(budgetText),
                        maxExtraQuantity: limitExtras ? maxExtraQuantity : 2,
                        allowedExtraNames: optionNames(allowedExtraNames))
    }

    var body: some View {
        TabView(selection: $selectedTab) {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("想吃的，值得比一比。")
                                .font(.largeTitle.bold())
                            Text("专用 App · 零费用自签验证版")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        VStack(alignment: .leading, spacing: 16) {
                            Text("这一餐").font(.headline)
                            TextField("门店或品牌，比如汉堡王", text: $storeHint)
                                .textFieldStyle(.roundedBorder)
                            TextField("想吃什么，比如鸡腿堡", text: $desiredFood)
                                .textFieldStyle(.roundedBorder)
                                .submitLabel(.search)
                            Stepper("目标商品 \(desiredQuantity) 份", value: $desiredQuantity, in: 1...10)
                            TextField("规格偏好，逗号分隔；留空沿用可用默认项", text: $preferredOptions)
                                .textFieldStyle(.roundedBorder)
                            if !historySpecificationSummary.isEmpty {
                                Text("历史规格摘要：\(historySpecificationSummary)。请把需要固定的选项填入规格偏好；摘要暂不当作已解析的规格。")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            HStack {
                                Text("预算")
                                Spacer()
                                Text("¥")
                                TextField("30", text: $budgetText)
                                    .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                                    .frame(width: 90)
                            }
                            Toggle("限制额外凑单件数", isOn: $limitExtras)
                            if limitExtras {
                                Stepper("最多 \(maxExtraQuantity) 件", value: $maxExtraQuantity, in: 0...20)
                            }
                            TextField("可凑单的完整商品名，逗号分隔；留空不限定", text: $allowedExtraNames)
                                .textFieldStyle(.roundedBorder)
                            Text("本轮单店验证最多尝试 8 个购物篮；未设置件数上限时，先查最多加 2 件的范围。预算按结算实付额判断。")
                                .font(.caption).foregroundStyle(.secondary)
                            Button {
                                model.searchBoth([storeHint, desiredFood].filter { !$0.isEmpty }.joined(separator: " "))
                                selectedTab = 1
                            } label: {
                                Label("尝试两平台搜索", systemImage: "magnifyingglass")
                                    .frame(maxWidth: .infinity).padding(.vertical, 6)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(desiredFood.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        .padding(20).background(.background, in: RoundedRectangle(cornerRadius: 22))

                        VStack(alignment: .leading, spacing: 12) {
                            Text("常买方案").font(.headline)
                            Text("优先查已知门店、餐品和规格；价格、优惠和在售状态每次重新核对。")
                                .font(.caption).foregroundStyle(.secondary)
                            ForEach(history.recipes) { recipe in
                                Button {
                                    storeHint = recipe.storeName
                                    desiredFood = recipe.productName
                                    desiredQuantity = min(10, recipe.quantity)
                                    historySpecificationSummary = recipe.source == "历史订单" ? recipe.specifications : ""
                                    preferredOptions = recipe.source == "历史订单" ? "" : recipe.specifications
                                    budgetText = money(recipe.budgetCents)
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(recipe.storeName) · \(recipe.productName)")
                                        Text("\(recipe.source) · \(recipe.quantity) 份 · 预算 ¥\(money(recipe.budgetCents))")
                                            .font(.caption).foregroundStyle(.secondary)
                                    }.frame(maxWidth: .infinity, alignment: .leading)
                                }.buttonStyle(.plain)
                                Divider()
                            }
                            Text("在平台历史订单页，使用右下方“更多”中的“读取当前历史订单”。只保存门店和餐品规格到本机。")
                                .font(.caption).foregroundStyle(.secondary)
                            if !history.importMessage.isEmpty { Text(history.importMessage).font(.caption) }
                        }.padding(20).background(.background, in: RoundedRectangle(cornerRadius: 22))

                        VStack(alignment: .leading, spacing: 12) {
                            Label("先验证真实报价", systemImage: "checkmark.magnifyingglass")
                                .font(.headline)
                            Text("请在下方两个平台页登录，用同一地址和同一餐品进入提交订单前的结算页。点击“检测”，核对网页金额与官方 App 是否一致。")
                            Text("可在门店页的“更多”中启动单店配餐验证。跨平台同店匹配、全部复杂套餐和全部券页面仍需适配；检测数字不会自动变成完整比价结论。")
                                .foregroundStyle(.secondary)
                        }.font(.subheadline)

                        VStack(alignment: .leading, spacing: 10) {
                            Text("平台状态").font(.headline)
                            PlatformStatusRow(session: model.meituan) { selectedTab = 1 }
                            PlatformStatusRow(session: model.eleme) { selectedTab = 2 }
                        }
                    }.padding(20)
                }
                .background(Color(uiColor: .systemGroupedBackground))
                .navigationTitle("饭价")
                .navigationBarTitleDisplayMode(.inline)
            }
            .tabItem { Label("这一餐", systemImage: "fork.knife") }.tag(0)

            NavigationStack { PlatformBrowser(session: model.meituan, query: desiredFood, history: history, options: shoppingOptions) }
                .tabItem { Label("美团", systemImage: "bag") }.tag(1)
            NavigationStack { PlatformBrowser(session: model.eleme, query: desiredFood, history: history, options: shoppingOptions) }
                .tabItem { Label("淘宝闪购", systemImage: "bag.fill") }.tag(2)
            NavigationStack { ReportView(model: model) }
                .tabItem { Label("验证记录", systemImage: "checklist") }.tag(3)
        }
    }
}

private struct PlatformStatusRow: View {
    @ObservedObject var session: PlatformSession
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 12) {
                Image(systemName: session.probe == nil ? "circle.dashed" : "doc.text.magnifyingglass")
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.platform.name).font(.headline)
                    Text(session.status).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption)
            }.padding(14).background(.background, in: RoundedRectangle(cornerRadius: 14))
        }.buttonStyle(.plain)
    }
}

private struct WebContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

private struct PlatformBrowser: View {
    @ObservedObject var session: PlatformSession
    let query: String
    @ObservedObject var history: MealHistoryLibrary
    let options: ShoppingOptions
    @State private var showFindings = false
    @State private var showShopping = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "globe")
                Text(session.webView.url?.host ?? session.platform.homeURL.host ?? "官方网页")
                    .lineLimit(1)
                Spacer()
                if session.isLoading { ProgressView().controlSize(.small) }
            }.font(.caption).padding(.horizontal).padding(.vertical, 8)
                .background(.thinMaterial)
            WebContainer(webView: session.webView)
            VStack(alignment: .leading, spacing: 8) {
                Text(session.status).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                HStack {
                    Button { session.goBack() } label: { Image(systemName: "chevron.left") }
                        .accessibilityLabel("返回上一页")
                    Button { session.openHome() } label: { Image(systemName: "house") }
                        .accessibilityLabel("返回平台首页")
                    Button { session.reload() } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("重新载入网页")
                    Spacer()
                    Button("试查") { session.search(query) }
                        .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || session.isLoading || session.isSearching)
                    Button("检测") { session.inspect(); showFindings = true }
                        .buttonStyle(.borderedProminent)
                        .disabled(session.isLoading || session.isInspecting)
                    Menu {
                        Button("当前门店自动配餐（验证）") {
                            guard let budget = options.budgetCents else { return }
                            session.startShopping(productName: options.productName, quantity: options.quantity,
                                preferredOptions: options.preferredOptions, budgetCents: budget,
                                maxExtraQuantity: options.maxExtraQuantity, allowedExtraNames: options.allowedExtraNames)
                            showShopping = true
                        }.disabled(options.budgetCents == nil || options.productName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || session.isLoading || session.isSearching)
                        Button("读取当前历史订单") {
                            history.importCurrentPage(session.webView, platform: session.platform)
                        }.disabled(history.isImporting || session.isLoading || session.shopping.isRunning)
                    } label: { Image(systemName: "ellipsis.circle") }
                        .accessibilityLabel("更多")
                }.buttonStyle(.bordered)
            }.padding(12).background(.bar)
        }
        .navigationTitle(session.platform.name).navigationBarTitleDisplayMode(.inline)
        .onAppear { session.openIfNeeded() }
        .sheet(isPresented: $showFindings) {
            NavigationStack {
                ProbeDetails(session: session)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { showFindings = false } } }
            }
        }
        .sheet(isPresented: $showShopping) {
            ShoppingProgressView(automation: session.shopping)
        }
    }
}

private struct ShoppingOptions {
    let productName: String
    let quantity: Int
    let preferredOptions: [String]
    let budgetCents: Int?
    let maxExtraQuantity: Int
    let allowedExtraNames: [String]
}

private struct ShoppingProgressView: View {
    @ObservedObject var automation: ShoppingAutomation
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            List {
                Section {
                    if automation.isRunning { ProgressView() }
                    Text(automation.status)
                    Text("仅在当前门店的有限候选内试价；不提交订单。取消后请检查购物车，可能保留正在试验的餐品。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("预算内的帕累托前沿") {
                    if automation.frontier.isEmpty { Text("尚无金额和送达信息完整的预算内方案") }
                    ForEach(automation.frontier) { quote in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("¥\(money(quote.totalCents)) · \(quote.etaText)").font(.headline)
                            Text(quote.basketDescription)
                            Text(quote.coverageNote).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Text("已取得 \(automation.quotes.count) 个结算报价。不同门店和不同目标不混排；未查询的组合不参与最优结论。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("本次进度") {
                    ForEach(Array(automation.log.suffix(10).enumerated()), id: \.offset) { _, entry in
                        Text(entry).font(.caption)
                    }
                }
            }.navigationTitle("单店配餐验证")
                .toolbar { ToolbarItem(placement: .confirmationAction) {
                    Button(automation.isRunning ? "停止" : "完成") {
                        automation.cancel()
                        dismiss()
                    }
                } }
        }.onDisappear { automation.cancel() }
    }
}

private func optionNames(_ text: String) -> [String] {
    text.components(separatedBy: CharacterSet(charactersIn: ",，;；\n"))
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
}

private func budgetCents(_ text: String) -> Int? {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard text.range(of: #"^\d{1,6}(?:\.\d{1,2})?$"#, options: .regularExpression) != nil else { return nil }
    let parts = text.split(separator: ".", omittingEmptySubsequences: false)
    guard let whole = Int(parts[0]) else { return nil }
    let decimals = parts.count == 2 ? String(parts[1]) : ""
    return whole * 100 + (Int(decimals.padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0)
}

private func money(_ cents: Int) -> String {
    "\(cents / 100).\(String(format: "%02d", cents % 100))"
}

private struct ProbeDetails: View {
    @ObservedObject var session: PlatformSession
    var body: some View {
        List {
            Section {
                Text("以下是检测时的页面快照，不代表同店同餐的完整实付报价。更换商品、优惠或地址后，请重新检测。")
                    .font(.subheadline).foregroundStyle(.secondary)
                if session.isInspecting { ProgressView("正在检测页面") }
                if let time = session.inspectedAt {
                    LabeledContent("检测时间", value: time.formatted(date: .omitted, time: .shortened))
                }
            }
            if let probe = session.probe {
                Section("页面能力") {
                    LabeledContent("搜索输入框", value: String(probe.searchInputCount))
                    LabeledContent("出现优惠文字", value: probe.hasCouponText ? "是" : "未检测到")
                    LabeledContent("出现结算页线索", value: probe.checkoutLikely ? "是，待核对" : "未检测到")
                    LabeledContent("出现打开 App 提示", value: probe.hasOpenAppHint ? "是" : "未检测到")
                }
                if probe.addressRequired == true {
                    Section {
                        Label("平台仍要求选择收货地址。请先选好与另一平台相同的地址，再重新检测。", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        Text("当前金额和送达时间仅作页面参考，尚不能用于同地址比价。")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("候选金额") {
                    if probe.prices.isEmpty { Text("当前没有检测到明确标注的金额") }
                    ForEach(Array(probe.prices.enumerated()), id: \.offset) { _, price in
                        LabeledContent(price.label, value: price.formatted)
                    }
                }
                Section("预计送达线索") {
                    if probe.deliveryHints.isEmpty { Text("当前没有检测到送达时间") }
                    ForEach(probe.deliveryHints, id: \.self) { Text($0) }
                }
            } else if !session.isInspecting {
                Text("先等待网页载入，再点击检测。")
            }
            Section("登录保持检查") {
                if let summary = session.startupCookies {
                    LabeledContent("启动时网站记录", value: "\(summary.total) 条")
                    LabeledContent("启动时会话型记录", value: "\(summary.sessionOnly) 条")
                }
                if let summary = session.currentCookies {
                    LabeledContent("当前网站记录", value: "\(summary.total) 条")
                    LabeledContent("当前会话型记录", value: "\(summary.sessionOnly) 条")
                }
                Text("只统计 Cookie 数量，用于排查重开后退出登录的原因。报告不包含 Cookie 名称或内容；数量本身也不能证明已登录。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Button("重新检测") { session.inspect() }.disabled(session.isInspecting || session.isLoading)
            }
        }.navigationTitle("\(session.platform.name) · 页面检测")
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ValidationSection: View {
    @ObservedObject var session: PlatformSession
    var body: some View {
        Section(session.platform.name) {
            Toggle("可以在工具内登录", isOn: $session.notes.canLogIn)
            Toggle("可以进入提交订单前的结算页", isOn: $session.notes.canReachCheckout)
            Toggle("核对时餐品、规格、数量和地址相同", isOn: $session.notes.sameBasketAndAddress)
            Toggle("目标红包和会员券与原 App 一致", isOn: $session.notes.couponsMatchApp)
            Toggle("结算金额与原 App 一致", isOn: $session.notes.priceMatchesApp)
            if session.platform == .eleme {
                Text("核对标准：独立“淘宝闪购”App（原饿了么）的红包、会员券和应付金额。")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Toggle("重开工具后仍保持登录", isOn: $session.notes.loginSurvivesRestart)
            NavigationLink("查看页面检测") { ProbeDetails(session: session) }
        }
    }
}

private struct ReportView: View {
    @ObservedObject var model: AppModel
    @State private var reportURL: URL?
    @State private var exportError: String?
    @State private var isExporting = false
    var body: some View {
        Form {
            Section {
                Text("只勾选你已实际核对的项目。这些记录用于判断技术路线是否可行，不会把候选金额自动认证为有效报价。")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ValidationSection(session: model.meituan)
            ValidationSection(session: model.eleme)
            Section("分享验证结果") {
                Button(isExporting ? "正在重新检测并生成报告…" : "重新检测并生成报告") {
                    isExporting = true
                    reportURL = nil
                    Task {
                        defer { isExporting = false }
                        do { reportURL = try await model.reportURL(); exportError = nil }
                        catch { exportError = error.localizedDescription }
                    }
                }.disabled(isExporting)
                if let url = reportURL {
                    ShareLink("分享 JSON 报告", item: url)
                }
                if let exportError { Text(exportError).foregroundStyle(.red) }
                Text("报告包含能力标记、候选金额、完整送达区间、勾选结果和 Cookie 数量，不导出 Cookie 内容、密码、验证码、地址或完整网页。分享时可选择“存储到文件”查看。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("验证记录")
    }
}
