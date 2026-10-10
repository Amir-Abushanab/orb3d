// swift-tools-version: 5.9
// The Swift package lives at the repository root because SwiftPM only resolves a package there;
// its sources are under native/apple. The shader and presets in it are generated from
// @orb3d/core by `pnpm native:generate`, so they match the web packages exactly.
import PackageDescription

let package = Package(
    name: "Orb3D",
    platforms: [.iOS(.v15), .macOS(.v12), .tvOS(.v15), .visionOS(.v1)],
    products: [
        .library(name: "Orb3D", targets: ["Orb3D"]),
    ],
    targets: [
        .target(name: "Orb3D", path: "native/apple/Sources/Orb3D"),
        // A still through the Metal pipeline from the command line, for posters and parity checks.
        .executableTarget(
            name: "orb3d-render",
            dependencies: ["Orb3D"],
            path: "native/apple/Sources/orb3d-render"
        ),
        .testTarget(
            name: "Orb3DTests",
            dependencies: ["Orb3D"],
            path: "native/apple/Tests/Orb3DTests"
        ),
    ]
)
