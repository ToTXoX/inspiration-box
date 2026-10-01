// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InspirationBox",
    platforms: [.macOS(.v13)],
    products: [.executable(name: "InspirationBox", targets: ["InspirationBox"])],
    targets: [
        .target(name: "InspirationCore"),
        .executableTarget(name: "InspirationBox", dependencies: ["InspirationCore"]),
        .executableTarget(name: "PreviewCheck", dependencies: ["InspirationCore"], path: "Checks"),
        .executableTarget(name: "StateCheck", dependencies: ["InspirationCore"], path: "Tests/InspirationCoreTests")
    ]
)
