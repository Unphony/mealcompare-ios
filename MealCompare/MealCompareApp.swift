import SwiftUI

@main
struct MealCompareApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .tint(Color(red: 0.08, green: 0.48, blue: 0.39))
        }
    }
}
