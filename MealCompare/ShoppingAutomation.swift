import Foundation
import WebKit
import Combine

struct ShoppingQuote: Identifiable, Codable, Equatable {
    let id: String
    let platform: DeliveryPlatform
    let productName: String
    let basketDescription: String
    let totalCents: Int
    let etaText: String
    let latestArrival: Date
    let observedAt: Date
    let coverageNote: String
}

private struct ShoppingMenuItem: Decodable {
    let name: String
    let priceCents: Int?
    let totalQuantity: Int
    let hasSpecs: Bool
    let specsKnown: Bool
    let available: Bool
}
private struct ShoppingCartLine: Codable, Equatable {
    let name: String
    let specs: String
    var quantity: Int
}
private struct ShoppingOption: Decodable {
    let name: String
    let selected: Bool
    let available: Bool
}
private struct ShoppingGroup: Decodable {
    let name: String
    let options: [ShoppingOption]
}
private struct ShoppingChild: Codable, Equatable {
    let name: String
    let index: Int
    let selected: Bool
}
private struct ShoppingSpec: Decodable {
    let name: String
    let groups: [ShoppingGroup]
    let children: [ShoppingChild]?
    let canConfirm: Bool
    let complex: Bool
}
private struct ShoppingPage: Decodable {
    let status: String
    let message: String
    let menu: [ShoppingMenuItem]
    let cart: [ShoppingCartLine]
    let cartKnown: Bool
    let spec: ShoppingSpec?
}
private struct ShoppingCoupon: Decodable {
    let key: String
    let title: String
    let selected: Bool
    let available: Bool
    let requiresRedemption: Bool
}
private struct ShoppingCouponPage: Decodable {
    let status: String
    let message: String
    let kind: String
    let coupons: [ShoppingCoupon]
    let canConfirm: Bool
    let selectionNeedsConfirm: Bool
    let canReturn: Bool
}
private struct ShoppingFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor
final class ShoppingAutomation: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var status = "请先在当前门店打开目标商品"
    @Published private(set) var quotes: [ShoppingQuote] = []
    @Published private(set) var frontier: [ShoppingQuote] = []
    @Published private(set) var log: [String] = []
    private let webView: WKWebView
    private let platform: DeliveryPlatform
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var budget = 0
    private var storeURL: URL?
    private var checkoutContextURL: URL?

    init(webView: WKWebView, platform: DeliveryPlatform) {
        self.webView = webView
        self.platform = platform
    }

    func start(productName: String, quantity: Int, preferredOptions: [String],
               budgetCents: Int, maxExtraQuantity: Int, allowedExtraNames: [String]) {
        guard !isRunning else { return }
        let name = Self.clean(productName)
        guard !name.isEmpty, name.count <= 200, (1...20).contains(quantity),
              budgetCents >= 0, (0...20).contains(maxExtraQuantity) else {
            note("商品名、预算或数量无效；当前最多配餐 20 份。")
            return
        }
        generation = UUID()
        let run = generation
        isRunning = true
        budget = budgetCents
        quotes = []
        frontier = []
        log = []
        task = Task { [weak self] in
            guard let self else { return }
            defer { if self.generation == run { self.isRunning = false } }
            do {
                try await self.execute(name: name, quantity: quantity,
                                       preferences: preferredOptions.map(Self.clean).filter { !$0.isEmpty },
                                       maxExtras: maxExtraQuantity,
                                       allowedExtras: allowedExtraNames.map(Self.clean).filter { !$0.isEmpty })
            } catch is CancellationError {
                return
            } catch {
                guard self.generation == run else { return }
                self.note("已暂停：\(error.localizedDescription) 已有真实报价仍保留；请核对网页当前购物车。")
            }
        }
    }

    func cancel() {
        guard isRunning else { return }
        task?.cancel()
        generation = UUID()
        isRunning = false
        note("已停止；网页可能保留本次试选的购物车和优惠，请核对后使用。")
    }

    private func note(_ text: String) {
        status = text
        log.append(text)
        if log.count > 100 { log.removeFirst(log.count - 100) }
    }

    private func fail(_ message: String) -> ShoppingFailure { ShoppingFailure(message: message) }

    private func pause(_ nanoseconds: UInt64 = 350_000_000) async throws {
        try await Task.sleep(nanoseconds: nanoseconds)
        try Task.checkCancellation()
    }
}

private extension ShoppingAutomation {
    static func clean(_ text: String) -> String {
        text.precomposedStringWithCompatibilityMapping
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func mealName(_ text: String) -> String {
        var value = clean(text)
        for (word, digit) in [("二", "2"), ("三", "3"), ("四", "4"), ("五", "5"), ("六", "6")] {
            value = value.replacingOccurrences(of: word + "件套", with: digit + "件套")
        }
        return value
    }

    func script<T: Decodable>(_ resource: String, _ action: String,
                              _ arguments: [String: Any] = [:]) async throws -> T {
        try Task.checkCancellation()
        let actions: [String: Set<String>] = [
            "Shopping": ["observe", "open-cart", "close-cart", "add-product", "choose-option",
                         "confirm-spec", "select-child", "change-cart", "checkout", "close-spec"],
            "Coupon": ["observe", "open-list", "select", "confirm", "close-list"],
            "Probe": ["inspect"]
        ]
        guard actions[resource]?.contains(action) == true,
              let url = webView.url, url.scheme == "https",
              (platform == .meituan ? url.host == "h5.waimai.meituan.com"
               : ["h5.ele.me", "tb.ele.me"].contains(url.host ?? "")),
              let path = Bundle.main.url(forResource: resource, withExtension: "js") else {
            throw fail("当前页面或本地操作资源不受支持。")
        }
        let source = try String(contentsOf: path, encoding: .utf8)
        var request = arguments
        request["action"] = action
        let data = try JSONSerialization.data(withJSONObject: request, options: [.sortedKeys])
        let marker = resource == "Shopping" ? "__MEAL_SHOPPING_REQUEST__"
            : resource == "Coupon" ? "__MEAL_COUPON_REQUEST__" : "__MEAL_COMPARE_REQUEST__"
        let code = source.replacingOccurrences(of: marker, with: String(decoding: data, as: UTF8.self))
        let result = try await webView.evaluateJavaScript(code)
        try Task.checkCancellation()
        guard let json = result as? String, let bytes = json.data(using: .utf8) else {
            throw fail("网页没有返回可核对的信息。")
        }
        return try JSONDecoder().decode(T.self, from: bytes)
    }

    func observe() async throws -> ShoppingPage { try await script("Shopping", "observe") }

    func action(_ name: String, _ arguments: [String: Any] = [:]) async throws {
        guard let storeURL, webView.url == storeURL else {
            throw fail("当前门店地址已变化，已停止购物操作。")
        }
        let result: ShoppingPage = try await script("Shopping", name, arguments)
        guard ["attempted", "nochange"].contains(result.status) else { throw fail(result.message) }
        try await pause()
    }

    func waitPage(_ predicate: (ShoppingPage) -> Bool) async throws -> ShoppingPage {
        for _ in 0..<30 {
            if !webView.isLoading {
                let page = try await observe()
                if predicate(page) { return page }
            }
            try await pause()
        }
        throw fail("页面没有在等待时间内给出完整、可核对的商品或购物车。")
    }

    func cartPage() async throws -> ShoppingPage {
        let page = try await observe()
        if page.cartKnown { return page }
        try await action("open-cart")
        return try await waitPage { $0.cartKnown }
    }

    func lineKey(_ line: ShoppingCartLine) -> String {
        Self.clean(line.name) + "\u{1f}" + Self.clean(line.specs)
    }

    func cartSignature(_ lines: [ShoppingCartLine]) throws -> [String: Int] {
        var result: [String: Int] = [:]
        for line in lines {
            let key = lineKey(line)
            guard !Self.clean(line.name).isEmpty, (1...1_000).contains(line.quantity),
                  result[key] == nil else { throw fail("购物车有无法区分的同名规格行，不能可靠修改。") }
            result[key] = line.quantity
        }
        return result
    }

    func verify(_ actual: [ShoppingCartLine], equals expected: [ShoppingCartLine]) throws {
        guard try cartSignature(actual) == cartSignature(expected) else {
            throw fail("购物车与预期不一致，可能有人工改动或平台调整；已停止后续操作。")
        }
    }

    func matchesPreferences(_ line: ShoppingCartLine, _ preferences: [String]) -> Bool {
        let tokens = Self.clean(line.specs).components(separatedBy: CharacterSet(charactersIn: "+＋,，/、;；|"))
            .map(Self.clean)
        return preferences.allSatisfy { tokens.contains($0) || Self.clean(line.specs) == $0 }
    }

    func prepareBase(_ name: String, quantity: Int, preferences: [String]) async throws -> [ShoppingCartLine] {
        let first = try await observe()
        guard first.spec == nil else { throw fail("请先在网页完成或关闭已打开的规格面板，再开始配餐。") }
        let matches = first.menu.filter { Self.mealName($0.name) == Self.mealName(name) }
        guard matches.count == 1 else { throw fail("当前菜单没有唯一的精确目标商品，请先进入正确门店。") }
        let actualName = matches[0].name
        var page = try await cartPage()
        _ = try cartSignature(page.cart)
        if !page.cart.isEmpty {
            let target = page.cart.filter { Self.mealName($0.name) == Self.mealName(name) }
            guard target.count == 1, target[0].quantity == quantity,
                  (!matches[0].hasSpecs && matches[0].specsKnown) || !Self.clean(target[0].specs).isEmpty else {
                throw fail("已有目标的完整规格或数量无法从购物车核实，请先在网页选好并展开明细。")
            }
            guard
                  matchesPreferences(target[0], preferences) else {
                throw fail("购物车已有商品，但目标的规格或数量未明确满足要求；请先在网页选好目标，不会自动清空。")
            }
            note("保留你已选择的完整购物车作为基础篮。")
            return page.cart
        }
        var expected: [ShoppingCartLine] = []
        for index in 0..<quantity {
            try await action("close-cart")
            let before = try await observe()
            let cards = before.menu.filter { $0.name == actualName }
            guard cards.count == 1, cards[0].available, cards[0].totalQuantity == index else {
                throw fail("目标商品的数量或可售状态已经变化。")
            }
            guard preferences.isEmpty || !cards[0].specsKnown || cards[0].hasSpecs else {
                throw fail("目标没有可读取的规格选项，无法核实所指定的规格摘要。")
            }
            try await action("add-product", ["name": actualName, "currentQuantity": index,
                                            "desiredQuantity": index + 1])
            let after = try await waitPage {
                $0.spec != nil || $0.menu.contains { $0.name == actualName && $0.totalQuantity == index + 1 }
            }
            if after.spec != nil { try await configureSpec(after, target: actualName, preferences: preferences) }
            page = try await cartPage()
            guard page.cart.count == 1, Self.mealName(page.cart[0].name) == Self.mealName(name),
                  page.cart[0].quantity == index + 1 else {
                throw fail("加购后没有读到唯一且数量正确的目标购物车行。")
            }
            guard after.spec == nil || !Self.clean(page.cart[0].specs).isEmpty,
                  matchesPreferences(page.cart[0], preferences) else {
                throw fail("加购后未从购物车核实完整规格摘要，已暂停；请在网页核对。")
            }
            if let previous = expected.first {
                guard lineKey(previous) == lineKey(page.cart[0]) else { throw fail("平台改变了目标规格，已暂停。") }
            }
            expected = page.cart
        }
        return expected
    }

    func configureSpec(_ initial: ShoppingPage, target: String, preferences: [String]) async throws {
        guard let opening = initial.spec, !opening.complex else {
            throw fail("当前套餐或规格结构未完整适配，请在网页完成选择。")
        }
        let children = opening.children ?? []
        guard children.count <= 8 else { throw fail("套餐子商品过多，超出本次自动核对范围。") }
        if children.isEmpty, Self.mealName(opening.name) != Self.mealName(target) {
            throw fail("规格面板的商品与本次目标不一致。")
        }
        let visits = children.isEmpty ? [ShoppingChild(name: opening.name, index: 0, selected: true)] : children
        var foundPreferences = Set<String>()
        var expectedGroups: [Int: [String: String]] = [:]
        for child in visits {
            if !children.isEmpty {
                try await action("select-child", ["index": child.index, "name": child.name])
            }
            var page = try await waitPage { page in
                guard let spec = page.spec, !spec.complex else { return false }
                return children.isEmpty || (spec.children ?? []).contains {
                    $0.index == child.index && $0.name == child.name && $0.selected
                }
            }
            guard let spec = page.spec, !spec.groups.isEmpty, spec.groups.count <= 10 else {
                throw fail("没有读到完整规格分组。")
            }
            for preference in preferences {
                let uses = spec.groups.filter { $0.options.contains { Self.clean($0.name) == preference } }
                guard uses.count <= 1 else { throw fail("规格“\(preference)”对应多个分组，请在网页明确选择。") }
            }
            var selected: [String: String] = [:]
            for group in spec.groups {
                let desired = group.options.filter { preferences.contains(Self.clean($0.name)) }
                guard desired.count <= 1 else { throw fail("同一规格组存在多个指定选项。") }
                let defaults = group.options.filter { $0.selected && $0.available }
                let available = group.options.filter(\.available)
                let choice = desired.first ?? (defaults.count == 1 ? defaults[0] : available.count == 1 ? available[0] : nil)
                guard let choice, choice.available else {
                    throw fail("套餐子商品“\(child.name)”的“\(group.name)”未选齐，请在网页选择。")
                }
                if preferences.contains(Self.clean(choice.name)) { foundPreferences.insert(Self.clean(choice.name)) }
                try await action("choose-option", ["group": group.name, "option": choice.name])
                page = try await waitPage {
                    $0.spec?.groups.contains { row in
                        row.name == group.name && row.options.filter { $0.selected && $0.available }.map(\.name) == [choice.name]
                    } == true
                }
                selected[group.name] = choice.name
            }
            guard let checked = page.spec, checked.groups.allSatisfy({
                $0.options.filter { $0.selected && $0.available }.count == 1
            }) else {
                throw fail("当前子商品仍有未完成的规格或不可用选项。")
            }
            expectedGroups[child.index] = selected
        }
        guard preferences.allSatisfy(foundPreferences.contains) else {
            throw fail("指定规格摘要不能逐项对应到网页选项，请在网页核对，未确认加购。")
        }
        // Revisit each tab: a later dependent choice must not silently reset an earlier child.
        for child in visits {
            if !children.isEmpty { try await action("select-child", ["index": child.index, "name": child.name]) }
            let page = try await waitPage { page in
                guard let spec = page.spec else { return false }
                return children.isEmpty || (spec.children ?? []).contains { $0.index == child.index && $0.selected }
            }
            guard let spec = page.spec, !spec.complex, spec.canConfirm,
                  spec.groups.count == expectedGroups[child.index]?.count else {
                throw fail("套餐规格在复核时发生变化，未确认加购。")
            }
            for group in spec.groups {
                guard group.options.filter({ $0.selected && $0.available }).map(\.name)
                    == [expectedGroups[child.index]?[group.name] ?? ""] else {
                    throw fail("套餐子商品的规格未保持一致，未确认加购。")
                }
            }
        }
        let final = try await observe()
        guard let spec = final.spec, spec.canConfirm else { throw fail("规格面板未就绪。") }
        let verified = children.map { ["index": $0.index, "name": $0.name] as [String: Any] }
        try await action("confirm-spec", ["name": spec.name, "verifiedChildren": verified])
        _ = try await waitPage { $0.spec == nil }
    }

    func execute(name: String, quantity: Int, preferences: [String],
                 maxExtras: Int, allowedExtras: [String]) async throws {
        storeURL = webView.url
        checkoutContextURL = nil
        note("只操作当前门店；正在核对目标商品和完整基础购物车。")
        let base = try await prepareBase(name, quantity: quantity, preferences: preferences)
        let existingExtras = base.filter { Self.mealName($0.name) != Self.mealName(name) }
        let existingExtraCount = existingExtras.reduce(0) { $0 + $1.quantity }
        guard existingExtraCount <= maxExtras else {
            throw fail("已有购物车的额外商品超过本次件数限制；请先手动调整，不会自动清空。")
        }
        guard allowedExtras.isEmpty || existingExtras.allSatisfy({ line in
            allowedExtras.contains { Self.mealName($0) == Self.mealName(line.name) }
        }) else { throw fail("已有购物车包含本次未允许的附加品，请先在网页调整。") }
        guard let menuURL = webView.url else { throw fail("门店页面已离开。") }
        let page = try await observe()
        let plans = makePlans(base: base, menu: page.menu,
                              maxExtras: maxExtras - existingExtraCount, allowed: allowedExtras)
        var expected = base
        let scope = "当前门店最多试 \(plans.count) 个购物篮、每篮最多 6 种已有券选择；未按全部满减门槛搜索，未验证原 App 专属优惠及跨平台同地址。"
        for (index, additions) in plans.enumerated() {
            try Task.checkCancellation()
            note("正在试价第 \(index + 1)/\(plans.count) 篮。")
            try verify((try await cartPage()).cart, equals: expected)
            expected = try await restoreBase(base, from: expected)
            for (extraName, extraCount) in additions.sorted(by: { $0.key < $1.key }) {
                for _ in 0..<extraCount { expected = try await addExtra(extraName, to: expected) }
            }
            let verified = try await cartPage()
            try verify(verified.cart, equals: expected)
            try await action("checkout")
            try await awaitCheckout()
            guard let checkoutURL = webView.url else { throw fail("结算页面地址缺失。") }
            checkoutContextURL = checkoutURL
            try await quoteCoupons(product: name, basket: expected, checkoutURL: checkoutURL, scope: scope)
            try await returnTo(menuURL)
            try verify((try await cartPage()).cart, equals: expected)
        }
        _ = try await restoreBase(base, from: expected)
        note(quotes.isEmpty ? "未取得应付金额和送达时间均明确、且未检测到缺地址提示的报价。"
             : "已取得 \(quotes.count) 个真实结算报价，预算内帕累托方案 \(frontier.count) 个；购物车已还原为基础篮。")
    }

    func makePlans(base: [ShoppingCartLine], menu: [ShoppingMenuItem], maxExtras: Int,
                   allowed: [String]) -> [[String: Int]] {
        var catalog: [BasketPlanSKU] = []
        var lines: [BasketPlanLine] = []
        var required: [String: Int] = [:]
        for (index, line) in base.enumerated() {
            let key = "base-\(index)"
            catalog.append(BasketPlanSKU(id: key, unitPriceCents: 0,
                                         availableQuantity: line.quantity, coverage: [key: 1]))
            lines.append(BasketPlanLine(skuID: key, quantity: line.quantity))
            required[key] = line.quantity
        }
        var optional: [String] = []
        var names: [String: String] = [:]
        let eligible = menu.filter { item in
            item.available && item.specsKnown && !item.hasSpecs && (item.priceCents ?? -1) >= 0
                && !base.contains(where: { Self.mealName($0.name) == Self.mealName(item.name) })
                && menu.filter({ Self.mealName($0.name) == Self.mealName(item.name) }).count == 1
                && (allowed.isEmpty || allowed.contains { Self.mealName($0) == Self.mealName(item.name) })
        }.sorted { lhs, rhs in
            lhs.priceCents == rhs.priceCents ? lhs.name < rhs.name : (lhs.priceCents ?? 0) < (rhs.priceCents ?? 0)
        }
        for item in eligible.prefix(8) where maxExtras > 0 {
            guard let price = item.priceCents else { continue }
            let key = "extra-\(optional.count)"
            // Only one currently available unit per menu entry is proposed; stock is rechecked by the page.
            catalog.append(BasketPlanSKU(id: key, unitPriceCents: price, availableQuantity: 1, coverage: [key: 1]))
            optional.append(key)
            names[key] = item.name
        }
        let result = BasketPlanner.plan(BasketPlanRequest(catalog: catalog, baseBasket: lines,
            optionalSKUIds: optional, requiredItems: required, budgetCents: budget,
            maxExtraQuantity: maxExtras, maxCandidates: 8, maxVisitedCombinations: 512))
        guard result.validationError == nil else { return [[:]] }
        if maxExtras > 0 && optional.isEmpty {
            note("未找到名称唯一、价格明确且无待选规格的允许附加品，本次只试基础篮。")
        }
        return result.candidates.map { candidate in
            var extras: [String: Int] = [:]
            for line in candidate.lines { if let name = names[line.skuID] { extras[name] = line.quantity } }
            return extras
        }
    }

    func returnTo(_ url: URL) async throws {
        try Task.checkCancellation()
        if webView.url == url { return }
        guard let item = webView.backForwardList.backList.last(where: { $0.url == url }) else {
            throw fail("无法确认返回原页面的路径，请手动返回；不会重新拼装购物车或结算地址。")
        }
        webView.go(to: item)
        for _ in 0..<40 {
            try await pause()
            if !webView.isLoading && webView.url == url { try await pause(650_000_000); return }
        }
        throw fail("返回原页面超时，请手动核对。")
    }

    func restoreBase(_ base: [ShoppingCartLine], from current: [ShoppingCartLine]) async throws -> [ShoppingCartLine] {
        var expected = current
        let original = try cartSignature(base)
        try verify((try await cartPage()).cart, equals: expected)
        for row in current {
            let originalCount = original[lineKey(row)] ?? 0
            guard row.quantity >= originalCount else { throw fail("基础购物车数量已被减少，不能自动还原。") }
            for _ in originalCount..<row.quantity {
                let before = try await cartPage()
                try verify(before.cart, equals: expected)
                guard let index = expected.firstIndex(where: { lineKey($0) == lineKey(row) }) else {
                    throw fail("试验商品的购物车行已变化。")
                }
                expected[index].quantity -= 1
                expected.removeAll { $0.quantity == 0 }
                let desired = try cartSignature(expected)
                try await action("change-cart", ["name": row.name,
                    "expectedSpecs": row.specs.isEmpty ? [] : [row.specs], "delta": -1])
                let result = try await waitPage {
                    $0.cartKnown && (try? self.cartSignature($0.cart)) == desired
                }
                try verify(result.cart, equals: expected)
            }
        }
        try verify(expected, equals: base)
        return base
    }

    func addExtra(_ name: String, to current: [ShoppingCartLine]) async throws -> [ShoppingCartLine] {
        try verify((try await cartPage()).cart, equals: current)
        try await action("close-cart")
        let before = try await observe()
        let matches = before.menu.filter { $0.name == name }
        guard matches.count == 1, let item = matches.first, item.available,
              item.specsKnown, !item.hasSpecs, item.priceCents != nil else {
            throw fail("附加品的价格或规格不再明确，未继续凑单。")
        }
        let previousCount = current.filter { $0.name == name }.reduce(0) { $0 + $1.quantity }
        guard item.totalQuantity == previousCount else { throw fail("附加品的菜单数量与购物车不一致。") }
        try await action("add-product", ["name": name, "currentQuantity": previousCount,
                                         "desiredQuantity": previousCount + 1])
        let changed = try await waitPage {
            $0.spec != nil || $0.menu.contains { $0.name == name && $0.totalQuantity == previousCount + 1 }
        }
        guard changed.spec == nil else { throw fail("附加品实际需要选规格，未自动确认。") }
        _ = try await cartPage()
        let after = try await waitPage {
            $0.cartKnown && $0.cart.filter { $0.name == name }.reduce(0) { $0 + $1.quantity } == previousCount + 1
        }
        let added = after.cart.filter { $0.name == name }
        guard added.count == 1 else { throw fail("附加品出现多个规格，不能可靠还原。") }
        var expected = current.filter { $0.name != name }
        if let old = current.first(where: { $0.name == name }) {
            guard lineKey(old) == lineKey(added[0]) else { throw fail("附加品规格发生变化。") }
        }
        expected.append(added[0])
        try verify(after.cart, equals: expected)
        return expected
    }

    func awaitCheckout() async throws {
        for _ in 0..<40 {
            if !webView.isLoading {
                let page: PageProbe = try await script("Probe", "inspect")
                if page.hasLoginInput { throw fail("请先在官方页面完成登录或验证码。") }
                if page.checkoutLikely { try await pause(800_000_000); return }
            }
            try await pause()
        }
        throw fail("未进入可识别的提交订单前页面；没有提交订单。")
    }

    func couponPage() async throws -> ShoppingCouponPage { try await script("Coupon", "observe") }

    func openCoupons(checkoutURL: URL) async throws -> ShoppingCouponPage {
        let result: ShoppingCouponPage = try await script("Coupon", "open-list")
        guard ["ready", "opened"].contains(result.status) else { return result }
        try await pause(650_000_000)
        for _ in 0..<25 {
            if !webView.isLoading {
                let page = try await couponPage()
                if page.kind == "coupons" || (page.kind == "unsupported" && webView.url != checkoutURL) { return page }
            }
            try await pause()
        }
        return try await couponPage()
    }

    func closeCoupons(checkoutURL: URL) async throws {
        let page = try await couponPage()
        if page.kind == "coupons" {
            let result: ShoppingCouponPage = try await script("Coupon", "close-list")
            guard result.status == "closed" else { throw fail(result.message) }
            try await pause(650_000_000)
        }
        if webView.url != checkoutURL { try await returnTo(checkoutURL) }
        try await awaitCheckout()
    }

    func quoteCoupons(product: String, basket: [ShoppingCartLine], checkoutURL: URL,
                      scope: String) async throws {
        try await collectQuote(product: product, basket: basket,
                               coverage: "平台当前已选优惠；未证明已使用最优券。" + scope)
        let initial = try await openCoupons(checkoutURL: checkoutURL)
        guard initial.kind == "coupons" else {
            note("当前券页面未适配或没有可操作入口；保留平台默认优惠的真实报价，未遍历红包及会员券。")
            if webView.url != checkoutURL { try await returnTo(checkoutURL) }
            return
        }
        let candidates = initial.coupons.filter { $0.available && !$0.requiresRedemption && !$0.selected }
        let keys = Array(candidates.prefix(5)).map(\.key)
        try await closeCoupons(checkoutURL: checkoutURL)
        for key in keys {
            let list = try await openCoupons(checkoutURL: checkoutURL)
            guard list.kind == "coupons" else {
                note("后续券列表结构改变，已停止遍历，保留已取得的报价。")
                if webView.url != checkoutURL { try await returnTo(checkoutURL) }
                return
            }
            let found = list.coupons.filter { $0.key == key }
            guard found.count == 1, let coupon = found.first, coupon.available, !coupon.requiresRedemption else {
                try await closeCoupons(checkoutURL: checkoutURL)
                continue
            }
            note("正在用已有券“\(coupon.title)”核对真实应付金额。")
            let selected: ShoppingCouponPage = try await script("Coupon", "select", ["key": key])
            guard ["selected", "already-selected"].contains(selected.status) else { throw fail(selected.message) }
            try await pause(650_000_000)
            var state = try await couponPage()
            for _ in 0..<20 {
                if state.kind != "coupons" || state.coupons.contains(where: { $0.key == key && $0.selected }) { break }
                try await pause()
                state = try await couponPage()
            }
            if state.kind == "coupons" {
                guard state.coupons.contains(where: { $0.key == key && $0.selected && $0.available && !$0.requiresRedemption }) else {
                    throw fail("没有核实到指定已有券已选中，未读取试价结果。")
                }
                if state.selectionNeedsConfirm {
                    guard state.canConfirm else { throw fail("已有券选择尚不能安全确认。") }
                    let confirmed: ShoppingCouponPage = try await script("Coupon", "confirm")
                    guard confirmed.status == "confirmed" else { throw fail(confirmed.message) }
                    try await pause(650_000_000)
                } else {
                    try await closeCoupons(checkoutURL: checkoutURL)
                }
            }
            if webView.url != checkoutURL { try await returnTo(checkoutURL) }
            try await awaitCheckout()
            try await collectQuote(product: product, basket: basket,
                                   coverage: "已有券：\(coupon.title)。" + scope)
        }
        if candidates.count > 5 { note("本篮已达到 6 种优惠选择上限，更多已有券尚未遍历。") }
    }

    func collectQuote(product: String, basket: [ShoppingCartLine], coverage: String) async throws {
        var last = ""
        var stable = 0
        for _ in 0..<30 {
            try await pause()
            guard !webView.isLoading else { stable = 0; continue }
            guard let url = webView.url, url == checkoutContextURL,
                  (platform == .meituan ? url.host == "h5.waimai.meituan.com" && url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "waimai/mindex/preview"
                   : url.host == "h5.ele.me" && url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) == "checkout") else {
                stable = 0
                continue
            }
            let probe: PageProbe = try await script("Probe", "inspect")
            if probe.hasLoginInput { throw fail("结算需要重新登录或验证，请在官方网页处理。") }
            if probe.addressRequired == true { throw fail("结算尚未选择收货地址，当前金额不作为有效报价。") }
            let amounts = Set(probe.prices.map(\.cents))
            guard probe.checkoutLikely, probe.addressRequired == false, amounts.count == 1,
                  let amount = amounts.first, amount >= 0, probe.deliveryHints.count == 1 else {
                stable = 0
                continue
            }
            let fingerprint = "\(amount)|\(probe.deliveryHints[0])"
            stable = fingerprint == last ? stable + 1 : 1
            last = fingerprint
            guard stable >= 3 else { continue }
            let observed = Date()
            guard let latest = Self.latestArrival(probe.deliveryHints[0], at: observed) else {
                throw fail("送达时间不完整、已过期或无法确定最晚时点，本次不收录报价。")
            }
            let description = basket.map { "\($0.name)\($0.specs.isEmpty ? "" : "（\($0.specs)）") ×\($0.quantity)" }.joined(separator: "；")
            let quote = ShoppingQuote(id: UUID().uuidString, platform: platform, productName: product,
                basketDescription: description, totalCents: amount, etaText: probe.deliveryHints[0],
                latestArrival: latest, observedAt: observed,
                coverageNote: "未检测到缺地址提示；未核实跨平台同地址。" + coverage)
            if !quotes.contains(where: { $0.basketDescription == description && $0.totalCents == amount
                && $0.etaText == quote.etaText && $0.coverageNote == quote.coverageNote }) { quotes.append(quote) }
            let eligible = quotes.filter { $0.totalCents <= budget }
            frontier = eligible.filter { candidate in
                !eligible.contains { other in
                    other.id != candidate.id && other.totalCents <= candidate.totalCents
                        && other.latestArrival <= candidate.latestArrival
                        && (other.totalCents < candidate.totalCents || other.latestArrival < candidate.latestArrival)
                }
            }.sorted { $0.totalCents == $1.totalCents ? $0.latestArrival < $1.latestArrival : $0.totalCents < $1.totalCents }
            note("已核实应付 ¥\(String(format: "%.2f", Double(amount) / 100))，\(quote.etaText)。")
            return
        }
        throw fail("没有取得稳定且唯一的应付金额、已选地址和完整送达时间，本次不收录报价。")
    }

    static func latestArrival(_ text: String, at observed: Date) -> Date? {
        let value = clean(text)
        func groups(_ pattern: String) -> [String?]? {
            guard let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else { return nil }
            return (1..<match.numberOfRanges).map {
                Range(match.range(at: $0), in: value).map { String(value[$0]) }
            }
        }
        if let part = groups("^预计\\s*(?:送达\\s*)?(\\d{1,3})(?:\\s*[-~～至]\\s*(\\d{1,3}))?\\s*分钟(?:内)?(?:送达)?$"),
           let first = part[0].flatMap(Int.init), let latest = (part[1] ?? part[0]).flatMap(Int.init),
           first > 0, latest >= first, latest <= 360 {
            return observed.addingTimeInterval(Double(latest * 60))
        }
        guard let part = groups("^(?:预计|大约)?\\s*(\\d{1,2}):(\\d{2})\\s*(?:[-~～至—–]\\s*(\\d{1,2}):(\\d{2})\\s*)?送达$"),
              let firstHour = part[0].flatMap(Int.init), let firstMinute = part[1].flatMap(Int.init),
              let lastHour = (part[2] ?? part[0]).flatMap(Int.init),
              let lastMinute = (part[3] ?? part[1]).flatMap(Int.init),
              (0...23).contains(firstHour), (0...23).contains(lastHour),
              (0...59).contains(firstMinute), (0...59).contains(lastMinute) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        guard let start = calendar.date(bySettingHour: firstHour, minute: firstMinute, second: 0, of: observed),
              var end = calendar.date(bySettingHour: lastHour, minute: lastMinute, second: 0, of: observed) else { return nil }
        if part[2] != nil && end < start { end = end.addingTimeInterval(86_400) }
        if end < observed.addingTimeInterval(-60) {
            guard calendar.component(.hour, from: observed) >= 18, lastHour <= 6 else { return nil }
            end = end.addingTimeInterval(86_400)
        }
        guard end >= observed.addingTimeInterval(-60), end.timeIntervalSince(observed) <= 21_600 else { return nil }
        return end
    }
}
