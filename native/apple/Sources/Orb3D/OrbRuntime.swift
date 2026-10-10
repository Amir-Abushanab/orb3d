import Foundation

/// An orb compiled by `@orb3d/core` (`compileOrb`, or Orb Studio's export): the shader's uniform
/// array with the structure already written in, and each state's dials as a vector.
public struct OrbProgram: Codable, Equatable, Sendable {
    public struct State: Codable, Equatable, Sendable {
        public var dials: [Float]
        public var duration: Double
    }

    public struct Level: Codable, Equatable, Sendable {
        public var attack: Double
        public var release: Double
    }

    /// The picture or clip image and video contents hold: a URL, or an asset name in the app.
    public struct Media: Codable, Equatable, Sendable {
        public var src: String
        /// `"image"` or `"video"`.
        public var kind: String
    }

    /// The shader written out for each platform; a program carries it for a shader of your own.
    public struct Shaders: Codable, Equatable, Sendable {
        public var msl: String?
        public var glsl: String?
    }

    /// Where the rain's simulation finds the drops laid out and writes the water pool and trails: uniform slots,
    /// and the dial channels it reads.
    public struct Rain: Codable, Equatable, Sendable {
        public var counts: Int
        public var drops: Int
        public var pool: Int
        public var trails: Int
        public var amount: Int
        public var density: Int
        public var spawn: Int
        public var direction: Int
        public var angle: Int?
        public var enabled: Int
        public var wind: Int
        public var mist: Int
        public var size: Int
        public var windSpeed: Int
        public var gusts: Int
        public var turbulence: Int
    }
    public struct Snow: Codable, Equatable, Sendable {
        public var windSpeed: Int
        public var gusts: Int
        public var turbulence: Int
        public var hailEnabled: Int
        public var hailAmount: Int
        public var hailDensity: Int
        public var hailSize: Int
        public var hailBounce: Int
        public var hailMelt: Int

        public var pool: Int
        public var amount: Int
        public var density: Int
        public var dispersion: Int
        public var angle: Int
        public var fall: Int
        public var size: Int
        public var stick: Int
        public var melt: Int
        public var enabled: Int
        public var wind: Int
        public var gravity: Int
        public var react: Int
    }

    public struct Weather: Codable, Equatable, Sendable {
        public var view: Int
        public var windSpeed: Int
        public var gusts: Int
        public var turbulence: Int
        public var canvas: Int
        public var hailEnabled: Int
        public var iceEnabled: Int
        public var iceAmount: Int
        public var iceMelt: Int
    }
    public var weather: Weather
    public struct Paint: Codable, Equatable, Sendable {
        public var states: [String]
        public var pages: [Int]
        public var `static`: [Float]
    }
    public var paint: Paint?
    public var format: String
    public var version: Int
    /// What the orb holds: `none`, `gradient`, `image`, `video`, `shader`, `sunset`, `landscape`.
    public var contents: String
    /// The shader that draws it; a picture and a clip share `media`.
    public var shader: String
    public var media: Media?
    public var code: String?
    public var shaders: Shaders?
    public var slots: Int
    public var dialSlot: Int
    public var dialCount: Int
    public var staticSlot: Int
    public var `static`: [Float]
    /// The dial channel of the speed every clock runs at.
    public var speed: Int
    public var features: Int
    public var switches: [Int]
    public var rain: Rain
    public var snow: Snow
    /// Clocks 1 to 7: the dial channel each integrates as its rate, and the level's share in it.
    public var clocks: [[Int]]
    public var level: Level
    public var quality: Double
    public var dprMax: Double
    public var paused: Bool
    /// The state the orb opens in.
    public var state: String
    public var states: [String: State]

    public init(json: Data) throws {
        self = try JSONDecoder().decode(OrbProgram.self, from: json)
        guard version == 12 else {
            throw DecodingError.dataCorrupted(.init(codingPath: [],
                debugDescription: "An orb3d program from another version of @orb3d/core"))
        }
    }

    public init(json: String) throws {
        try self.init(json: Data(json.utf8))
    }

    /// The Metal shader that draws this program: its own, or the built-in one for its contents.
    public var metalSource: String? {
        shaders?.msl ?? orbMetalShaders[shader]
    }
}

/// The part of an orb that runs on the CPU, the same on every platform: a critically damped spring
/// per dial toward the current state, the input level's smoothing, the clocks rates integrate into,
/// and the rain running down the glass (`OrbRain`), stepped with the rain clock. The shader works
/// out everything else from these. A port of `@orb3d/core`'s runtime.ts.
public final class OrbRuntime {
    /// The shader's uniform array, `slots` vec4s. `write` brings it up to date.
    public private(set) var data: [Float]
    public private(set) var program: OrbProgram
    public private(set) var state: String
    public private(set) var level: Float = 0

    public private(set) var paintData: [Float] = []
    private var paintX: [Float] = []
    private var paintV: [Float] = []
    private var paintTarget: [Float] = []
    private var levelTarget: Float = 0
    private var x: [Float]
    private var v: [Float]
    private var target: [Float]
    private var omega: Float = 1
    /// Time, then the other seven clocks, each integrated from its rate.
    private var clock = [Float](repeating: 0, count: 8)
    /// The picture or clip's width and height in pixels, and 1 once it has loaded.
    private var media: [Float] = [1, 1, 0]
    private var rain: OrbRain
    private var snow = OrbSnow()
    private var ice: Float = 0

    public init(program: OrbProgram, state: String? = nil) {
        self.program = program
        data = [Float](repeating: 0, count: program.slots * 4)
        x = [Float](repeating: 0, count: program.dialCount)
        v = x
        target = x
        self.state = program.state
        rain = OrbRain(program: program)
        setProgram(program, state: state ?? program.state)
    }

    /// Swap in a recompiled program: the structure is rewritten and the dials cut to their values.
    public func setProgram(_ program: OrbProgram, state: String? = nil, transition: Bool = false) {
        let old = self.program
        func authored(_ p: OrbProgram) -> ArraySlice<Float> {
            p.static[((p.rain.counts - p.staticSlot) * 4)..<((p.rain.pool - p.staticSlot) * 4)]
        }
        let keepRain = authored(old).elementsEqual(authored(program))
        self.program = program
        paintData = program.paint?.static ?? []
        paintX = (program.paint?.states ?? []).map { $0 == (state ?? self.state) ? 1 : 0 }
        paintV = paintX.map { _ in 0 }; paintTarget = paintX
        data = [Float](repeating: 0, count: program.slots * 4)
        data.replaceSubrange(
            program.staticSlot * 4..<program.staticSlot * 4 + program.static.count,
            with: program.static
        )
        if x.count != program.dialCount {
            x = [Float](repeating: 0, count: program.dialCount)
            v = x
        }
        setState(state ?? self.state, immediate: !transition)
        // The rain starts over with the new drops, as it would have been a little while running.
        if keepRain { rain.rebind(program) }
        else {
            rain = OrbRain(program: program)
            if program.weather.view == 0 { rain.run(to: Double(clock[1]), dials: x, most: 600, time: Double(clock[0])) }
        }
    }

    /// Spring toward a state, or cut to it. An unknown name falls back to the opening state.
    public func setState(_ name: String, immediate: Bool = false) {
        state = resolve(name)
        let next = program.states[state]!
        target = next.dials
        paintTarget = (program.paint?.states ?? []).map { $0 == state ? 1 : 0 }
        omega = Float(5.84 / max(next.duration, 1e-3))
        for i in program.switches { x[i] = target[i]; v[i] = 0 }
        if immediate { settle() }
    }

    /// The input level, 0 to 1: a voice's loudness, a progress pulse. Smoothed, then added to the
    /// dials through the `react` amounts.
    public func setLevel(_ value: Float) {
        levelTarget = value.isFinite ? min(1, max(0, value)) : 0
    }

    /// The picture or clip's size in pixels once it has loaded, or 0 × 0 while there is none.
    public func setMedia(width: Int, height: Int) {
        let ready = width > 0 && height > 0
        media = ready ? [Float(width), Float(height), 1] : [1, 1, 0]
    }

    /// Cut every dial to the current state's value.
    public func settle() {
        paintX = paintTarget; paintV = paintX.map { _ in 0 }
        x = target
        v = [Float](repeating: 0, count: x.count)
    }

    public func advance(_ dt: Float) {
        let tau = Float(levelTarget > level ? program.level.attack : program.level.release)
        level += (levelTarget - level) * (1 - exp(-dt / tau))
        // One exact step of a critically damped spring per dial: stable at any frame time, and it
        // carries its velocity into a new target when the state changes mid-move.
        let decay = exp(-omega * dt)
        for i in 0..<x.count {
            let y = x[i] - target[i]
            let k = v[i] + omega * y
            x[i] = target[i] + (y + k * dt) * decay
            v[i] = (v[i] - omega * k * dt) * decay
        }
        for i in paintX.indices {
            let y = paintX[i] - paintTarget[i], k = paintV[i] + omega * y
            paintX[i] = paintTarget[i] + (y + k * dt) * decay
            paintV[i] = (paintV[i] - omega * k * dt) * decay
        }
        for i in program.switches { x[i] = target[i]; v[i] = 0 }
        integrate(dt)
        if x[program.weather.iceEnabled] >= 0.5 {
            let deposit = x[program.weather.iceAmount] * 0.45
            let rate = deposit + x[program.weather.iceMelt] * 0.16
            if rate > 0 { let target = deposit/rate; ice = target + (ice-target)*exp(-rate*dt*x[program.speed]) }
        }
        if program.weather.view == 0 {
            rain.run(to: Double(clock[1]), dials: x, most: 120, time: Double(clock[0]))
            snow.run(to: Double(clock[0]), layout: program.snow, dials: x, most: 120, level: Double(level), rain: rain)
        }
    }

    /// The settled frame `time` seconds after opening in the current state.
    public func seek(_ time: Float) {
        settle()
        level = levelTarget
        clock = [Float](repeating: 0, count: 8)
        integrate(time)
        let deposit = x[program.weather.iceEnabled] >= 0.5 ? x[program.weather.iceAmount] * 0.45 : 0
        let rate = deposit + x[program.weather.iceMelt] * 0.16
        ice = rate > 0 ? deposit/rate * (1-exp(-rate*time*x[program.speed])) : 0
        rain = OrbRain(program: program)
        snow = OrbSnow()
        if program.weather.view == 0 {
            rain.run(to: Double(clock[1]), dials: x, most: 60 * 600, time: Double(clock[0]))
            snow.run(to: Double(clock[0]), layout: program.snow, dials: x, most: 60 * 600, level: Double(level), rain: rain)
        }
    }

    /// Bring `data` up to date for a drawable `width` × `height`, in units of `pixelRatio` px.
    @discardableResult
    public func write(width: Float, height: Float, pixelRatio: Float = 1) -> [Float] {
        for i in paintX.indices { paintData[i] = paintX[i] }
        data[0] = width
        data[1] = height
        data[2] = level
        data[3] = pixelRatio
        data.replaceSubrange(4..<12, with: clock)
        data.replaceSubrange(12..<15, with: media)
        data.replaceSubrange(program.dialSlot * 4..<program.dialSlot * 4 + x.count, with: x)
        let rainEnabled = x[program.rain.enabled] >= 0.5
        let snowEnabled = x[program.snow.enabled] >= 0.5 || x[program.snow.hailEnabled] >= 0.5
        let wet = rain.wet(time: Double(clock[0]), rainEnabled: rainEnabled, snowEnabled: x[program.snow.enabled] >= 0.5, hailEnabled: x[program.snow.hailEnabled] >= 0.5)
        let drops = rainEnabled && (x[program.rain.amount] > 0 || x[program.rain.density] > 0 || rain.dynamic)
        let flakes = snowEnabled && snow.hasParticles
        var flags = program.features
        if !drops && !wet.0 { flags &= ~1 }
        if !flakes && !wet.1 { flags &= ~(2 | 134217728) }
        if !drops { flags &= ~65536 }
        if !flakes { flags &= ~131072 }
        if !rainEnabled || x[program.rain.mist] <= 0 { flags &= ~16 }
        if x[program.switches[2]] < 0.5 { flags &= ~4 }
        if x[program.switches[3]] < 0.5 { flags &= ~8 }
        let incoming = (rainEnabled && x[program.rain.density] > 0)
            || (x[program.snow.enabled] >= 0.5 && x[program.snow.density] > 0
                && x[program.snow.amount] + x[program.snow.react] * level > 0)
            || (x[program.snow.hailEnabled] >= 0.5 && x[program.snow.hailAmount] > 0
                && x[program.snow.hailDensity] > 0)
        if !incoming { flags &= ~67108864 }
        data[15] = Float(flags % 1048576)
        data[program.weather.canvas * 4 + 2] = Float(flags / 1048576)
        data[program.weather.canvas * 4 + 3] = ice
        rain.write(into: &data, snow: snow, drawDrops: drops, drawTrails: wet.0 || wet.1)
        if flakes { snow.write(into: &data, layout: program.snow) }
        return data
    }

    private func resolve(_ name: String) -> String {
        if program.states[name] != nil { return name }
        if program.states[program.state] != nil { return program.state }
        return program.states.keys.sorted().first!
    }

    /// Rates integrate into clocks, so a speed change moves things on from where they are.
    private func integrate(_ dt: Float) {
        let step = dt * x[program.speed]
        clock[0] += step
        for (i, pair) in program.clocks.enumerated() where pair[0] >= 0 {
            let react = pair[1] >= 0 ? x[pair[1]] * level : 0
            let windMean: Float = i == 5 ? max(0,x[program.weather.gusts]-x[pair[0]]) * 0.5 * x[program.weather.turbulence] : 0
            clock[i + 1] += step * (x[pair[0]] + react + windMean)
        }
    }
}
