import MetalKit
import SwiftUI

/// A glass orb with states, for SwiftUI.
///
///     OrbView(state: agent.state, level: agent.loudness)
///         .frame(width: 96, height: 96)
///
/// Changing `state` springs the orb to it; `level` (0 to 1) feeds the states that react to it.
/// For image or video contents, `media` is the picture or clip to hold instead of the one the
/// program names. Under Reduce Motion the orb holds a still frame and cuts between states.
public struct OrbView: View {
    private let program: OrbProgram
    private let state: String
    private let level: Double
    private let paused: Bool
    private let media: OrbMedia?

    public init(
        program: OrbProgram, state: String? = nil, level: Double = 0, paused: Bool = false,
        media: OrbMedia? = nil
    ) {
        self.program = program
        self.state = state ?? program.state
        self.level = level
        self.paused = paused
        self.media = media
    }

    public init(
        preset: OrbPreset = .clear, state: String = "idle", level: Double = 0,
        paused: Bool = false, media: OrbMedia? = nil
    ) {
        self.init(program: preset.program, state: state, level: level, paused: paused, media: media)
    }

    public var body: some View {
        OrbMetalView(program: program, state: state, level: level, paused: paused, media: media)
            .accessibilityHidden(true)
    }
}

/// What the representable does on both platforms: build the renderer once, then pass changes on.
@MainActor
final class OrbCoordinator {
    var renderer: OrbMetalRenderer?
    var program: OrbProgram?
    weak var view: MTKView?

    func make(program: OrbProgram) -> MTKView {
        let view = MTKView(frame: .zero, device: MTLCreateSystemDefaultDevice())
        #if os(macOS)
            view.layer?.isOpaque = false
        #else
            view.isOpaque = false
            view.backgroundColor = .clear
        #endif
        view.preferredFramesPerSecond = 60
        renderer = try? OrbMetalRenderer(view: view, program: program)
        self.program = program
        self.view = view
        return view
    }

    func update(
        _ view: MTKView, program: OrbProgram, state: String, level: Double, paused: Bool,
        media: OrbMedia?
    ) {
        guard let renderer else { return }
        let still = reduceMotion || paused
        if self.program != program {
            try? renderer.setProgram(program, state: state)
            self.program = program
        }
        if renderer.runtime.state != state {
            renderer.runtime.setState(state, immediate: still)
        }
        renderer.runtime.setLevel(Float(level))
        renderer.animates = !reduceMotion
        // A picture that loads later shows on the next frame, or, held still, once redrawn.
        renderer.setMedia(media) { [weak self] in self?.redraw() }
        renderer.setPlaying(!still)
        // A still orb draws on demand, so a change of state still shows.
        view.isPaused = still
        view.enableSetNeedsDisplay = still
        if still { redraw() }
    }

    private func redraw() {
        guard let view else { return }
        #if os(macOS)
            view.needsDisplay = true
        #else
            view.setNeedsDisplay()
        #endif
    }

    private var reduceMotion: Bool {
        #if os(macOS)
            NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #else
            UIAccessibility.isReduceMotionEnabled
        #endif
    }
}

#if os(macOS)
    struct OrbMetalView: NSViewRepresentable {
        let program: OrbProgram
        let state: String
        let level: Double
        let paused: Bool
        let media: OrbMedia?

        func makeCoordinator() -> OrbCoordinator { OrbCoordinator() }

        func makeNSView(context: Context) -> MTKView {
            let view = context.coordinator.make(program: program)
            updateNSView(view, context: context)
            return view
        }

        func updateNSView(_ view: MTKView, context: Context) {
            context.coordinator.update(
                view, program: program, state: state, level: level, paused: paused, media: media)
        }
    }
#else
    struct OrbMetalView: UIViewRepresentable {
        let program: OrbProgram
        let state: String
        let level: Double
        let paused: Bool
        let media: OrbMedia?

        func makeCoordinator() -> OrbCoordinator { OrbCoordinator() }

        func makeUIView(context: Context) -> MTKView {
            let view = context.coordinator.make(program: program)
            updateUIView(view, context: context)
            return view
        }

        func updateUIView(_ view: MTKView, context: Context) {
            context.coordinator.update(
                view, program: program, state: state, level: level, paused: paused, media: media)
        }
    }
#endif
