import Foundation
import Combine
import WebKit

struct MealRecipe: Codable, Identifiable, Equatable {
    let id: String
    let storeName: String
    let productName: String
    let specifications: String
    let quantity: Int
    let budgetCents: Int
    let platform: DeliveryPlatform?
    let source: String
}

/// A local index of known meals, never a cache of current prices or coupon eligibility.
@MainActor
final class MealHistoryLibrary: ObservableObject {
    @Published private(set) var recipes: [MealRecipe]
    @Published private(set) var importMessage = ""
    @Published private(set) var isImporting = false
    private let storageKey = "known-meals.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let saved = try? JSONDecoder().decode([MealRecipe].self, from: data) {
            recipes = saved
        } else {
            // User-specified test meals. These are not represented as imported purchase history.
            recipes = [
                MealRecipe(id: "user-burgerking", storeName: "汉堡王", productName: "双层厚鸡堡4件套",
                           specifications: "", quantity: 1, budgetCents: 3_000,
                           platform: nil, source: "用户指定"),
                MealRecipe(id: "user-niuyuebao", storeName: "牛约堡", productName: "经典招牌牛肉堡",
                           specifications: "", quantity: 1, budgetCents: 3_000,
                           platform: nil, source: "用户指定")
            ]
        }
    }

    func remove(_ id: String) {
        recipes.removeAll { $0.id == id }
        save()
    }

    func importCurrentPage(_ webView: WKWebView, platform: DeliveryPlatform) {
        guard !isImporting else { return }
        isImporting = true
        importMessage = "正在读取当前历史订单页"
        Task {
            defer { isImporting = false }
            do {
                guard !webView.isLoading, let pageURL = webView.url,
                      let resource = Bundle.main.url(forResource: "History", withExtension: "js") else {
                    importMessage = "请先打开平台历史订单页；当前版本尚未适配的页面不会读取。"
                    return
                }
                let script = try String(contentsOf: resource, encoding: .utf8)
                    .replacingOccurrences(of: "__MEAL_HISTORY_REQUEST__", with: "{\"action\":\"read\"}")
                let raw = try await webView.evaluateJavaScript(script)
                guard webView.url == pageURL, let json = raw as? String,
                      let data = json.data(using: .utf8) else {
                    importMessage = "页面已变化，请在历史订单页重新读取。"
                    return
                }
                let result = try JSONDecoder().decode(HistoryReadout.self, from: data)
                guard result.status == "ready" else { importMessage = result.message; return }
                var added = 0
                for order in (result.entries ?? []).prefix(20) {
                    guard !order.storeName.isEmpty else { continue }
                    for item in order.items.prefix(20) where !item.name.isEmpty && item.quantity > 0 {
                        let specs = item.specs ?? ""
                        guard !recipes.contains(where: {
                            $0.platform == platform && $0.storeName == order.storeName
                                && $0.productName == item.name && $0.specifications == specs
                        }) else { continue }
                        recipes.append(MealRecipe(id: UUID().uuidString, storeName: order.storeName,
                            productName: item.name, specifications: specs, quantity: item.quantity,
                            budgetCents: 3_000, platform: platform, source: "历史订单"))
                        added += 1
                    }
                }
                save()
                importMessage = "\(result.message) 已新增 \(added) 条常买餐品。历史金额不作为当前报价；下次仍会重新核对规格、优惠与应付额。"
            } catch {
                importMessage = "当前订单页暂未读到完整餐品信息：\(error.localizedDescription)"
            }
        }
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(recipes) else { return }
        UserDefaults.standard.set(data, forKey: storageKey)
    }
}

private struct HistoryReadout: Decodable {
    let status: String
    let message: String
    let entries: [HistoryMeal]?
}

private struct HistoryMeal: Decodable {
    let storeName: String
    let items: [HistoryMealItem]
}

private struct HistoryMealItem: Decodable {
    let name: String
    let specs: String?
    let quantity: Int
}
