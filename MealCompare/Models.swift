import Foundation
import Combine

enum DeliveryPlatform: String, CaseIterable, Identifiable, Codable {
    case meituan, eleme
    var id: String { rawValue }
    var name: String { self == .meituan ? "美团外卖" : "饿了么" }
    var homeURL: URL {
        URL(string: self == .meituan
            ? "https://h5.waimai.meituan.com/waimai/mindex/home"
            : "https://h5.ele.me/")!
    }
    // Stable identities preserve each platform's own WebKit profile across launches.
    var profileID: UUID {
        UUID(uuidString: self == .meituan
             ? "0DB18220-1EC7-422A-85B2-F95632350D11"
             : "7A81D05F-0728-423E-8845-FE2D15011233")!
    }
}

struct PriceCandidate: Codable, Equatable {
    let label: String
    let cents: Int
    var formatted: String {
        "¥\(cents / 100).\(String(format: "%02d", cents % 100))"
    }
}

struct PageProbe: Codable {
    let version: Int
    let origin: String
    let searchInputCount: Int
    let hasLoginInput: Bool
    let hasCouponText: Bool
    let checkoutLikely: Bool
    let hasOpenAppHint: Bool
    let prices: [PriceCandidate]
    let deliveryHints: [String]
}

struct SearchOutcome: Decodable {
    let status: String
    let message: String
}

struct ValidationNotes: Codable {
    var canLogIn = false
    var canReachCheckout = false
    var sameBasketAndAddress = false
    var couponsMatchApp = false
    var priceMatchesApp = false
    var loginSurvivesRestart = false
}

struct PlatformReport: Codable {
    let platform: DeliveryPlatform
    let probe: PageProbe?
    let inspectedAt: Date?
    let notes: ValidationNotes
}

struct FeasibilityReport: Codable {
    let schemaVersion: Int
    let appVersion: String
    let generatedAt: Date
    let stage: String
    let platforms: [PlatformReport]
}

@MainActor
final class AppModel: ObservableObject {
    let meituan = PlatformSession(platform: .meituan)
    let eleme = PlatformSession(platform: .eleme)
    var sessions: [PlatformSession] { [meituan, eleme] }

    func searchBoth(_ query: String) {
        for session in sessions { session.search(query) }
    }

    func reportURL() throws -> URL {
        let report = FeasibilityReport(
            schemaVersion: 1, appVersion: "0.1.0", generatedAt: Date(),
            stage: "feasibility-prototype-not-verified-comparison",
            platforms: sessions.map {
                PlatformReport(platform: $0.platform, probe: $0.probe,
                               inspectedAt: $0.inspectedAt, notes: $0.notes)
            })
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("饭价-验证报告.json")
        try encoder.encode(report).write(to: url, options: .atomic)
        return url
    }
}
