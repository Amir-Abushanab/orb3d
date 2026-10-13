package io.github.amirabushanab.orb3d

import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.pow

/** Fixed-step spherical water. Operation-for-operation port of program/rain.ts. */
internal class OrbRain(private var program: OrbProgram) {
  companion object {
    private const val DROPS = 384
    private const val TRAILS = 48
    private const val POINTS = 12
    private const val GRAVITY = 0.0009
    private const val PIN = 0.0015
    private const val TOP = 0.014
    private fun root(v: Double): Double {
      if (v <= 0) return 0.0
      var r = 0.2
      repeat(12) { r = (2 * r + v / (r * r)) / 3 }
      return r
    }
    private fun ease(lo: Double, hi: Double, value: Double): Double {
      val t = min(1.0, max(0.0, (value - lo) / (hi - lo)))
      return t * t * (3 - 2 * t)
    }
    private fun pack(x: Double, y: Double): Float {
      val qx = floor(min(1.0, max(0.0, (x + 1.2) / 2.4)) * 4095 + 0.5)
      val qy = floor(min(1.0, max(0.0, (y + 1.2) / 2.4)) * 4095 + 0.5)
      return (qx * 4096 + qy).toFloat()
    }
  }
  var done = 0
    private set
  private var frac = 0.0
  private var paused = false
  private var pausedAt = 0.0
  var dynamic = false
    private set
  private var time = 0.0
  private var tau = 0.0
  private var film = 0.0
  private val contactHead = IntArray(256) { -1 }
  private val contactNext = IntArray(DROPS) { -1 }
  private val contactMask = IntArray(DROPS / 32)
  private var seed = 0x2f6b9d35
  private val live = IntArray(DROPS)
  private val x = DoubleArray(DROPS)
  private val y = DoubleArray(DROPS)
  private val z = DoubleArray(DROPS)
  private val r = DoubleArray(DROPS)
  private val stretch = DoubleArray(DROPS)
  private val pstretch = DoubleArray(DROPS)
  private val heading = DoubleArray(DROPS) { -Math.PI / 2 }
  private val pheading = DoubleArray(DROPS) { -Math.PI / 2 }
  private val px = DoubleArray(DROPS)
  private val py = DoubleArray(DROPS)
  private val pr = DoubleArray(DROPS)
  private val goal = DoubleArray(DROPS)
  private val vx = DoubleArray(DROPS)
  private val vy = DoubleArray(DROPS)
  private val vz = DoubleArray(DROPS)
  private val stick = DoubleArray(DROPS)
  private val shed = DoubleArray(DROPS)
  private val last = DoubleArray(DROPS)
  private val age = DoubleArray(DROPS)
  private val travel = DoubleArray(DROPS)
  private val own = IntArray(DROPS) { -1 }
  private val untouched = IntArray(DROPS)
  private val owner = IntArray(TRAILS) { -1 }
  private val source = IntArray(TRAILS) { -1 }
  private val path = DoubleArray(TRAILS * POINTS * 2)
  private val count = IntArray(TRAILS)
  private val width = DoubleArray(TRAILS)
  private val stamp = DoubleArray(TRAILS * POINTS)
  private val hold = IntArray(DROPS)

  private val pair = IntArray(DROPS) { -1 }
  private val started = DoubleArray(DROPS)
  private val phase = DoubleArray(DROPS)
  private val pphase = DoubleArray(DROPS)
  private val mass = DoubleArray(DROPS)
  private val radius0 = DoubleArray(DROPS)
  private val render0 = DoubleArray(DROPS)
  private val joinx = DoubleArray(DROPS)
  private val joiny = DoubleArray(DROPS)
  private val joinz = DoubleArray(DROPS)

  init {
    val n = program.static[(program.rain.counts - program.staticSlot) * 4].toInt()
    for (i in 0 until n) {
      val at = (program.rain.drops - program.staticSlot + i) * 4
      place(i, program.static[at].toDouble(), program.static[at + 1].toDouble(), program.static[at + 2].toDouble(), i)
    }
  }
  fun rebind(next: OrbProgram) { program = next }
  private fun rand(): Double {
    val t = seed + 0x6d2b79f5
    seed = t
    var v = (t xor (t ushr 15)) * (t or 1)
    v = v xor (v + ((v xor (v ushr 7)) * (v or 61)))
    return ((v xor (v ushr 14)).toLong() and 0xffffffffL).toDouble() / 4294967296.0
  }
  private fun place(i: Int, atx: Double, aty: Double, radius: Double, authored: Int) {
    pair[i] = -1; phase[i] = 0.0; pphase[i] = 0.0
    live[i] = 1; x[i] = atx; y[i] = aty; z[i] = sqrt(max(0.0001, 1 - atx * atx - aty * aty))
    stretch[i] = 0.0; pstretch[i] = 0.0; heading[i] = -Math.PI / 2; pheading[i] = -Math.PI / 2
    r[i] = radius; px[i] = atx; py[i] = aty; pr[i] = radius; goal[i] = radius
    vx[i] = 0.0; vy[i] = 0.0; vz[i] = 0.0
    stick[i] = 0.55 + rand() * 0.9; last[i] = 0.0; shed[i] = 0.12 + 0.32 * rand(); age[i] = 0.0; hold[i] = 0; own[i] = authored
    untouched[i] = if (authored >= 0) 1 else 0
  }
  private fun arrive(i: Int, radius: Double, authored: Int, spawn: Double, gx: Double, gy: Double, impact: Double): Boolean {
    val side = rand() * 1.9 - 0.95
    val scattered = rand() * 1.9 - 0.95
    val edge = 0.82 + 0.12 * rand()
    val along = scattered + (edge - scattered) * spawn
    val across = side * sqrt(max(0.0, 1 - along * along * spawn))
    val sx = -across * gy - along * gx; val sy = across * gx - along * gy
    if (i < 0 || sx * sx + sy * sy >= 0.95) return false
    place(i, sx, sy, 0.0, authored); goal[i] = radius; untouched[i] = 0
    if (impact > 0) {
      val radial = sx * gx + sy * gy
      vx[i] = impact * (gx - radial * sx); vy[i] = impact * (gy - radial * sy)
      vz[i] = -impact * radial * z[i]
    }
    return true
  }
  private fun active(i: Int, amount: Double, n: Int): Boolean = live[i] == 1 && (own[i] < 0 || amount * n > own[i])
  private fun free(): Int {
    for (i in 16 until DROPS) if (live[i] == 0) return i
    return -1
  }
  // Freeze full chunks rather than shifting a still-clear tail out of the history.
  private fun release(i: Int) {
    releaseTrail(i, x[i], y[i], time)
  }
  fun releaseTrail(i: Int, sx: Double, sy: Double, now: Double) {
    for (k in 0 until TRAILS) {
      if (owner[k] != i) continue
      val at = k * POINTS * 2; val age = k * POINTS
      for (j in (POINTS - 1) downTo 1) {
        path[at + j * 2] = path[at + (j - 1) * 2]
        path[at + j * 2 + 1] = path[at + (j - 1) * 2 + 1]
        stamp[age + j] = stamp[age + j - 1]
      }
      path[at] = sx; path[at + 1] = sy; stamp[age] = now
      count[k] = min(POINTS, count[k] + 1); owner[k] = -1
    }
  }
  private fun trail(i: Int) {
    traceTrail(i, own[i], x[i], y[i], px[i], py[i], r[i], time)
  }
  fun traceTrail(i: Int, origin: Int, sx: Double, sy: Double,
                 prevX: Double, prevY: Double, radius: Double, now: Double) {
    var slot = -1
    for (k in 0 until TRAILS) if (owner[k] == i) slot = k
    if (slot >= 0) {
      val at = slot * POINTS * 2; val dx = sx - path[at]; val dy = sy - path[at + 1]
      if (dx * dx + dy * dy < 0.002025) return
      if (count[slot] >= POINTS - 1) { releaseTrail(i, sx, sy, now); slot = -1 }
    }
    if (slot < 0) {
      for (k in 0 until TRAILS) {
        if (count[k] == 0 || (owner[k] < 0 && now - stamp[k * POINTS] >= 8)) { slot = k; break }
      }
      if (slot < 0) return
      owner[slot] = i; source[slot] = origin; count[slot] = 1
      path[slot * POINTS * 2] = prevX; path[slot * POINTS * 2 + 1] = prevY
      stamp[slot * POINTS] = max(0.0, now - 1.0 / 60); width[slot] = radius
      return
    }
    val at = slot * POINTS * 2; val age = slot * POINTS
    for (k in (POINTS - 1) downTo 1) {
      path[at + k * 2] = path[at + (k - 1) * 2]
      path[at + k * 2 + 1] = path[at + (k - 1) * 2 + 1]
      stamp[age + k] = stamp[age + k - 1]
    }
    path[at] = sx; path[at + 1] = sy; stamp[age] = now
    count[slot] = min(POINTS - 1, count[slot] + 1); width[slot] = max(width[slot], radius)
  }
  fun releaseSnowTrails(snow: OrbSnow, now: Double) {
    for (drop in owner) {
      if (drop < DROPS) continue
      val i = drop - DROPS
      if (!snow.isAttached(i)) {
        val at = snow.trailPosition(i, false)
        releaseTrail(drop, at.first, at.second, now)
      }
    }
  }
  private fun extent(i: Int, dx: Double, dy: Double, dz: Double, distance: Double): Double {
    val hx = cos(heading[i]); val hy = sin(heading[i])
    val hz = -(x[i] * hx + y[i] * hy) / max(z[i], 0.00001)
    val norm = sqrt(hx * hx + hy * hy + hz * hz)
    val along = (dx * hx + dy * hy + dz * hz) / (distance * norm)
    val drive = stretch[i]; val length = 1 + 0.32 * drive; val across2 = max(0.0, 1 - along * along)
    var reach = r[i] / sqrt(across2 * length + along * along / (length * length))
    repeat(3) {
      val offset = 0.06 * drive * r[i]
      val q = (reach * along + offset) / max(r[i] * length, 0.000001)
      val taper = 1 + 0.14 * drive * min(1.0, max(-1.0, q))
      val aa = across2 * length / (taper * taper) + along * along / (length * length)
      val bb = 2 * along * offset / (length * length)
      val cc = offset * offset / (length * length) - r[i] * r[i]
      reach = (-bb + sqrt(bb * bb - 4 * aa * cc)) / (2 * aa)
    }
    return reach
  }
  private fun touches(i: Int, j: Int): Boolean {
    val dx = x[j] - x[i]; val dy = y[j] - y[i]; val dz = z[j] - z[i]
    val d2 = dx * dx + dy * dy + dz * dz; val broad = 2.25 * (r[i] + r[j])
    if (d2 >= broad * broad) return false
    val distance = sqrt(max(d2, 0.000000000001))
    val reach = extent(i, dx, dy, dz, distance) + extent(j, -dx, -dy, -dz, distance)
    return distance < reach
  }
  private fun contactCell(value: Double): Int = max(0, min(15, floor((value + 1) * 8).toInt()))
  private fun driver(i: Int, j: Int, gx: Double, gy: Double): Int {
    val a = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]
    val b = vx[j] * vx[j] + vy[j] * vy[j] + vz[j] * vz[j]
    if (max(a, b) < 0.00000001) return if (x[i] * gx + y[i] * gy >= x[j] * gx + y[j] * gy) i else j
    return if (a >= b) i else j
  }
  private fun merge(i: Int, j: Int) {
    val a = goal[i] * goal[i] * goal[i]; val b = goal[j] * goal[j] * goal[j]; val w = b / (a + b)
    val area = goal[j] * goal[j] / (goal[i] * goal[i] + goal[j] * goal[j])
    joinx[i] = x[j] - x[i]; joiny[i] = y[j] - y[i]; joinz[i] = z[j] - z[i]
    mass[i] = a + b; mass[j] = b; radius0[i] = goal[i]; radius0[j] = goal[j]
    render0[i] = r[i]; render0[j] = r[j]
    pair[i] = j; pair[j] = i; started[i] = time; phase[i] = 0.0; pphase[i] = 0.0
    val speed = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
    if (speed > 0.00000001) {
      val along = (joinx[i] * vx[i] + joiny[i] * vy[i] + joinz[i] * vz[i]) / (speed * speed)
      val radial = joinx[i] * x[i] + joiny[i] * y[i] + joinz[i] * z[i]
      val sx = joinx[i] - vx[i] * along - x[i] * radial
      val sy = joiny[i] - vy[i] * along - y[i] * radial
      val sz = joinz[i] - vz[i] * along - z[i] * radial
      val side = sqrt(sx * sx + sy * sy + sz * sz)
      val impulse = min(0.00075, speed * 0.18) / max(side, 0.000001)
      vx[i] = vx[i] + sx * impulse; vy[i] = vy[i] + sy * impulse; vz[i] = vz[i] + sz * impulse
    }
    val drag = 0.76 - 0.2 * area
    vx[i] = (vx[i] * (1 - 0.3 * w) + vx[j] * 0.3 * w) * drag
    vy[i] = (vy[i] * (1 - 0.3 * w) + vy[j] * 0.3 * w) * drag
    vz[i] = (vz[i] * (1 - 0.3 * w) + vz[j] * 0.3 * w) * drag
    hold[i] = max(hold[i], 3 + floor(area * 3 + 0.5).toInt())
    untouched[i] = 0; untouched[j] = 0; live[j] = 2; travel[j] = 1.0; release(j)
  }
  // Contact-line coalescence follows the moving head; no attraction of either centre.
  private fun coalesce(i: Int) {
    val j = pair[i]
    val p = min(1.0, max(0.0, (time - started[i]) / 0.20))
    val donor = radius0[j] * (1 - ease(0.14, 1.0, p))
    goal[j] = donor; goal[i] = root(mass[i] - donor * donor * donor)
    val grown = ease(0.0, 0.30, p)
    r[i] = render0[i] + (goal[i] - render0[i]) * grown
    r[j] = render0[j] + (donor - render0[j]) * grown; phase[i] = p
    if (p >= 1) { live[j] = 0; age[j] = 0.0; pair[i] = -1; pair[j] = -1 }
  }
  private fun step(dials: FloatArray, at: Double, motion: Double) {
    time = floor(at * 1000 + 0.5) / 1000
    val amount = dials[program.rain.amount].toDouble(); val density = dials[program.rain.density].toDouble()
    val spawn = dials[program.rain.spawn].toDouble()
    val angle = dials[program.rain.direction].toDouble() * Math.PI / 180
    val gx = sin(angle); val gy = -cos(angle)
    val strength = dials[program.rain.windSpeed].toDouble() + max(0.0,(dials[program.rain.gusts]-dials[program.rain.windSpeed]).toDouble()) * (0.5+0.28*sin(time*0.73)+0.22*sin(time*1.37+1.9)) * dials[program.rain.turbulence].toDouble()
    val gustAngle = strength * 0.45 * sin(time*0.81)
    val incoming = if (program.rain.angle < 0) angle else min(80.0, max(-80.0, dials[program.rain.angle].toDouble() + gustAngle + dials[program.rain.wind].toDouble())) * Math.PI / 180
    val ax = sin(incoming); val ay = -cos(incoming)
    val impact = if (program.rain.angle < 0) 0.0 else 0.009 * abs(ax) * (1+strength*0.08)
    val n = program.static[(program.rain.counts - program.staticSlot) * 4].toInt()
    dynamic = false
    var population = 0
    for (i in 0 until DROPS) { px[i] = x[i]; py[i] = y[i]; pr[i] = r[i]; pphase[i] = phase[i]; pstretch[i] = stretch[i]; pheading[i] = heading[i]; if (live[i] > 0 && own[i] < 0) dynamic = true; if (live[i] == 1 && own[i] < 0) population++ }
    val target = 24 * density + 330 * density * density
    if (density > 0 && population < target) {
      for (k in 0 until 9) {
        if (k >= 1 + floor(8 * density * density).toInt() || rand() > density * 0.9) break
        val i = free()
        val radius = (0.009 + rand() * rand() * 0.04) * dials[program.rain.size].toDouble()
        if (arrive(i, radius, -1, spawn, ax, ay, impact)) { population++; dynamic = true }
        if (population >= target) break
      }
    }
    for (i in 0 until DROPS) {
      if (live[i] == 0 && own[i] >= 0 && amount * n > own[i]) {
        age[i] = age[i] + 1
        if (age[i] > 120) {
          val at = (program.rain.drops - program.staticSlot + own[i]) * 4
          arrive(i, program.static[at + 2].toDouble(), own[i], spawn, ax, ay, impact)
        }
      }
      if (live[i] == 2) continue
      if (live[i] == 3) {
        vx[i] = vx[i] + GRAVITY * gx * motion; vy[i] = vy[i] + GRAVITY * gy * motion
        x[i] = x[i] + vx[i]; y[i] = y[i] + vy[i]
        if (x[i] * gx + y[i] * gy > 1.2 + r[i]) live[i] = 0
        continue
      }
      if (!active(i, amount, n)) continue
      r[i] = r[i] + (goal[i] - r[i]) * 0.25
      var sx = x[i]; var sy = y[i]; var sz = z[i]
      val norm = sqrt(sx * sx + sy * sy + sz * sz); sx /= norm; sy /= norm; sz /= norm
      val pole = sx * gx + sy * gy
      val slope = sqrt(max(0.0, 1 - pole * pole)); val speed = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
      val force = goal[i] * goal[i] * slope; val resistance = PIN * stick[i] * (if (speed > 0.0002) 0.35 else 1.0)
      if (hold[i] > 0) {
        hold[i] = max(0, hold[i] - 1)
        vx[i] = vx[i] * 0.86; vy[i] = vy[i] * 0.86; vz[i] = vz[i] * 0.86
      } else if (force > resistance) {
        val gain = GRAVITY * motion * (1 - resistance / force)
        vx[i] = (vx[i] + gain * (gx - pole * sx)) * 0.92.pow(motion); vy[i] = (vy[i] + gain * (gy - pole * sy)) * 0.92.pow(motion); vz[i] = (vz[i] - gain * pole * sz) * 0.92.pow(motion)
      } else { vx[i] = vx[i] * 0.65; vy[i] = vy[i] * 0.65; vz[i] = vz[i] * 0.65 }
      val radial = vx[i] * sx + vy[i] * sy + vz[i] * sz
      vx[i] = vx[i] - radial * sx; vy[i] = vy[i] - radial * sy; vz[i] = vz[i] - radial * sz
      // Glass adhesion dissipates wind/contact impulses that push attached water uphill.
      if (vx[i] * gx + vy[i] * gy < 0) { vx[i] = 0.0; vy[i] = 0.0; vz[i] = 0.0 }
      val v = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]); val limit = min(1.0, TOP / max(v, 0.000001))
      vx[i] = vx[i] * limit; vy[i] = vy[i] * limit; vz[i] = vz[i] * limit
      sx += vx[i] * motion; sy += vy[i] * motion; sz += vz[i] * motion
      val norm2 = sqrt(sx * sx + sy * sy + sz * sz); x[i] = sx / norm2; y[i] = sy / norm2; z[i] = sz / norm2
      val dx = x[i] - px[i]; val dy = y[i] - py[i]
      val wanted = min(1.0, v * motion / 0.004) * min(1.0, goal[i] / 0.035)
      stretch[i] = stretch[i] + (wanted - stretch[i]) * 0.08
      if (v > 0.0001) {
        val turn = atan2(vy[i], vx[i]) - heading[i]
        heading[i] = heading[i] + atan2(sin(turn), cos(turn)) * 0.08
      }
      if (dx * dx + dy * dy > 0.00000001) {
        untouched[i] = 0; if (r[i] > 0.025) trail(i)
        travel[i] = travel[i] + sqrt(dx * dx + dy * dy)
        last[i] = last[i] + v * motion
        val patch = x[i] * 17 + y[i] * 11 + z[i] * 5 + stick[i]
        val triangle = 2 * abs(patch - floor(patch) - 0.5)
        val held = goal[i] * goal[i] * goal[i]
        val loss = held * min(0.02, v * motion * (0.10 + 0.55 * triangle * triangle))
        film += loss; goal[i] = root(held - loss)
        if (pair[i] >= 0) mass[i] = mass[i] - loss
        if (pair[i] < 0 && last[i] > shed[i]) {
          last[i] = 0.0; shed[i] = 0.12 + 0.32 * rand(); stick[i] = 0.55 + rand() * 0.9
          val j = free()
          if (j >= 0 && goal[i] > 0.04 && x[i] * gx + y[i] * gy < 0.9 && v > 0.0005 && rand() < 0.35) {
            val bead = goal[i] * (0.08 + 0.2 * rand())
            val rear = extent(i, -vx[i], -vy[i], -vz[i], v)
            val gap = (rear + bead) * (1.15 + 0.35 * rand()) / v
            val side = (rand() - 0.5) * r[i] * 0.65 / v
            val bx = x[i] - vx[i] * gap + (y[i] * vz[i] - z[i] * vy[i]) * side
            val by = y[i] - vy[i] * gap + (z[i] * vx[i] - x[i] * vz[i]) * side
            val bz = z[i] - vz[i] * gap + (x[i] * vy[i] - y[i] * vx[i]) * side
            val norm = sqrt(bx * bx + by * by + bz * bz)
            place(j, bx / norm, by / norm, bead, -1)
            goal[i] = root(goal[i] * goal[i] * goal[i] - bead * bead * bead)
          }
        }
      }
    }
    for (i in 0 until DROPS) {
      if (live[i] == 1 && pair[i] >= 0) coalesce(i)
      if (!active(i, amount, n)) continue
      if (pair[i] >= 0) continue
      val overloaded = goal[i] > 0.14
      if (overloaded || x[i] * gx + y[i] * gy > 0.96) {
        age[i] = age[i] + 1
        if (overloaded || goal[i] > 0.075 || age[i] > 90) {
          live[i] = 3
          val along = vx[i] * gx + vy[i] * gy
          vx[i] = vx[i] + gx * (0.006 - along); vy[i] = vy[i] + gy * (0.006 - along)
          release(i)
        }
      } else if (z[i] < 0.04) { live[i] = 0; release(i) }
    }
    contactHead.fill(-1)
    var maxRadius = 0.0
    for (i in 0 until DROPS) {
      if (pair[i] >= 0 || !active(i, amount, n)) continue
      val at = contactCell(x[i]) + contactCell(y[i]) * 16
      contactNext[i] = contactHead[at]; contactHead[at] = i
      maxRadius = max(maxRadius, r[i])
    }
    for (i in 0 until DROPS) {
      if (pair[i] >= 0 || !active(i, amount, n)) continue
      contactMask.fill(0)
      val reach = 2.25 * (r[i] + maxRadius)
      val lowX = contactCell(x[i] - reach); val highX = contactCell(x[i] + reach)
      val lowY = contactCell(y[i] - reach); val highY = contactCell(y[i] + reach)
      for (cy in lowY..highY) {
        for (cx in lowX..highX) {
          var j = contactHead[cx + cy * 16]
          while (j >= 0) {
            if (j > i) contactMask[j ushr 5] = contactMask[j ushr 5] or (1 shl (j and 31))
            j = contactNext[j]
          }
        }
      }
      for (word in (i ushr 5) until contactMask.size) {
        if (pair[i] >= 0) break
        var bits = contactMask[word]
        while (bits != 0 && pair[i] < 0) {
          val bit = bits and -bits
          val j = word * 32 + Integer.numberOfTrailingZeros(bit)
          bits = bits xor bit
          if (pair[j] >= 0 || !touches(i, j)) continue
          val head = driver(i, j, gx, gy)
          merge(head, if (head == i) j else i)
        }
      }
    }
    done++
  }
  fun runTo(nextTau: Double, dials: FloatArray, most: Int, nextTime: Double) {
    val target = floor(nextTime * 60 + 1e-3).toInt()
    if (dials[program.rain.enabled] < 0.5f || (dials[program.rain.amount] <= 0 && dials[program.rain.density] <= 0 && !dynamic)) {
      if (!paused) pausedAt = time
      done = target; time = nextTime; tau = nextTau; frac = 1.0; paused = true; return
    }
    if (paused) {
      for (i in 0 until DROPS) if (pair[i] >= 0) started[i] += time - pausedAt
      x.copyInto(px); y.copyInto(py); r.copyInto(pr); phase.copyInto(pphase); stretch.copyInto(pstretch); heading.copyInto(pheading); paused = false
    }
    if (target - done > most) done = target - most
    val elapsed = nextTime - time; val advanced = nextTau - tau
    val motion = if (elapsed > 0) max(0.0,advanced / elapsed) else 0.0
    while (done < target) { step(dials,(done + 1).toDouble() / 60,motion) }
    time = nextTime; tau = nextTau
    frac = min(1.0, max(0.0, nextTime * 60 + 1e-3 - target))
  }
  fun wet(now: Double, rainEnabled: Boolean, snowEnabled: Boolean, hailEnabled: Boolean): Pair<Boolean, Boolean> {
    var wetRain = false; var wetSnow = false
    if (rainEnabled || snowEnabled || hailEnabled) for (i in 0 until TRAILS) {
      if (count[i] <= 0) continue
      val isSnow = source[i] <= -2
      if (if (source[i] == -3) !hailEnabled else if (isSnow) !snowEnabled else !rainEnabled) continue
      if (owner[i] < 0 && now - stamp[i * POINTS] >= 8) continue
      if (isSnow) wetSnow = true else wetRain = true
    }
    return Pair(wetRain, wetSnow)
  }
  fun write(out: FloatArray, snow: OrbSnow? = null, drawDrops: Boolean = true, drawTrails: Boolean = true) {
    for (i in 0 until (if (drawDrops) DROPS else 0)) {
      val at = (program.rain.pool + i * 2) * 4
      val sx = px[i] + (x[i] - px[i]) * frac; val sy = py[i] + (y[i] - py[i]) * frac; val radius = pr[i] + (r[i] - pr[i]) * frac
      val drive = pstretch[i] + (stretch[i] - pstretch[i]) * frac
      val head = pheading[i] + (heading[i] - pheading[i]) * frac
      val angle = atan2(sin(head), cos(head))
      val shape = floor((angle + Math.PI) / (2 * Math.PI) * 4095 + 0.5) + 4096 * floor(drive * 4095 + 0.5)
      out[at] = pack(sx, sy); out[at + 1] = if (live[i] > 0) radius.toFloat() else 0f
      val j = pair[i]
      out[at + 2] = ((shape + 1) * (if (live[i] == 2) -1 else 1)).toFloat()
      val p = pphase[i] + (phase[i] - pphase[i]) * frac
      out[at + 3] = if (j < 0 || live[i] != 1) 0f else (min(radius0[i], radius0[j]) * (0.08 + 0.62 * ease(0.0, 0.25, p)) * (1 - ease(0.60, 1.0, p))).toFloat()
    }
    for (i in 0 until (if (drawDrops) DROPS else 0)) {
      val at = (program.rain.pool + i * 2) * 4; val j = pair[i]
      val partner = if (j < 0) at else (program.rain.pool + j * 2) * 4
      out[at + 4] = out[partner]; out[at + 5] = if (j < 0) 0f else out[partner + 1]
      out[at + 6] = if (j < 0) -1f else own[j].toFloat(); out[at + 7] = if (j < 0) 0f else abs(out[partner + 2]) - 1
    }
    for (i in 0 until (if (drawTrails) TRAILS else 0)) {
      val at = (program.rain.trails + i * 8) * 4; val n = count[i]; val drop = owner[i]
      if (n <= 0 || (drop < 0 && time - stamp[i * POINTS] >= 8)) { out[at + 24] = 0f; continue }
      var loX = 2.0; var loY = 2.0; var hiX = -2.0; var hiY = -2.0
      for (k in 0 until POINTS) {
        val p = max(0, min(if (drop >= 0) k - 1 else k, n - 1))
        var sx = path[(i * POINTS + p) * 2]; var sy = path[(i * POINTS + p) * 2 + 1]
        var age = stamp[i * POINTS + p]
        if (k == 0 && drop >= 0) {
          if (drop < DROPS) {
            sx = px[drop] + (x[drop] - px[drop]) * frac; sy = py[drop] + (y[drop] - py[drop]) * frac
          } else if (snow != null) {
            val at = snow.trailPosition(drop - DROPS)
            sx = at.first; sy = at.second
          }
          age = time
        }
        out[at + k] = pack(sx, sy); out[at + POINTS + k] = age.toFloat()
        loX = min(loX, sx); loY = min(loY, sy); hiX = max(hiX, sx); hiY = max(hiY, sy)
      }
      out[at + 24] = if (n > 0) width[i].toFloat() else 0f
      out[at + 25] = source[i].toFloat(); out[at + 26] = min(POINTS, n + (if (drop >= 0) 1 else 0)).toFloat()
      out[at + 27] = 0f
      out[at + 28] = loX.toFloat(); out[at + 29] = loY.toFloat(); out[at + 30] = hiX.toFloat(); out[at + 31] = hiY.toFloat()
    }
  }
}
