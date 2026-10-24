import Foundation

/// Canonical identifiers describe the same dish, specification and portion on each platform.
struct BasketItem: Codable, Equatable {
    let canonicalID: String
    let quantity: Int
}

/// A quote is comparable only after its total has been read from a real checkout.
struct MealQuote: Codable, Equatable, Identifiable {
    let id: String
    let platform: String
    let storeKey: String
    let addressKey: String
    let items: [BasketItem]
    let totalCents: Int
    let etaMinutes: Int
    let isCheckoutVerified: Bool
}

struct ComparisonRequest: Codable, Equatable {
    let budgetCents: Int
    let requiredItems: [String: Int]
    let storeKey: String
    let addressKey: String
    let maxExtraQuantity: Int?
    let allowedExtraItemIDs: Set<String>?

    init(
        budgetCents: Int,
        requiredItems: [String: Int],
        storeKey: String,
        addressKey: String,
        maxExtraQuantity: Int? = nil,
        allowedExtraItemIDs: Set<String>? = nil
    ) {
        self.budgetCents = budgetCents
        self.requiredItems = requiredItems
        self.storeKey = storeKey
        self.addressKey = addressKey
        self.maxExtraQuantity = maxExtraQuantity
        self.allowedExtraItemIDs = allowedExtraItemIDs
    }
}

enum ComparisonEngine {
    /// Applies the user's constraints without calculating or guessing discounts.
    /// Missing/invalid request fields or quote fields cannot produce a recommendation.
    static func eligibleQuotes(
        from quotes: [MealQuote],
        for request: ComparisonRequest
    ) -> [MealQuote] {
        guard valid(request) else { return [] }
        return quotes.filter { eligible($0, for: request) }
    }

    /// A no-dearer basket dominates only if it contains every exact food/specification
    /// and is cheaper or contains more. ETA is displayed but never ranks food quantity.
    static func paretoOptimalQuotes(
        from quotes: [MealQuote],
        for request: ComparisonRequest
    ) -> [MealQuote] {
        let candidates = eligibleQuotes(from: quotes, for: request)
        return candidates.filter { candidate in
            !candidates.contains { other in
                dominates(items: other.items, price: other.totalCents,
                          over: candidate.items, price: candidate.totalCents)
            }
        }
    }

    static func dominates(items richer: [BasketItem], price richerPrice: Int,
                          over smaller: [BasketItem], price smallerPrice: Int) -> Bool {
        guard richerPrice <= smallerPrice else { return false }
        func amounts(_ items: [BasketItem]) -> [String: Int]? {
            var result: [String: Int] = [:]
            for item in items {
                guard hasText(item.canonicalID), item.quantity > 0 else { return nil }
                let sum = (result[item.canonicalID] ?? 0).addingReportingOverflow(item.quantity)
                guard !sum.overflow else { return nil }
                result[item.canonicalID] = sum.partialValue
            }
            return result.isEmpty ? nil : result
        }
        guard let a = amounts(richer), let b = amounts(smaller),
              b.allSatisfy({ (a[$0.key] ?? 0) >= $0.value }) else { return false }
        return richerPrice < smallerPrice || a.contains { $0.value > (b[$0.key] ?? 0) }
    }

    private static func valid(_ request: ComparisonRequest) -> Bool {
        guard request.budgetCents >= 0,
              hasText(request.storeKey),
              hasText(request.addressKey),
              !request.requiredItems.isEmpty,
              request.requiredItems.allSatisfy({ hasText($0.key) && $0.value > 0 })
        else { return false }

        if let maximum = request.maxExtraQuantity, maximum < 0 { return false }
        if let allowed = request.allowedExtraItemIDs,
           !allowed.allSatisfy({ hasText($0) }) { return false }
        return true
    }

    private static func eligible(_ quote: MealQuote, for request: ComparisonRequest) -> Bool {
        guard hasText(quote.id),
              hasText(quote.platform),
              quote.storeKey == request.storeKey,
              quote.addressKey == request.addressKey,
              quote.isCheckoutVerified,
              quote.totalCents >= 0,
              quote.totalCents <= request.budgetCents,
              quote.etaMinutes > 0,
              !quote.items.isEmpty
        else { return false }

        // A basket may contain multiple lines for the same canonical product.
        var quantities: [String: Int] = [:]
        for item in quote.items {
            guard hasText(item.canonicalID), item.quantity > 0 else { return false }
            let sum = (quantities[item.canonicalID] ?? 0).addingReportingOverflow(item.quantity)
            guard !sum.overflow else { return false }
            quantities[item.canonicalID] = sum.partialValue
        }

        guard request.requiredItems.allSatisfy({
            (quantities[$0.key] ?? 0) >= $0.value
        }) else { return false }

        var extraQuantity = 0
        for (canonicalID, quantity) in quantities {
            let extra = quantity - (request.requiredItems[canonicalID] ?? 0)
            guard extra > 0 else { continue }
            if let allowed = request.allowedExtraItemIDs,
               !allowed.contains(canonicalID) { return false }
            let sum = extraQuantity.addingReportingOverflow(extra)
            guard !sum.overflow else { return false }
            extraQuantity = sum.partialValue
        }

        if let maximum = request.maxExtraQuantity, extraQuantity > maximum { return false }
        return true
    }

    private static func hasText(_ value: String) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
