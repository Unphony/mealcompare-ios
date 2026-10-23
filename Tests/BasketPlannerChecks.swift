import Foundation

/// swiftc MealCompare/BasketPlanner.swift Tests/BasketPlannerChecks.swift -o basket-checks
/// ./basket-checks
@main
struct BasketPlannerChecks {
    static func main() {
        let burger = sku("burger-regular", price: 2_500, stock: 3, coverage: ["burger": 1])
        let tea = sku("tea-regular", price: 500, stock: 2, coverage: ["tea": 1])
        let largeTea = sku("tea-large", price: 700, stock: 1, coverage: ["tea": 1])
        let defaultCatalog = [burger, tea, largeTea]

        let aboveBudget = plan(catalog: defaultCatalog, optional: ["tea-regular"],
                               budget: 2_000, maxExtras: 1)
        check(aboveBudget.candidates.map(\.merchandiseSubtotalCents) == [2_500, 3_000]
              && aboveBudget.checkoutBudgetCents == 2_000 && aboveBudget.isComplete,
              "Original-price baskets above budget still reach real checkout trials")

        let specs = plan(catalog: defaultCatalog,
                         optional: ["tea-regular", "tea-large", "tea-regular"], maxExtras: 2)
        check(specs.candidates.count == 5
              && specs.candidates.contains { $0.lines.contains(BasketPlanLine(skuID: "tea-large", quantity: 1)) }
              && Set(specs.candidates.map { String(describing: $0.lines) }).count == 5,
              "Exact specification IDs stay distinct; duplicate optional IDs do not duplicate trials")
        check(specs.candidates.allSatisfy { candidate in
            candidate.extraQuantity <= 2 && candidate.lines.allSatisfy {
                $0.skuID != "tea-large" || $0.quantity <= 1
            }
        }, "Stock and total extra units constrain every generated basket")

        let sameSKU = plan(catalog: defaultCatalog,
                           base: [line("burger-regular", 1), line("burger-regular", 1)],
                           optional: ["burger-regular"], required: ["burger": 2], maxExtras: 4)
        check(sameSKU.candidates.count == 2
              && sameSKU.candidates.first?.lines == [line("burger-regular", 2)]
              && sameSKU.candidates.last?.lines == [line("burger-regular", 3)],
              "Repeated base lines aggregate and extras share the same SKU stock limit")

        let combo = sku("burger-set", price: 2_900, stock: 2, coverage: ["burger": 1, "tea": 1])
        let comboPlan = plan(catalog: [combo, tea], base: [line("burger-set", 1)],
                             optional: ["tea-regular"], maxExtras: 1)
        check(comboPlan.candidates.count == 1 && comboPlan.candidates[0].extraQuantity == 1
              && comboPlan.candidates[0].coverage == ["burger": 1, "tea": 1],
              "A set meal covers the target and its included side consumes the extra-unit limit")
        check(plan(catalog: [combo], base: [line("burger-set", 1)], maxExtras: 0)
            .validationError == .baseExceedsExtraLimit,
              "The base basket cannot bypass the user's extra-item constraint")
        check(plan(catalog: [tea], base: [line("tea-regular", 1)])
            .validationError == .missingRequiredCoverage,
              "A base basket missing the requested food is rejected")

        let candidateLimit = plan(catalog: defaultCatalog, optional: ["tea-regular"],
                                  maxExtras: 2, maxCandidates: 1)
        check(candidateLimit.candidates.count == 1 && candidateLimit.candidates[0].isBaseBasket
              && candidateLimit.candidatesTruncated && candidateLimit.searchSpaceExhausted
              && !candidateLimit.isComplete && !candidateLimit.searchLimitReached,
              "Candidate retention truncation is distinguished from search truncation")
        let visitLimit = plan(catalog: defaultCatalog, optional: ["tea-regular"],
                              maxExtras: 2, maxVisits: 1)
        check(visitLimit.visitedCombinations == 1 && visitLimit.searchLimitReached
              && !visitLimit.searchSpaceExhausted && !visitLimit.isComplete,
              "Traversal stops at its exact visit limit and reports an incomplete search")
        let exhaustedAtLimit = plan(catalog: defaultCatalog, maxVisits: 1)
        check(exhaustedAtLimit.visitedCombinations == 1 && exhaustedAtLimit.isComplete,
              "Finishing the entire search at the visit limit is still complete")

        let hints = plan(catalog: defaultCatalog, optional: ["tea-regular"],
                         maxExtras: 2, maxCandidates: 2, hints: [3_500])
        check(hints.candidates.map(\.merchandiseSubtotalCents) == [2_500, 3_500]
              && hints.candidatesTruncated,
              "Observed thresholds rank trials without replacing the base or predicting a discount")
        let free = sku("free-side", price: 0, stock: 1, coverage: ["side": 1])
        check(plan(catalog: [burger, free], optional: ["free-side"], maxExtras: 1)
            .candidates.count == 2, "A genuinely zero-priced available SKU is allowed")

        check(plan(catalog: [burger, burger]).validationError == .duplicateSKU,
              "Duplicate catalog IDs are rejected instead of merging ambiguous specifications")
        check(plan(catalog: [sku("burger-regular", price: -1, stock: 1, coverage: ["burger": 1])])
            .validationError == .invalidSKU, "Negative prices are rejected")
        check(plan(catalog: [sku("burger-regular", price: 100, stock: -1, coverage: ["burger": 1])])
            .validationError == .invalidSKU, "Negative stock is rejected")
        check(plan(catalog: [sku("burger-regular", price: 100, stock: 1, coverage: ["burger": 0])])
            .validationError == .invalidSKU, "Incomplete or zero-count SKU coverage is rejected")
        check(plan(catalog: defaultCatalog, optional: ["unknown"]).validationError == .unknownSKU,
              "Unknown optional IDs fail validation")
        check(plan(catalog: defaultCatalog, base: [line("burger-regular", 4)])
            .validationError == .invalidBaseBasket, "Base basket respects available quantity")
        check(plan(catalog: defaultCatalog, budget: -1).validationError == .invalidBudget
              && plan(catalog: defaultCatalog, maxCandidates: 0).validationError == .invalidLimits
              && plan(catalog: defaultCatalog, maxVisits: 0).validationError == .invalidLimits
              && plan(catalog: defaultCatalog, hints: [-1]).validationError == .invalidThreshold,
              "Invalid budget, limits and thresholds are explicit validation failures")

        let enormous = sku("burger-regular", price: Int.max, stock: 2, coverage: ["burger": 1])
        check(plan(catalog: [enormous], base: [line("burger-regular", 2)], required: ["burger": 2])
            .validationError == .arithmeticOverflow, "Base subtotal multiplication rejects overflow")
        let optionalOverflow = plan(catalog: [enormous, tea], optional: ["tea-regular"], maxExtras: 1)
        check(optionalOverflow.candidates.count == 1 && optionalOverflow.arithmeticOverflowEncountered
              && optionalOverflow.searchSpaceExhausted && !optionalOverflow.isComplete,
              "An unrepresentable extra basket is omitted with an explicit incompleteness flag")
        let quantityOverflow = plan(catalog: [sku("burger-regular", price: 0, stock: Int.max,
                                                coverage: ["burger": 1])],
                                    base: [line("burger-regular", Int.max), line("burger-regular", 1)])
        check(quantityOverflow.validationError == .arithmeticOverflow,
              "Duplicate-line quantity aggregation rejects overflow")
        let coverageOverflow = plan(catalog: [sku("burger-regular", price: 0, stock: 1,
                                                 coverage: ["burger": Int.max, "tea": 1])])
        check(coverageOverflow.validationError == .arithmeticOverflow,
              "Set-meal content counts cannot overflow the extra-item accounting")
        let hugeBounds = plan(catalog: [sku("burger-regular", price: 0, stock: Int.max,
                                          coverage: ["burger": 1])],
                              optional: ["burger-regular"], maxExtras: Int.max, maxVisits: 2)
        check(hugeBounds.visitedCombinations == 2 && hugeBounds.searchLimitReached,
              "Huge quantity bounds remain bounded without recursion or search-space multiplication")

        print("Passed 24 basket planner checks.")
    }

    private static func sku(_ id: String, price: Int, stock: Int, coverage: [String: Int]) -> BasketPlanSKU {
        BasketPlanSKU(id: id, unitPriceCents: price, availableQuantity: stock, coverage: coverage)
    }

    private static func line(_ id: String, _ quantity: Int) -> BasketPlanLine {
        BasketPlanLine(skuID: id, quantity: quantity)
    }

    private static func plan(
        catalog: [BasketPlanSKU], base: [BasketPlanLine] = [BasketPlanLine(skuID: "burger-regular", quantity: 1)],
        optional: [String] = [], required: [String: Int] = ["burger": 1],
        budget: Int = 3_000, maxExtras: Int = 0, maxCandidates: Int = 20,
        maxVisits: Int = 2_000, hints: [Int] = []
    ) -> BasketPlanResult {
        BasketPlanner.plan(BasketPlanRequest(catalog: catalog, baseBasket: base,
                                            optionalSKUIds: optional, requiredItems: required,
                                            budgetCents: budget, maxExtraQuantity: maxExtras,
                                            maxCandidates: maxCandidates,
                                            maxVisitedCombinations: maxVisits, minimumSpendHints: hints))
    }

    private static func check(_ value: @autoclosure () -> Bool, _ message: String,
                              file: StaticString = #file, line: UInt = #line) {
        assert(value(), message, file: file, line: line)
    }
}
