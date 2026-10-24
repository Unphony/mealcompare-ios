import Foundation

/// Run on a host with Swift:
/// swiftc MealCompare/ComparisonEngine.swift Tests/ComparisonEngineChecks.swift -o comparison-checks
/// ./comparison-checks
@main
struct ComparisonEngineChecks {
    static func main() {
        let request = ComparisonRequest(
            budgetCents: 3_000,
            requiredItems: ["chicken-burger-regular": 1],
            storeKey: "store-a",
            addressKey: "home"
        )

        checkIDs(eligible([quote("exact", price: 3_000), quote("over", price: 3_001)], request),
                 ["exact"], "Budget is inclusive and compared in integer cents")
        checkIDs(eligible([quote("free", price: 0), quote("negative", price: -1)], request),
                 ["free"], "A verified zero-price checkout is valid; a negative total is not")

        checkIDs(eligible([
            quote("same"),
            quote("branch", store: "store-b"),
            quote("office", address: "office"),
            quote("unverified", verified: false)
        ], request), ["same"], "Store, delivery address and checkout verification must match")

        let twoBurgers = ComparisonRequest(
            budgetCents: 3_000,
            requiredItems: ["chicken-burger-regular": 2],
            storeKey: "store-a", addressKey: "home"
        )
        checkIDs(eligible([
            quote("one"),
            quote("two", items: [burger(2)]),
            quote("split-lines", items: [burger(1), burger(1)]),
            quote("wrong-size", items: [BasketItem(canonicalID: "chicken-burger-small", quantity: 2)])
        ], twoBurgers), ["two", "split-lines"], "Required quantities aggregate exact canonical products")

        let twoTargets = ComparisonRequest(
            budgetCents: 3_000,
            requiredItems: ["chicken-burger-regular": 1, "tea": 1],
            storeKey: "store-a", addressKey: "home", maxExtraQuantity: 0
        )
        checkIDs(eligible([
            quote("missing-tea"),
            quote("both-targets", items: [burger(1), BasketItem(canonicalID: "tea", quantity: 1)])
        ], twoTargets), ["both-targets"], "Every requested product is required and is excluded from extras")

        let combo = quote("combo", items: [burger(1), BasketItem(canonicalID: "tea", quantity: 2)])
        checkIDs(eligible([combo], request), ["combo"], "Nil extra constraints allow any extras within budget")

        let oneExtra = constrainedRequest(maximum: 1)
        checkIDs(eligible([
            quote("no-extra"),
            quote("one-extra", items: [burger(1), BasketItem(canonicalID: "tea", quantity: 1)]),
            combo
        ], oneExtra), ["no-extra", "one-extra"], "Extra units, rather than distinct item names, count")

        let teaOnly = constrainedRequest(maximum: 3, allowed: ["tea"])
        checkIDs(eligible([
            quote("no-extra"), combo,
            quote("fries", items: [burger(1), BasketItem(canonicalID: "fries", quantity: 1)]),
            quote("extra-burger", items: [burger(2)])
        ], teaOnly), ["no-extra", "combo"], "Allowed extras restrict every quantity beyond the required basket")

        checkIDs(eligible([quote("exact"), combo], constrainedRequest(allowed: [])),
                 ["exact"], "An empty allowed set permits no extras")
        checkIDs(eligible([quote("exact"), quote("extra", items: [burger(2)])],
                          constrainedRequest(maximum: 0)),
                 ["exact"], "Extra copies of the requested food count towards the limit")

        let frontier = ComparisonEngine.paretoOptimalQuotes(from: [
            quote("cheap-slow", price: 1_800, eta: 45),
            quote("balanced", price: 2_200, eta: 30),
            quote("same-price-slower", price: 2_200, eta: 31),
            quote("same-time-dearer", price: 2_201, eta: 30),
            quote("dearer-slower", price: 2_700, eta: 40),
            quote("fast", price: 2_800, eta: 20),
            quote("balanced-other-platform", platform: "饿了么", price: 2_200, eta: 30),
            quote("unverified-winner", price: 1, eta: 1, verified: false),
            quote("over-budget-fast", price: 3_001, eta: 1)
        ], for: request)
        checkIDs(frontier, ["cheap-slow"],
                 "Same food keeps cheapest regardless of ETA; invalid quotes cannot dominate")
        checkIDs(ComparisonEngine.paretoOptimalQuotes(from: [
            quote("base", price: 2_000),
            quote("more-same-price", price: 2_000, items: [burger(2)]),
            quote("different-food", price: 2_000, items: [burger(1), BasketItem(canonicalID: "tea", quantity: 1)]),
            quote("more-dearer", price: 2_500, items: [burger(2)])
        ], for: request), ["more-same-price", "different-food"], "Equal-price superset wins; different contents coexist")

        checkIDs(eligible([
            quote(""), quote("blank-platform", platform: " \n"),
            quote("zero-eta", eta: 0), quote("negative-eta", eta: -1),
            quote("empty", items: []), quote("zero-quantity", items: [burger(0)]),
            quote("negative-quantity", items: [burger(-1)]),
            quote("blank-item", items: [burger(1), BasketItem(canonicalID: " ", quantity: 1)])
        ], request), [], "Malformed quote fields are rejected")

        checkIDs(eligible([
            quote("overflow-item", items: [burger(Int.max), burger(1)]),
            quote("overflow-extras", items: [burger(1),
                BasketItem(canonicalID: "tea", quantity: Int.max),
                BasketItem(canonicalID: "fries", quantity: 1)])
        ], request), [], "Quantity aggregation rejects overflow instead of trapping or wrapping")

        let invalidRequests = [
            ComparisonRequest(budgetCents: -1, requiredItems: ["chicken-burger-regular": 1], storeKey: "store-a", addressKey: "home"),
            ComparisonRequest(budgetCents: 3_000, requiredItems: [:], storeKey: "store-a", addressKey: "home"),
            ComparisonRequest(budgetCents: 3_000, requiredItems: ["chicken-burger-regular": 0], storeKey: "store-a", addressKey: "home"),
            ComparisonRequest(budgetCents: 3_000, requiredItems: [" ": 1], storeKey: "store-a", addressKey: "home"),
            ComparisonRequest(budgetCents: 3_000, requiredItems: ["chicken-burger-regular": 1], storeKey: " ", addressKey: "home"),
            ComparisonRequest(budgetCents: 3_000, requiredItems: ["chicken-burger-regular": 1], storeKey: "store-a", addressKey: "\n"),
            constrainedRequest(maximum: -1), constrainedRequest(allowed: [""])
        ]
        for (index, invalidRequest) in invalidRequests.enumerated() {
            checkIDs(eligible([quote("candidate")], invalidRequest), [], "Invalid request \(index) produces no recommendation")
        }

        checkIDs(ComparisonEngine.paretoOptimalQuotes(from: [], for: request), [], "Empty input produces an empty frontier")
        print("Passed comparison checks.")
    }

    private static func burger(_ quantity: Int) -> BasketItem {
        BasketItem(canonicalID: "chicken-burger-regular", quantity: quantity)
    }

    private static func quote(
        _ id: String,
        platform: String = "美团",
        store: String = "store-a",
        address: String = "home",
        items: [BasketItem] = [BasketItem(canonicalID: "chicken-burger-regular", quantity: 1)],
        price: Int = 2_000,
        eta: Int = 30,
        verified: Bool = true
    ) -> MealQuote {
        MealQuote(id: id, platform: platform, storeKey: store, addressKey: address,
                  items: items, totalCents: price, etaMinutes: eta, isCheckoutVerified: verified)
    }

    private static func constrainedRequest(
        maximum: Int? = nil,
        allowed: Set<String>? = nil
    ) -> ComparisonRequest {
        ComparisonRequest(budgetCents: 3_000, requiredItems: ["chicken-burger-regular": 1],
                          storeKey: "store-a", addressKey: "home", maxExtraQuantity: maximum,
                          allowedExtraItemIDs: allowed)
    }

    private static func eligible(_ quotes: [MealQuote], _ request: ComparisonRequest) -> [MealQuote] {
        ComparisonEngine.eligibleQuotes(from: quotes, for: request)
    }

    private static func checkIDs(
        _ quotes: [MealQuote], _ expected: [String], _ message: String,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        assert(quotes.map(\.id) == expected, message, file: file, line: line)
    }
}
