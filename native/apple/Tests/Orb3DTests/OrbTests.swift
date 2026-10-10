import Foundation
import Metal
import XCTest

@testable import Orb3D

final class OrbTests: XCTestCase {
    /// The studio's sample picture and clip, beside the repository's other files.
    private func sample(_ name: String) -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("apps/studio/public/samples/\(name)")
    }

    func testEveryPresetDecodesAndSettles() throws {
        for preset in OrbPreset.allCases {
            let program = preset.program
            XCTAssertNotNil(program.metalSource, "\(preset)")
            let runtime = OrbRuntime(program: program)
            runtime.advance(1 / 60)
            let data = runtime.write(width: 100, height: 100)
            XCTAssertEqual(data.count, program.slots * 4)
            // Clock 0 is time, at the speed dial.
            XCTAssertGreaterThan(data[4], 0, "\(preset)")
        }
    }

    func testEveryPresetRendersWithLargeUniformBuffers() throws {
        guard let device = MTLCreateSystemDefaultDevice() else { throw XCTSkip("no Metal") }
        for preset in OrbPreset.allCases {
            XCTAssertGreaterThan(preset.program.slots * 16, 4096)
            let image = try OrbSnapshot.image(program: preset.program, size: 32, device: device)
            let bytes = try XCTUnwrap(image.dataProvider?.data) as Data
            XCTAssertTrue(stride(from: 3, to: bytes.count, by: 4).contains { bytes[$0] > 0 }, "\(preset)")
        }
    }

    func testWeatherSwitchesSkipPackingAndResumeCachedParticles() {
        var program = OrbPreset.sunset.program
        var active = program.states["idle"]!
        active.dials[program.rain.direction] = 0
        active.dials[program.rain.amount] = 1
        active.dials[program.rain.density] = 0.5
        active.dials[program.clocks[0][0]] = 1
        active.dials[program.snow.amount] = 1
        program.states["idle"] = active
        var off = active
        for channel in program.switches { off.dials[channel] = 0 }
        program.states["off"] = off
        let runtime = OrbRuntime(program: program)
        runtime.seek(2)
        let before = runtime.write(width: 256, height: 256)
        runtime.setState("off")
        let cut = runtime.write(width: 256, height: 256)
        XCTAssertEqual(Int(cut[15]) & (1 | 2 | 16 | 65536 | 131072), 0)
        runtime.advance(30)
        let paused = runtime.write(width: 256, height: 256)
        let pool = program.rain.pool * 4
        XCTAssertEqual(Array(paused[pool..<(pool + 384 * 8)]), Array(before[pool..<(pool + 384 * 8)]))
        runtime.setState("idle")
        runtime.advance(1 / 60)
        let resumed = runtime.write(width: 256, height: 256)
        XCTAssertNotEqual(Int(resumed[15]) & 65536, 0)
        XCTAssertLessThan(abs(resumed[pool + 1] - before[pool + 1]), 0.03)
    }

    func testAPictureUploadsWithMipmaps() throws {
        guard let device = MTLCreateSystemDefaultDevice() else { throw XCTSkip("no Metal") }
        let pipeline = try OrbPipeline.shared(for: device, source: orbMetalShaders["media"]!)
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(sample("lake.jpg") as CFURL, nil))
        let image = try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
        let picture = try OrbMediaTexture(image: image, pipeline: pipeline)
        XCTAssertEqual(picture.width, 1200)
        XCTAssertEqual(picture.height, 800)
        XCTAssertGreaterThan(picture.texture?.mipmapLevelCount ?? 0, 1)
    }

    func testAClipsFramesReachATexture() throws {
        guard let device = MTLCreateSystemDefaultDevice() else { throw XCTSkip("no Metal") }
        let clip = OrbMediaTexture(video: sample("lake.mp4"), device: device)
        let deadline = Date().addingTimeInterval(10)
        while clip.texture == nil && Date() < deadline {
            clip.update()
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        XCTAssertNotNil(clip.texture)
        XCTAssertEqual(clip.width, 640)
        XCTAssertEqual(clip.height, 400)
    }
}
