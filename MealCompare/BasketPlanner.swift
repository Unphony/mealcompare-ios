import Foundation

/// One exact, available specification. Coverage must describe every included item,
/// including drinks or sides supplied by a set meal; it is not inferred from its name.
struct BasketPlanSKU: Codable, Equatable {
    let id: String
    let unitPriceCents: Int
    let availableQuantity: Int
    let coverage: [String: Int]
}

struct BasketPlanLine: Codable, Equatable {
    let skuID: String
    let quantity: Int
}

struct BasketPlanRequest: Codable, Equatable {
    let catalog: [BasketPlanSKU]
    /// The caller supplies an already matched, complete basket for the requested food.
    /// Run a separate plan for a different base meal or specification.
    let baseBasket: [BasketPlanLine]
    let optionalSKUIds: [String]
    let requiredItems: [String: Int]
    let budgetCents: Int
    let maxExtraQuantity: Int
    let maxCandidates: Int
    let maxVisitedCombinations: Int
    /// Only observed thresholds may be supplied. These order trials, never certify a coupon.
    let minimumSpendHints: [Int]

    init(
        catalog: [BasketPlanSKU], baseBasket: [BasketPlanLine],
        optionalSKUIds: [String], requiredItems: [String: Int],
        budgetCents: Int, maxExtraQuantity: Int,
        maxCandidates: Int = 20, maxVisitedCombinations: Int = 2_000,
        minimumSpendHints: [Int] = []
    ) {
        self.catalog = catalog
        self.baseBasket = baseBasket
        self.optionalSKUIds = optionalSKUIds
        self.requiredItems = requiredItems
        self.budgetCents = budgetCents
        self.maxExtraQuantity = maxExtraQuantity
        self.maxCandidates = maxCandidates
        self.maxVisitedCombinations = maxVisitedCombinations
        self.minimumSpendHints = minimumSpendHints
    }
}

struct BasketPlanCandidate: Codable, Equatable {
    let lines: [BasketPlanLine]
    let coverage: [String: Int]
    /// Merchandise subtotal only. Delivery, packaging and personal discounts are unknown.
    let merchandiseSubtotalCents: Int
    let extraQuantity: Int
    let isBaseBasket: Bool
}

enum BasketPlanValidationError: String, Codable {
    case invalidBudget, invalidLimits, invalidRequiredItems, invalidThreshold
    case invalidSKU, duplicateSKU, unknownSKU, invalidBaseBasket
    case missingRequiredCoverage, baseExceedsExtraLimit, arithmeticOverflow
}

struct BasketPlanResult: Codable, Equatable {
    let checkoutBudgetCents: Int
    let candidates: [BasketPlanCandidate]
    let visitedCombinations: Int
    /// Refers only to combinations of the supplied base basket and optional SKU catalog.
    let searchSpaceExhausted: Bool
    let candidatesTruncated: Bool
    let arithmeticOverflowEncountered: Bool
    let validationError: BasketPlanValidationError?

    var searchLimitReached: Bool { validationError == nil && !searchSpaceExhausted }
    var isComplete: Bool {
        validationError == nil && searchSpaceExhausted
            && !candidatesTruncated && !arithmeticOverflowEncountered
    }
}

enum BasketPlanner {
    /// Generates bounded checkout trials, not prices or a claim of global optimality.
    /// Original-price baskets ABOVE the budget are deliberately retained: only a real
    /// checkout can determine whether account coupons bring their payable below budget.
    static func plan(_ request: BasketPlanRequest) -> BasketPlanResult {
        func invalid(_ error: BasketPlanValidationError) -> BasketPlanResult {
            BasketPlanResult(checkoutBudgetCents: request.budgetCents, candidates: [],
                             visitedCombinations: 0, searchSpaceExhausted: false,
                             candidatesTruncated: false,
                             arithmeticOverflowEncountered: error == .arithmeticOverflow,
                             validationError: error)
        }
        guard request.budgetCents >= 0 else { return invalid(.invalidBudget) }
        guard request.maxExtraQuantity >= 0, request.maxCandidates > 0,
              request.maxVisitedCombinations > 0 else { return invalid(.invalidLimits) }
        guard !request.requiredItems.isEmpty,
              request.requiredItems.allSatisfy({ hasText($0.key) && $0.value > 0 })
        else { return invalid(.invalidRequiredItems) }
        guard request.minimumSpendHints.allSatisfy({ $0 >= 0 })
        else { return invalid(.invalidThreshold) }

        var catalog: [String: BasketPlanSKU] = [:]
        var unitsPerSKU: [String: Int] = [:]
        for sku in request.catalog {
            guard hasText(sku.id), sku.unitPriceCents >= 0, sku.availableQuantity >= 0,
                  !sku.coverage.isEmpty,
                  sku.coverage.allSatisfy({ hasText($0.key) && $0.value > 0 })
            else { return invalid(.invalidSKU) }
            guard catalog[sku.id] == nil else { return invalid(.duplicateSKU) }
            var units = 0
            for value in sku.coverage.values {
                guard let sum = adding(units, value) else { return invalid(.arithmeticOverflow) }
                units = sum
            }
            catalog[sku.id] = sku
            unitsPerSKU[sku.id] = units
        }
        guard !request.baseBasket.isEmpty else { return invalid(.invalidBaseBasket) }
        var baseQuantities: [String: Int] = [:]
        for line in request.baseBasket {
            guard let sku = catalog[line.skuID] else { return invalid(.unknownSKU) }
            guard line.quantity > 0 else { return invalid(.invalidBaseBasket) }
            guard let quantity = adding(baseQuantities[line.skuID] ?? 0, line.quantity)
            else { return invalid(.arithmeticOverflow) }
            guard quantity <= sku.availableQuantity else { return invalid(.invalidBaseBasket) }
            baseQuantities[line.skuID] = quantity
        }
        let optionalIDs = Set(request.optionalSKUIds).sorted()
        guard optionalIDs.allSatisfy({ catalog[$0] != nil }) else { return invalid(.unknownSKU) }
        guard let base = buildCandidate(quantities: baseQuantities, catalog: catalog,
                                       required: request.requiredItems, isBase: true)
        else { return invalid(.arithmeticOverflow) }
        guard request.requiredItems.allSatisfy({ (base.coverage[$0.key] ?? 0) >= $0.value })
        else { return invalid(.missingRequiredCoverage) }
        guard base.extraQuantity <= request.maxExtraQuantity
        else { return invalid(.baseExceedsExtraLimit) }

        let remainingExtras = request.maxExtraQuantity - base.extraQuantity
        // Each dimension is bounded by stock and the user's extra-item limit.
        // Mixed-radix iteration avoids recursion, even for unusually large limits.
        let bounds = optionalIDs.map { id in
            min(catalog[id]!.availableQuantity - (baseQuantities[id] ?? 0),
                remainingExtras / unitsPerSKU[id]!)
        }
        var quantities = Array(repeating: 0, count: optionalIDs.count)
        var retained: [BasketPlanCandidate] = []
        var visited = 0
        var exhausted = false
        var truncated = false
        var overflow = false
        let hints = Set(request.minimumSpendHints).sorted()

        while true {
            visited += 1 // Bounded by the strictly positive maxVisitedCombinations.
            var extra = base.extraQuantity
            var fitsExtraLimit = true
            var basket = baseQuantities
            for (index, id) in optionalIDs.enumerated() where quantities[index] > 0 {
                // Per-dimension bounds guarantee this multiplication cannot overflow.
                let addedUnits = quantities[index] * unitsPerSKU[id]!
                guard addedUnits <= request.maxExtraQuantity - extra else {
                    fitsExtraLimit = false
                    break
                }
                extra += addedUnits
                // The stock bound guarantees the total SKU quantity is representable.
                basket[id] = (baseQuantities[id] ?? 0) + quantities[index]
            }
            if fitsExtraLimit {
                if let candidate = buildCandidate(quantities: basket, catalog: catalog,
                                                  required: request.requiredItems,
                                                  isBase: quantities.allSatisfy({ $0 == 0 })) {
                    retained.append(candidate)
                    retained.sort { ranksBefore($0, $1, hints: hints) }
                    if retained.count > request.maxCandidates {
                        retained.removeLast()
                        truncated = true
                    }
                } else {
                    overflow = true
                }
            }
            guard advance(&quantities, bounds: bounds) else {
                exhausted = true
                break
            }
            if visited == request.maxVisitedCombinations { break }
        }
        return BasketPlanResult(checkoutBudgetCents: request.budgetCents, candidates: retained,
                                visitedCombinations: visited, searchSpaceExhausted: exhausted,
                                candidatesTruncated: truncated,
                                arithmeticOverflowEncountered: overflow, validationError: nil)
    }

    private static func buildCandidate(
        quantities: [String: Int], catalog: [String: BasketPlanSKU],
        required: [String: Int], isBase: Bool
    ) -> BasketPlanCandidate? {
        var subtotal = 0
        var coverage: [String: Int] = [:]
        for (id, quantity) in quantities {
            let sku = catalog[id]!
            guard let amount = multiplying(sku.unitPriceCents, quantity),
                  let total = adding(subtotal, amount) else { return nil }
            subtotal = total
            for (item, units) in sku.coverage {
                guard let count = multiplying(units, quantity),
                      let sum = adding(coverage[item] ?? 0, count) else { return nil }
                coverage[item] = sum
            }
        }
        var extras = 0
        for (item, quantity) in coverage {
            let extra = max(0, quantity - (required[item] ?? 0))
            guard let sum = adding(extras, extra) else { return nil }
            extras = sum
        }
        return BasketPlanCandidate(lines: quantities.keys.sorted().map {
            BasketPlanLine(skuID: $0, quantity: quantities[$0]!)
        }, coverage: coverage, merchandiseSubtotalCents: subtotal,
           extraQuantity: extras, isBaseBasket: isBase)
    }

    private static func advance(_ quantities: inout [Int], bounds: [Int]) -> Bool {
        for index in quantities.indices.reversed() {
            if quantities[index] < bounds[index] {
                quantities[index] += 1
                return true
            }
            quantities[index] = 0
        }
        return false
    }

    private static func ranksBefore(
        _ lhs: BasketPlanCandidate, _ rhs: BasketPlanCandidate, hints: [Int]
    ) -> Bool {
        // Always preserve the baseline, even when only one checkout trial is allowed.
        if lhs.isBaseBasket != rhs.isBaseBasket { return lhs.isBaseBasket }
        if !hints.isEmpty {
            let left = thresholdRank(lhs.merchandiseSubtotalCents, hints: hints)
            let right = thresholdRank(rhs.merchandiseSubtotalCents, hints: hints)
            if left.reached != right.reached { return left.reached }
            if left.distance != right.distance { return left.distance < right.distance }
        }
        if lhs.extraQuantity != rhs.extraQuantity { return lhs.extraQuantity < rhs.extraQuantity }
        if lhs.merchandiseSubtotalCents != rhs.merchandiseSubtotalCents {
            return lhs.merchandiseSubtotalCents < rhs.merchandiseSubtotalCents
        }
        for (left, right) in zip(lhs.lines, rhs.lines) {
            if left.skuID != right.skuID { return left.skuID < right.skuID }
            if left.quantity != right.quantity { return left.quantity < right.quantity }
        }
        return lhs.lines.count < rhs.lines.count
    }

    private static func thresholdRank(_ subtotal: Int, hints: [Int]) -> (reached: Bool, distance: Int) {
        if let threshold = hints.last(where: { $0 <= subtotal }) {
            return (true, subtotal - threshold)
        }
        return (false, hints[0] - subtotal)
    }

    private static func hasText(_ value: String) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func adding(_ lhs: Int, _ rhs: Int) -> Int? {
        let value = lhs.addingReportingOverflow(rhs)
        return value.overflow ? nil : value.partialValue
    }

    private static func multiplying(_ lhs: Int, _ rhs: Int) -> Int? {
        let value = lhs.multipliedReportingOverflow(by: rhs)
        return value.overflow ? nil : value.partialValue
    }
}
