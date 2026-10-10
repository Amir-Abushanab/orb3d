package io.github.amirabushanab.orb3d

import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.min

/**
 * An orb compiled by `@orb3d/core` (`compileOrb`, or Orb Studio's export): the shader's uniform
 * array with the structure already written in, and each state's dials as a vector.
 */
class OrbProgram internal constructor(
  /** What the orb holds: `none`, `gradient`, `image`, `video`, `shader`, `sunset`, `landscape`. */
  val contents: String,
  /** The shader that draws it; a picture and a clip share `media`. */
  internal val shader: String,
  /** The picture or clip image and video contents name: a URL, or an asset in the app. */
  val mediaSource: String?,
  /** `"image"` or `"video"` for contents that hold one. */
  val mediaKind: String?,
  /** The shader a shader of your own carries, written out for GLES. */
  private val glsl: String?,
  internal val slots: Int,
  internal val dialSlot: Int,
  internal val dialCount: Int,
  internal val staticSlot: Int,
  internal val static: FloatArray,
  /** The dial channel of the speed every clock runs at. */
  internal val speed: Int,
  internal val features: Int,
  internal val switches: IntArray,
  internal val paint: Paint?,
  /** Where the rain's simulation finds the drops laid out and writes the water pool and trails. */
  internal val rain: Rain,
  internal val snow: Snow,
  internal val weatherCanvas: Int,
  internal val weatherView: Int,
  internal val iceEnabled: Int, internal val iceAmount: Int, internal val iceMelt: Int,
  /** Clocks 1 to 7, two to a clock: the channel of its rate and of the level's share, or -1. */
  internal val clocks: IntArray,
  internal val levelAttack: Float,
  internal val levelRelease: Float,
  /** The state the orb opens in. */
  val state: String,
  internal val states: Map<String, State>,
) {
  internal class Paint(val states: List<String>, val pages: IntArray, val static: FloatArray)
  internal class State(val dials: FloatArray, val duration: Float)

  /** Uniform slots of the drops and of the rain's simulation, and the dial channels it reads. */
  internal class Rain(
    val counts: Int,
    val drops: Int,
    val pool: Int,
    val trails: Int,
    val amount: Int,
    val density: Int,
    val spawn: Int,
    val direction: Int,
    val angle: Int,
    val enabled: Int, val wind: Int, val mist: Int, val size: Int, val windSpeed: Int, val gusts: Int, val turbulence: Int,
  )
  internal class Snow(
    val windSpeed: Int, val gusts: Int, val turbulence: Int, val hailEnabled: Int, val hailAmount: Int, val hailDensity: Int, val hailSize: Int, val hailBounce: Int, val hailMelt: Int,
    val pool: Int, val amount: Int, val density: Int, val dispersion: Int, val angle: Int,
    val enabled: Int, val wind: Int, val fall: Int, val size: Int, val stick: Int, val melt: Int, val gravity: Int, val react: Int,
  )

  val stateNames: Set<String> get() = states.keys

  /** The fragment shader that draws this program: its own, or the built-in one for its contents. */
  internal val fragmentShader: String
    get() = glsl ?: ORB_FRAGMENT_SHADERS[shader] ?: error("no shader for $contents contents")

  companion object {
    @JvmStatic
    fun fromJson(json: String): OrbProgram {
      val o = JSONObject(json)
      require(o.getString("format") == "orb3d-program") { "not an orb3d program" }
      require(o.getInt("version") == 12) { "an orb3d program from another version of @orb3d/core" }
      fun floats(name: String, from: JSONObject = o): FloatArray {
        val array = from.getJSONArray(name)
        return FloatArray(array.length()) { array.getDouble(it).toFloat() }
      }
      val level = o.getJSONObject("level")
      val states = o.getJSONObject("states")
      val media = o.optJSONObject("media")
      val clocks = o.getJSONArray("clocks")
      val rain = o.getJSONObject("rain")
      val snow = o.getJSONObject("snow")
      return OrbProgram(
        contents = o.getString("contents"),
        shader = o.getString("shader"),
        mediaSource = media?.getString("src"),
        mediaKind = media?.getString("kind"),
        glsl = o.optJSONObject("shaders")?.optString("glsl")?.takeIf { it.isNotEmpty() },
        slots = o.getInt("slots"),
        dialSlot = o.getInt("dialSlot"),
        dialCount = o.getInt("dialCount"),
        staticSlot = o.getInt("staticSlot"),
        static = floats("static"),
        paint = o.optJSONObject("paint")?.let { p ->
          val states = p.getJSONArray("states"); val pages = p.getJSONArray("pages")
          Paint(List(states.length()) { states.getString(it) }, IntArray(pages.length()) { pages.getInt(it) }, floats("static", p))
        },
        speed = o.getInt("speed"),
        features = o.getInt("features"),
        switches = o.getJSONArray("switches").let { a -> IntArray(a.length()) { a.getInt(it) } },
        rain = Rain(
          counts = rain.getInt("counts"),
          drops = rain.getInt("drops"),
          pool = rain.getInt("pool"),
          trails = rain.getInt("trails"),
          amount = rain.getInt("amount"),
          density = rain.getInt("density"),
          spawn = rain.getInt("spawn"),
          direction = rain.getInt("direction"),
          angle = rain.optInt("angle", -1),
          enabled = rain.getInt("enabled"), wind = rain.getInt("wind"), mist = rain.getInt("mist"), size = rain.getInt("size"), windSpeed = rain.getInt("windSpeed"), gusts = rain.getInt("gusts"), turbulence = rain.getInt("turbulence"),
        ),
        weatherView = o.getJSONObject("weather").getInt("view"),
        weatherCanvas = o.getJSONObject("weather").getInt("canvas"),
        iceEnabled = o.getJSONObject("weather").getInt("iceEnabled"), iceAmount = o.getJSONObject("weather").getInt("iceAmount"), iceMelt = o.getJSONObject("weather").getInt("iceMelt"),
        snow = Snow(
          windSpeed = snow.getInt("windSpeed"), gusts = snow.getInt("gusts"), turbulence = snow.getInt("turbulence"), hailEnabled = snow.getInt("hailEnabled"), hailAmount = snow.getInt("hailAmount"), hailDensity = snow.getInt("hailDensity"), hailSize = snow.getInt("hailSize"), hailBounce = snow.getInt("hailBounce"), hailMelt = snow.getInt("hailMelt"),
          enabled = snow.getInt("enabled"), wind = snow.getInt("wind"),
          pool = snow.getInt("pool"), amount = snow.getInt("amount"), density = snow.getInt("density"),
          dispersion = snow.getInt("dispersion"), angle = snow.getInt("angle"), fall = snow.getInt("fall"),
          size = snow.getInt("size"), stick = snow.getInt("stick"), melt = snow.getInt("melt"),
          gravity = snow.getInt("gravity"), react = snow.getInt("react"),
        ),
        clocks = IntArray(clocks.length() * 2) { clocks.getJSONArray(it / 2).getInt(it % 2) },
        levelAttack = level.getDouble("attack").toFloat(),
        levelRelease = level.getDouble("release").toFloat(),
        state = o.getString("state"),
        states = states.keys().asSequence().associateWith {
          val s = states.getJSONObject(it)
          State(floats("dials", s), s.getDouble("duration").toFloat())
        },
      )
    }
  }
}

/**
 * The part of an orb that runs on the CPU, the same on every platform: a critically damped spring
 * per dial toward the current state, the input level's smoothing, the clocks rates integrate into,
 * and the rain running down the glass ([OrbRain]), stepped with the rain clock. The shader works
 * out everything else from these. A port of `@orb3d/core`'s runtime.ts.
 *
 * Not thread-safe: `OrbView` keeps it on its render thread.
 */
class OrbRuntime(program: OrbProgram, state: String = program.state) {
  /** The shader's uniform array, `slots` vec4s. [write] brings it up to date. */
  var data = FloatArray(program.slots * 4)
    private set
  var program = program
    private set
  var state = state
    private set
  var level = 0f
    private set

  var paintData = FloatArray(0)
    private set
  private var paintX = FloatArray(0)
  private var paintV = FloatArray(0)
  private var paintTarget = FloatArray(0)
  private var levelTarget = 0f
  private var x = FloatArray(program.dialCount)
  private var v = FloatArray(program.dialCount)
  private var target = x
  private var omega = 1f
  /** Time, then the other seven clocks, each integrated from its rate. */
  private val clock = FloatArray(8)
  /** The picture or clip's width and height in pixels, and 1 once it has loaded. */
  private val media = floatArrayOf(1f, 1f, 0f)
  private var rain = OrbRain(program)
  private var snow = OrbSnow()
  private var ice = 0f

  init {
    setProgram(program, state)
  }

  /** Swap in a recompiled program: the structure is rewritten and the dials cut to their values. */
  fun setProgram(program: OrbProgram, state: String = this.state, transition: Boolean = false) {
    fun authored(p: OrbProgram) = p.static.copyOfRange((p.rain.counts - p.staticSlot) * 4, (p.rain.pool - p.staticSlot) * 4)
    val keepRain = authored(this.program).contentEquals(authored(program))
    this.program = program
    paintData = program.paint?.static?.copyOf() ?: FloatArray(0)
    paintX = FloatArray(program.paint?.states?.size ?: 0); paintV = paintX.copyOf()
    data = FloatArray(program.slots * 4)
    program.static.copyInto(data, program.staticSlot * 4)
    if (x.size != program.dialCount) {
      x = FloatArray(program.dialCount)
      v = FloatArray(program.dialCount)
    }
    setState(state, immediate = !transition)
    // The rain starts over with the new drops, as it would have been a little while running.
    if (keepRain) rain.rebind(program)
    else {
      rain = OrbRain(program)
      if (program.weatherView == 0) rain.runTo(clock[1].toDouble(), x, 600, clock[0].toDouble())
    }
  }

  /** Spring toward a state, or cut to it. An unknown name falls back to the opening state. */
  fun setState(name: String, immediate: Boolean = false) {
    state = resolve(name)
    val next = program.states.getValue(state)
    target = next.dials
    paintTarget = FloatArray(paintX.size) { if (program.paint!!.states[it] == state) 1f else 0f }
    omega = 5.84f / max(next.duration, 1e-3f)
    for (i in program.switches) { x[i] = target[i]; v[i] = 0f }
    if (immediate) settle()
  }

  /** The input level, 0 to 1: a voice's loudness, a progress pulse. */
  fun setLevel(value: Float) {
    levelTarget = if (value.isFinite()) min(1f, max(0f, value)) else 0f
  }

  /** The picture or clip's size in pixels once it has loaded, or 0 × 0 while there is none. */
  fun setMedia(width: Int, height: Int) {
    val ready = width > 0 && height > 0
    media[0] = if (ready) width.toFloat() else 1f
    media[1] = if (ready) height.toFloat() else 1f
    media[2] = if (ready) 1f else 0f
  }

  /** Cut every dial to the current state's value. */
  fun settle() {
    paintTarget.copyInto(paintX); paintV.fill(0f)
    target.copyInto(x)
    v.fill(0f)
  }

  fun advance(dt: Float) {
    val tau = if (levelTarget > level) program.levelAttack else program.levelRelease
    level += (levelTarget - level) * (1f - exp(-dt / tau))
    // One exact step of a critically damped spring per dial: stable at any frame time, and it
    // carries its velocity into a new target when the state changes mid-move.
    val decay = exp(-omega * dt)
    for (i in x.indices) {
      val y = x[i] - target[i]
      val k = v[i] + omega * y
      x[i] = target[i] + (y + k * dt) * decay
      v[i] = (v[i] - omega * k * dt) * decay
    }
    for (i in paintX.indices) {
      val y = paintX[i] - paintTarget[i]; val k = paintV[i] + omega * y
      paintX[i] = paintTarget[i] + (y + k * dt) * decay
      paintV[i] = (paintV[i] - omega * k * dt) * decay
    }
    for (i in program.switches) { x[i] = target[i]; v[i] = 0f }
    integrate(dt)
    if (x[program.iceEnabled] >= 0.5f) {
      val deposit = x[program.iceAmount] * 0.45f
      val rate = deposit + x[program.iceMelt] * 0.16f
      if (rate > 0f) { val target = deposit/rate; ice = target + (ice-target)*exp(-rate*dt*x[program.speed]) }
    }
    if (program.weatherView == 0) {
        rain.runTo(clock[1].toDouble(), x, 120, clock[0].toDouble())
        snow.runTo(clock[0].toDouble(), program.snow, x, 120, level.toDouble(), rain)
    }
  }

  /** The settled frame [time] seconds after opening in the current state. */
  fun seek(time: Float) {
    settle()
    level = levelTarget
    clock.fill(0f)
    integrate(time)
    val deposit = if (x[program.iceEnabled] >= 0.5f) x[program.iceAmount] * 0.45f else 0f
    val rate = deposit + x[program.iceMelt] * 0.16f
    ice = if (rate > 0f) deposit/rate * (1-exp(-rate*time*x[program.speed])) else 0f
    rain = OrbRain(program)
    snow = OrbSnow()
    if (program.weatherView == 0) {
      rain.runTo(clock[1].toDouble(), x, 60 * 600, clock[0].toDouble())
      snow.runTo(clock[0].toDouble(), program.snow, x, 60 * 600, level.toDouble(), rain)
    }
  }

  /** Bring [data] up to date for a surface [width] × [height], in units of [pixelRatio] px. */
  fun write(width: Float, height: Float, pixelRatio: Float = 1f): FloatArray {
    paintX.copyInto(paintData)
    data[0] = width
    data[1] = height
    data[2] = level
    data[3] = pixelRatio
    clock.copyInto(data, 4)
    media.copyInto(data, 12)
    x.copyInto(data, program.dialSlot * 4)
    val rainEnabled = x[program.rain.enabled] >= 0.5f
    val snowEnabled = x[program.snow.enabled] >= 0.5f || x[program.snow.hailEnabled] >= 0.5f
    val wet = rain.wet(clock[0].toDouble(), rainEnabled, x[program.snow.enabled] >= 0.5f,x[program.snow.hailEnabled] >= 0.5f)
    val drops = rainEnabled && (x[program.rain.amount] > 0 || x[program.rain.density] > 0 || rain.dynamic)
    val flakes = snowEnabled && snow.hasParticles
    var flags = program.features
    if (!drops && !wet.first) flags = flags and 1.inv()
    if (!flakes && !wet.second) flags = flags and (2 or 134217728).inv()
    if (!drops) flags = flags and 65536.inv()
    if (!flakes) flags = flags and 131072.inv()
    if (!rainEnabled || x[program.rain.mist] <= 0) flags = flags and 16.inv()
    if (x[program.switches[2]] < 0.5f) flags = flags and 4.inv()
    if (x[program.switches[3]] < 0.5f) flags = flags and 8.inv()
    val incoming = (rainEnabled && x[program.rain.density] > 0)
      || (x[program.snow.enabled] >= 0.5f && x[program.snow.density] > 0
        && x[program.snow.amount] + x[program.snow.react] * level > 0)
      || (x[program.snow.hailEnabled] >= 0.5f && x[program.snow.hailAmount] > 0
        && x[program.snow.hailDensity] > 0)
    if (!incoming) flags = flags and 67108864.inv()
    data[15] = (flags % 1048576).toFloat()
    data[program.weatherCanvas * 4 + 2] = (flags / 1048576).toFloat()
    data[program.weatherCanvas * 4 + 3] = ice
    rain.write(data, snow, drops, wet.first || wet.second)
    if (flakes) snow.write(data, program.snow)
    return data
  }

  private fun resolve(name: String): String = when {
    name in program.states -> name
    program.state in program.states -> program.state
    else -> program.states.keys.first()
  }

  /** Rates integrate into clocks, so a speed change moves things on from where they are. */
  private fun integrate(dt: Float) {
    val step = dt * x[program.speed]
    clock[0] += step
    val clocks = program.clocks
    for (i in 0 until clocks.size / 2) {
      val rate = clocks[i * 2]
      if (rate < 0) continue
      val react = clocks[i * 2 + 1]
      val windMean = if (i == 5) max(0f, x[program.rain.gusts] - x[rate]) * 0.5f * x[program.rain.turbulence] else 0f
      clock[i + 1] += step * (x[rate] + (if (react < 0) 0f else x[react] * level) + windMean)
    }
  }
}
