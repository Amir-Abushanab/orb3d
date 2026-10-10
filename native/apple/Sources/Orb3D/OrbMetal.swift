import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import Metal
import MetalKit

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

/// The orb's pipeline for one shader: compiled once per device and source, at run time, so the
/// package needs no build step for its `.metal` and runs wherever Metal does.
final class OrbPipeline {
    let device: MTLDevice
    let queue: MTLCommandQueue
    private var states: [MTLPixelFormat: MTLRenderPipelineState] = [:]
    private let library: MTLLibrary
    private let stateLock = NSLock()

    private static var pipelines: [ObjectIdentifier: [String: OrbPipeline]] = [:]
    private static var queues: [ObjectIdentifier: MTLCommandQueue] = [:]
    private static var blanks: [ObjectIdentifier: MTLTexture] = [:]
    private static let lock = NSLock()

    static func shared(for device: MTLDevice, source: String) throws -> OrbPipeline {
        lock.lock()
        defer { lock.unlock() }
        let id = ObjectIdentifier(device)
        if let pipeline = pipelines[id]?[source] { return pipeline }
        if queues[id] == nil {
            guard let queue = device.makeCommandQueue() else { throw OrbError.noCommandQueue }
            queues[id] = queue
        }
        let pipeline = try OrbPipeline(device: device, queue: queues[id]!, source: source)
        pipelines[id, default: [:]][source] = pipeline
        return pipeline
    }

    /// A transparent pixel, bound in a picture's place until one has loaded.
    static func blank(for device: MTLDevice) -> MTLTexture? {
        lock.lock()
        defer { lock.unlock() }
        let id = ObjectIdentifier(device)
        if let texture = blanks[id] { return texture }
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
        guard let texture = device.makeTexture(descriptor: descriptor) else { return nil }
        var pixel: [UInt8] = [0, 0, 0, 0]
        texture.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &pixel, bytesPerRow: 4)
        blanks[id] = texture
        return texture
    }

    private init(device: MTLDevice, queue: MTLCommandQueue, source: String) throws {
        self.device = device
        self.queue = queue
        library = try device.makeLibrary(source: source, options: nil)
    }

    func state(for format: MTLPixelFormat) throws -> MTLRenderPipelineState {
        stateLock.lock()
        defer { stateLock.unlock() }
        if let state = states[format] { return state }
        let descriptor = MTLRenderPipelineDescriptor()
        descriptor.vertexFunction = library.makeFunction(name: "orbVertex")
        descriptor.fragmentFunction = library.makeFunction(name: "orbFragment")
        descriptor.colorAttachments[0].pixelFormat = format
        let state = try device.makeRenderPipelineState(descriptor: descriptor)
        states[format] = state
        return state
    }

    /// One frame: a triangle that covers the target, the uniform array in fragment buffer 0 and the
    /// picture, if the shader takes one, in texture 0.
    func encode(
        _ encoder: MTLRenderCommandEncoder, format: MTLPixelFormat, data: [Float],
        texture: MTLTexture?, paint: [Float] = [], pages: [Int] = []
    ) throws {
        encoder.setRenderPipelineState(try state(for: format))
        try bind(data, to: encoder, index: 0)
        var start = 0
        for (i, slots) in pages.enumerated() {
            let data = Array(paint[start..<(start + slots * 4)])
            try bind(data, to: encoder, index: i + 1)
            start += slots * 4
        }
        encoder.setFragmentTexture(texture ?? OrbPipeline.blank(for: device), index: 0)
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }

    /// Metal's inline byte API is only for small uniforms; the orb's simulation needs a buffer.
    private func bind(_ data: [Float], to encoder: MTLRenderCommandEncoder, index: Int) throws {
        try data.withUnsafeBytes { bytes in
            guard let address = bytes.baseAddress, !bytes.isEmpty else { return }
            if bytes.count < 4096 {
                encoder.setFragmentBytes(address, length: bytes.count, index: index)
            } else {
                guard let buffer = device.makeBuffer(bytes: address, length: bytes.count, options: .storageModeShared)
                else { throw OrbError.renderFailed }
                encoder.setFragmentBuffer(buffer, offset: 0, index: index)
            }
        }
    }
}

public enum OrbError: Error {
    case noMetal
    case noCommandQueue
    case noShader
    case renderFailed
}

/// The picture or clip an orb with image or video contents holds, when it is not the one its
/// program names.
public enum OrbMedia: Equatable {
    /// A picture.
    case image(CGImage)
    /// A picture or a clip, as the program's contents say: a file or a web URL.
    case url(URL)
}

/// A picture or clip as a Metal texture: a picture uploaded once with mipmaps (an orb shows a
/// large picture small, and the glass crowds it at the rim), a clip's frames as they come.
final class OrbMediaTexture {
    private(set) var texture: MTLTexture?
    private(set) var width = 0
    private(set) var height = 0
    private var player: AVPlayer?
    private var output: AVPlayerItemVideoOutput?
    private var cache: CVMetalTextureCache?
    private var frame: CVMetalTexture?
    private var looping: NSObjectProtocol?

    /// A picture, drawn into premultiplied 8-bit RGBA (as WebGL and Skia sample it), at most 2048
    /// pixels on a side.
    init(image: CGImage, pipeline: OrbPipeline) throws {
        let scale = min(1, 2048 / Double(max(image.width, image.height)))
        width = max(1, Int(Double(image.width) * scale))
        height = max(1, Int(Double(image.height) * scale))
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard
            let context = CGContext(
                data: &pixels, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw OrbError.renderFailed }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm, width: width, height: height, mipmapped: true)
        descriptor.usage = [.shaderRead]
        guard
            let texture = pipeline.device.makeTexture(descriptor: descriptor),
            let commands = pipeline.queue.makeCommandBuffer(),
            let blit = commands.makeBlitCommandEncoder()
        else { throw OrbError.renderFailed }
        texture.replace(
            region: MTLRegionMake2D(0, 0, width, height), mipmapLevel: 0, withBytes: pixels,
            bytesPerRow: width * 4)
        blit.generateMipmaps(for: texture)
        blit.endEncoding()
        commands.commit()
        commands.waitUntilCompleted()
        self.texture = texture
    }

    /// A clip, muted and looping, its frames pulled as the orb draws.
    init(video url: URL, device: MTLDevice) {
        let item = AVPlayerItem(url: url)
        let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferMetalCompatibilityKey as String: true,
        ])
        item.add(output)
        let player = AVPlayer(playerItem: item)
        player.isMuted = true
        player.actionAtItemEnd = .none
        looping = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main
        ) { [weak player] _ in
            player?.seek(to: .zero)
        }
        CVMetalTextureCacheCreate(nil, nil, device, nil, &cache)
        self.player = player
        self.output = output
        player.play()
    }

    deinit {
        if let looping { NotificationCenter.default.removeObserver(looping) }
        player?.pause()
    }

    /// Play the clip or hold it on its frame. A picture ignores this.
    func setPlaying(_ playing: Bool) {
        guard let player else { return }
        if playing { player.play() } else { player.pause() }
    }

    /// Take the clip's newest frame, if it has a new one. Returns whether the size changed.
    @discardableResult
    func update() -> Bool {
        guard let output, let cache else { return false }
        let time = output.itemTime(forHostTime: CACurrentMediaTime())
        guard
            output.hasNewPixelBuffer(forItemTime: time),
            let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil)
        else { return false }
        let w = CVPixelBufferGetWidth(buffer)
        let h = CVPixelBufferGetHeight(buffer)
        var made: CVMetalTexture?
        CVMetalTextureCacheCreateTextureFromImage(nil, cache, buffer, nil, .bgra8Unorm, w, h, 0, &made)
        guard let made, let texture = CVMetalTextureGetTexture(made) else { return false }
        // Held until the next frame replaces it, so the GPU never reads a recycled buffer.
        frame = made
        self.texture = texture
        let resized = w != width || h != height
        width = w
        height = h
        return resized
    }

    /// The picture a program names: a URL (file or web), or an image in the app's bundle.
    static func loadImage(_ src: String) async -> CGImage? {
        if let url = URL(string: src), url.scheme != nil {
            let data: Data?
            if url.isFileURL {
                data = try? Data(contentsOf: url)
            } else {
                data = try? await URLSession.shared.data(from: url).0
            }
            guard let data, let source = CGImageSourceCreateWithData(data as CFData, nil) else {
                return nil
            }
            return CGImageSourceCreateImageAtIndex(source, 0, nil)
        }
        return await MainActor.run { bundledImage(named: src) }
    }

    /// A clip a program names: a URL, or a file in the app's bundle.
    static func videoURL(_ src: String) -> URL? {
        if let url = URL(string: src), url.scheme != nil { return url }
        return Bundle.main.url(forResource: src, withExtension: nil)
    }

    @MainActor
    private static func bundledImage(named name: String) -> CGImage? {
        #if canImport(UIKit)
            return UIImage(named: name)?.cgImage
        #elseif canImport(AppKit)
            var rect = CGRect.zero
            return NSImage(named: name)?.cgImage(forProposedRect: &rect, context: nil, hints: nil)
        #else
            return nil
        #endif
    }
}

/// Draws an orb into an `MTKView` every frame, stepping its runtime by the time since the last.
@MainActor
public final class OrbMetalRenderer: NSObject, MTKViewDelegate {
    public let runtime: OrbRuntime
    /// Whether the dials spring between states. Off, a state change cuts (reduced motion).
    public var animates = true
    private var pipeline: OrbPipeline
    private let device: MTLDevice
    private var last: CFTimeInterval?
    private var media: OrbMediaTexture?
    private var mediaKey: String?
    private var loading = 0
    private var playing = true

    public init(view: MTKView, program: OrbProgram) throws {
        guard let device = view.device ?? MTLCreateSystemDefaultDevice() else {
            throw OrbError.noMetal
        }
        guard let source = program.metalSource else { throw OrbError.noShader }
        view.device = device
        self.device = device
        pipeline = try OrbPipeline.shared(for: device, source: source)
        runtime = OrbRuntime(program: program)
        super.init()
        view.colorPixelFormat = .bgra8Unorm
        view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        view.framebufferOnly = true
        view.delegate = self
    }

    /// Swap in another program, building its shader if it has a different one.
    public func setProgram(_ program: OrbProgram, state: String) throws {
        guard let source = program.metalSource else { throw OrbError.noShader }
        pipeline = try OrbPipeline.shared(for: device, source: source)
        runtime.setProgram(program, state: state)
    }

    /// The picture or clip to hold: `media`, or else the one the program names. Loads it if it
    /// changed; nothing happens for contents that hold neither.
    public func setMedia(_ override: OrbMedia?, onLoad: @escaping @MainActor () -> Void = {}) {
        let program = runtime.program
        guard let kind = program.media?.kind else {
            loading += 1 // invalidate a picture still loading for the previous contents
            media = nil
            mediaKey = nil
            runtime.setMedia(width: 0, height: 0)
            return
        }
        let key: String
        switch override {
        case .image(let image): key = "image:\(ObjectIdentifier(image).hashValue)"
        case .url(let url): key = "\(kind):\(url.absoluteString)"
        case nil: key = "\(kind):\(program.media?.src ?? "")"
        }
        if key == mediaKey { return }
        mediaKey = key
        media = nil
        runtime.setMedia(width: 0, height: 0)
        loading += 1
        let ticket = loading
        let pipeline = pipeline
        let device = device
        Task { @MainActor in
            var loaded: OrbMediaTexture?
            if kind == "video" {
                var url = OrbMediaTexture.videoURL(program.media?.src ?? "")
                if case .url(let given) = override { url = given }
                if let url { loaded = OrbMediaTexture(video: url, device: device) }
            } else {
                var image: CGImage?
                switch override {
                case .image(let given): image = given
                case .url(let url): image = await OrbMediaTexture.loadImage(url.absoluteString)
                case nil: image = await OrbMediaTexture.loadImage(program.media?.src ?? "")
                }
                if let image { loaded = try? OrbMediaTexture(image: image, pipeline: pipeline) }
            }
            guard ticket == self.loading else { return }
            self.media = loaded
            loaded?.setPlaying(self.playing)
            if let loaded, loaded.width > 0 {
                self.runtime.setMedia(width: loaded.width, height: loaded.height)
            }
            onLoad()
        }
    }

    /// Play a clip, or hold it on its frame.
    public func setPlaying(_ playing: Bool) {
        self.playing = playing
        media?.setPlaying(playing)
    }

    public func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

    public func draw(in view: MTKView) {
        let now = CACurrentMediaTime()
        let dt = Float(min(max(now - (last ?? now), 0), 0.1))
        last = now
        if animates && !view.isPaused { runtime.advance(dt) }
        if let media, media.update() {
            runtime.setMedia(width: media.width, height: media.height)
        }
        guard
            let pass = view.currentRenderPassDescriptor,
            let drawable = view.currentDrawable,
            let commands = pipeline.queue.makeCommandBuffer(),
            let encoder = commands.makeRenderCommandEncoder(descriptor: pass)
        else { return }
        let size = view.drawableSize
        let data = runtime.write(width: Float(size.width), height: Float(size.height))
        try? pipeline.encode(encoder, format: view.colorPixelFormat, data: data, texture: media?.texture, paint: runtime.paintData, pages: runtime.program.paint?.pages ?? [])
        encoder.endEncoding()
        commands.present(drawable)
        commands.commit()
    }
}

/// Still frames without a view: posters, previews, tests.
public enum OrbSnapshot {
    /// The orb in `state`, `time` seconds after it opened there, settled, as a square image with a
    /// transparent background. `time: 0` is the frame the live orb starts on. `image` is the
    /// picture for image contents.
    public static func image(
        program: OrbProgram,
        state: String? = nil,
        time: Float = 0,
        level: Float = 0,
        size: Int = 512,
        image: CGImage? = nil,
        device: MTLDevice? = MTLCreateSystemDefaultDevice()
    ) throws -> CGImage {
        guard let device else { throw OrbError.noMetal }
        guard let source = program.metalSource else { throw OrbError.noShader }
        let pipeline = try OrbPipeline.shared(for: device, source: source)
        let runtime = OrbRuntime(program: program, state: state)
        runtime.setLevel(level)
        runtime.seek(time)
        var picture: OrbMediaTexture?
        if let image, program.media != nil {
            picture = try OrbMediaTexture(image: image, pipeline: pipeline)
            runtime.setMedia(width: picture!.width, height: picture!.height)
        }

        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm, width: size, height: size, mipmapped: false)
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .shared
        guard
            let texture = device.makeTexture(descriptor: descriptor),
            let commands = pipeline.queue.makeCommandBuffer()
        else { throw OrbError.renderFailed }
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = texture
        pass.colorAttachments[0].loadAction = .clear
        pass.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        pass.colorAttachments[0].storeAction = .store
        guard let encoder = commands.makeRenderCommandEncoder(descriptor: pass) else {
            throw OrbError.renderFailed
        }
        let data = runtime.write(width: Float(size), height: Float(size))
        try pipeline.encode(encoder, format: .rgba8Unorm, data: data, texture: picture?.texture, paint: runtime.paintData, pages: runtime.program.paint?.pages ?? [])
        encoder.endEncoding()
        commands.commit()
        commands.waitUntilCompleted()

        guard commands.status == .completed else { throw OrbError.renderFailed }
        var bytes = [UInt8](repeating: 0, count: size * size * 4)
        texture.getBytes(
            &bytes, bytesPerRow: size * 4,
            from: MTLRegionMake2D(0, 0, size, size), mipmapLevel: 0)
        // The shader writes premultiplied colour, which is what CoreGraphics expects here.
        guard
            let provider = CGDataProvider(data: Data(bytes) as CFData),
            let image = CGImage(
                width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32,
                bytesPerRow: size * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { throw OrbError.renderFailed }
        return image
    }
}
