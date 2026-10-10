package io.github.amirabushanab.orb3d

import kotlin.math.cos
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Persistent surface snow. Operation-for-operation port of program/snow.ts. */
internal class OrbSnow {
  private val n = 64
  private val step = 1.0 / 60
  private var done = 0
  private var frac = 0.0
  private var paused = false
  val hasParticles: Boolean get() = live.any { it > 0 }
  private var seed = 0x73a92c41
  private var serial = 0
  private var arrivals = 0.0
  private var hailArrivals = 0.0
  private val kind = IntArray(n)
  private var supplied = 0.0
  private var escaped = 0.0
  private var evaporated = 0.0
  private var film = 0.0
  private val live = IntArray(n)
  private val id = IntArray(n)
  private val pair = IntArray(n) { -1 }
  private val x = DoubleArray(n)
  private val y = DoubleArray(n)
  private val px = DoubleArray(n)
  private val py = DoubleArray(n)
  private val radius = DoubleArray(n)
  private val pradius = DoubleArray(n)
  private val ice = DoubleArray(n)
  private val water = DoubleArray(n)
  private val phase = DoubleArray(n)
  private val pphase = DoubleArray(n)
  private val age = DoubleArray(n)
  private val flight = DoubleArray(n)
  private val targetX = DoubleArray(n)
  private val targetY = DoubleArray(n)
  private val incomingX = DoubleArray(n)
  private val incomingY = DoubleArray(n)
  private val vx = DoubleArray(n)
  private val vy = DoubleArray(n)
  private val compact = DoubleArray(n)
  private val transfer = DoubleArray(n)

  private fun random(): Double {
    seed = seed * 1664525 + 1013904223
    return (seed.toLong() and 0xffffffffL).toDouble() / 4294967296.0
  }
  private fun root(value: Double): Double {
    if (value <= 0) return 0.0
    var r = 0.2
    repeat(16) { r = (2 * r + value / (r * r)) / 3 }
    return r
  }
  private fun spawn(i: Int, spread: Double, angle: Double, size: Double, material: Int = 0) {
    val ax = sin(angle); val ay = -cos(angle)
    var atx = 0.0; var aty = 0.0
    for (attempt in 0 until 12) {
      val side = random() * 1.9 - 0.95
      val scattered = random() * 1.9 - 0.95
      val edge = 0.77 + 0.16 * random()
      val along = edge * (1 - spread) + scattered * spread
      val across = side * sqrt(max(0.0, 1 - along * along * (1 - spread)))
      atx = -across * ay - along * ax; aty = across * ax - along * ay
      if (atx * atx + aty * aty < 0.91) break
    }
    val r = size * (if (material == 1) 0.014 + 0.022 * random() else 0.024 + 0.032 * random())
    kind[i] = material
    serial = (serial + 1) % 16777216
    id[i] = serial; live[i] = 1
    targetX[i] = atx; targetY[i] = aty; incomingX[i] = ax; incomingY[i] = ay
    flight[i] = 0.18 + 0.42 * random()
    x[i] = atx - ax * flight[i]; y[i] = aty - ay * flight[i]
    px[i] = x[i]; py[i] = y[i]; radius[i] = r; pradius[i] = r
    ice[i] = r * r * r; water[i] = 0.0
    phase[i] = 1 + flight[i]; pphase[i] = phase[i]
    age[i] = 0.0; vx[i] = 0.0; vy[i] = 0.0; pair[i] = -1; compact[i] = 0.0
    supplied += ice[i]
  }
  private fun retireMelt(i: Int, rain: OrbRain?, time: Double): Boolean {
    if (live[i] != 2 || ice[i] > 0) return false
    val r = root(water[i])*0.34
    if (r > 0) {
      rain?.traceTrail(384+i,if(kind[i] == 1) -3 else -2,x[i],y[i],x[i],y[i],r,time)
      rain?.releaseTrail(384+i,x[i],y[i],time)
    }
    film += water[i]; water[i]=0.0; live[i]=0; radius[i]=0.0
    return true
  }
  private fun tick(layout: OrbProgram.Snow, dials: FloatArray, level: Double, rain: OrbRain?) {
    fun read(at: Int) = dials[at].toDouble()
    val amount = if (read(layout.enabled) < 0.5) 0.0 else min(1.0, max(0.0, read(layout.amount) + read(layout.react) * level))
    val hail = if (read(layout.hailEnabled) < 0.5) 0.0 else read(layout.hailAmount)
    val now = (done+1.0)/60
    val strength = read(layout.windSpeed) + max(0.0,read(layout.gusts)-read(layout.windSpeed)) * (0.5+0.28*sin(now*0.73)+0.22*sin(now*1.37+1.9)) * read(layout.turbulence)
    val fall = max(0.0, read(layout.fall)); val stick = min(1.0, max(0.0, read(layout.stick)))
    val melt = max(0.0, read(layout.melt)); val angle = min(80.0, max(-80.0, read(layout.angle) + read(layout.wind) + strength * 0.45 * sin(now*0.81))) * Math.PI / 180
    val gravity = read(layout.gravity) * Math.PI / 180
    val gx = sin(gravity); val gy = -cos(gravity)
    val time = floor((done + 1.0) / 60 * 1000 + 0.5) / 1000
    for (i in 0 until n) { px[i] = x[i]; py[i] = y[i]; pradius[i] = radius[i]; pphase[i] = phase[i] }
    arrivals += amount * read(layout.density) * (2 + 25 * read(layout.density)) * fall * step
    for (i in 0 until n) {
      if (arrivals < 1) break
      if (live[i] != 0 && ((if(kind[i] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5 || !retireMelt(i,rain,time))) continue
      spawn(i, read(layout.dispersion), angle, read(layout.size)); arrivals--
    }
    arrivals = min(arrivals, 1.0)
    val density = read(layout.hailDensity)
    hailArrivals += hail * density * (2+18*density) * step
    for (i in 0 until n) {
      if (hailArrivals < 1) break
      if (live[i] != 0 && ((if(kind[i] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5 || !retireMelt(i,rain,time))) continue
      spawn(i,0.8,angle,read(layout.hailSize),1); hailArrivals--
    }
    hailArrivals = min(hailArrivals,1.0)
    for (i in 0 until n) {
      if (live[i] == 0) continue
      if ((if (kind[i] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5) continue
      if (live[i] == 4) {
        age[i] += step
        val h = max(0.0,read(layout.hailBounce)*age[i]*0.9-age[i]*age[i]*1.6)
        x[i] = targetX[i]-incomingX[i]*h; y[i] = targetY[i]-incomingY[i]*h; phase[i] = 1+h
        if (h <= 0) { live[i] = 2; phase[i] = 1.0; age[i] = 0.0 }
        continue
      }
      if (live[i] == 1) {
        val h = max(0.0, flight[i] - (0.18 + 0.08 * (id[i] % 7) / 7) * (if (kind[i] == 1) 4.0 else fall * (1+strength*0.015)) * step)
        flight[i] = h
        val flutter = (if (kind[i] == 1) 0.0 else 0.018) * h * sin(h * 9 + id[i] * 0.7)
        x[i] = targetX[i] - incomingX[i] * h - incomingY[i] * flutter
        y[i] = targetY[i] - incomingY[i] * h + incomingX[i] * flutter
        phase[i] = 1 + h
        if (h <= 0) { live[i] = if (kind[i] == 1 && read(layout.hailBounce) > 0) 4 else 2; vx[i] = incomingX[i] * 0.0025 * fall; vy[i] = incomingY[i] * 0.0025 * fall }
        continue
      }
      age[i] += step
      val total = ice[i] + water[i]
      if (total <= 1e-12) { live[i] = 0; radius[i] = 0.0; continue }
      val r = root(total); val heat = 0.75 + 0.5 * ((id[i] * 37) % 101) / 100
      val thaw = min(ice[i], 0.009 * (if (kind[i] == 1) read(layout.hailMelt) else melt) * heat * r * r * step)
      ice[i] -= thaw; water[i] += thaw
      val frozen = ice[i] / total; val wetRadius = 0.34 * root(water[i])
      val mobility = (1 - (if (kind[i] == 1) 0.65 else stick)) * 0.15 * frozen + (1 - frozen) * (1 - frozen) * max(0.0, wetRadius - 0.008) * 20
      val projection = x[i] * gx + y[i] * gy
      vx[i] = vx[i] * (0.84 + 0.08 * (1 - frozen)) + 0.00065 * mobility * (gx - projection * x[i])
      vy[i] = vy[i] * (0.84 + 0.08 * (1 - frozen)) + 0.00065 * mobility * (gy - projection * y[i])
      if (live[i] == 2) {
        x[i] += vx[i]; y[i] += vy[i]
        val distance = hypot(x[i] - px[i], y[i] - py[i])
        if (distance > 0.0001 && wetRadius > 0.006 && frozen < 0.8) {
          rain?.traceTrail(384 + i, if (kind[i] == 1) -3 else -2, x[i], y[i], px[i], py[i], wetRadius, time)
          val z = sqrt(max(0.02, 1 - x[i] * x[i] - y[i] * y[i]))
          val patch = x[i] * 17 + y[i] * 11 + z * 5 + id[i] * 0.01
          val triangle = 2 * abs(patch - floor(patch) - 0.5)
          val loss = water[i] * min(0.02, distance * (0.1 + 0.55 * triangle * triangle))
          water[i] -= loss; film += loss
        }
      }
      radius[i] = root(ice[i] + water[i])
      phase[i] = if (frozen > 0) frozen else -min(1.0, sqrt(vx[i] * vx[i] + vy[i] * vy[i]) * 250 + 0.00001)
      if (age[i] > 20 && frozen == 0.0) {
        val evaporate = min(water[i], 0.00006 * r * r * step)
        water[i] -= evaporate; evaporated += evaporate
      }
      if (x[i] * x[i] + y[i] * y[i] > 1.06 * 1.06) {
        escaped += ice[i] + water[i]; ice[i] = 0.0; water[i] = 0.0; live[i] = 0; radius[i] = 0.0
      }
    }
    for (i in 0 until n) {
      if (live[i] != 3 || (if (kind[i] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5) continue
      val j = pair[i]
      if (j >= 0 && (if (kind[j] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5) continue
      if (j < 0 || live[j] != 2) { live[i] = 2; pair[i] = -1; continue }
      val total = ice[i] + water[i]; val moved = min(total, transfer[i] * step)
      val dx = x[j] - x[i]; val dy = y[j] - y[i]
      val zi = sqrt(max(0.02, 1 - x[i] * x[i] - y[i] * y[i])); val zj = sqrt(max(0.02, 1 - x[j] * x[j] - y[j] * y[j]))
      val reach = 0.34 * (root(water[i]) + root(water[j]))
      val connected = dx * dx + dy * dy + (zi - zj) * (zi - zj) <= reach * reach
      val liquid = if (connected) min(water[i], moved * water[i] / max(total, 1e-20)) else 0.0
      val frozen = min(ice[i], moved - liquid)
      ice[i] -= frozen; water[i] -= liquid; ice[j] += frozen; water[j] += liquid
      compact[j] = min(1.0, compact[j] + (frozen + liquid) / max(ice[j] + water[j], 1e-20) * 0.33)
      vx[j] *= 0.85; vy[j] *= 0.85
      radius[i] = root(ice[i] + water[i]); radius[j] = root(ice[j] + water[j])
      if (ice[i] + water[i] <= 1e-15) { live[i] = 0; radius[i] = 0.0; pair[i] = -1 }
      else if (ice[i] == 0.0 && !connected) { live[i] = 2; pair[i] = -1 }
    }
    for (i in 0 until n) {
      if (live[i] != 2 || age[i] < 0.3 || (if (kind[i] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5) continue
      for (j in i + 1 until n) {
        if (live[j] != 2 || age[j] < 0.3 || (if (kind[j] == 1) read(layout.hailEnabled) else read(layout.enabled)) < 0.5) continue
        val mi = ice[i] + water[i]; val mj = ice[j] + water[j]
        val wi = water[i] / mi; val wj = water[j] / mj
        val ri = if (wi > 0.8) 0.34 * root(water[i]) else radius[i] * (0.55 + 0.4 * compact[i])
        val rj = if (wj > 0.8) 0.34 * root(water[j]) else radius[j] * (0.55 + 0.4 * compact[j])
        val dx = x[j] - x[i]; val dy = y[j] - y[i]
        val zi = sqrt(max(0.02, 1 - x[i] * x[i] - y[i] * y[i])); val zj = sqrt(max(0.02, 1 - x[j] * x[j] - y[j] * y[j]))
        if (dx * dx + dy * dy + (zi - zj) * (zi - zj) > (ri + rj) * (ri + rj)) continue
        val flow = dx * gx + dy * gy
        val head = if (abs(flow) > 0.000001) { if (flow > 0) j else i } else { if (mi >= mj) i else j }
        val donor = if (head == i) j else i
        if (radius[head] > 0.14) continue
        live[donor] = 3; pair[donor] = head
        transfer[donor] = (ice[donor] + water[donor]) / (if (wi > 0.8 && wj > 0.8) 0.7 else 5.5)
        vx[head] = vx[head] * 0.3 + vx[donor] * 0.15; vy[head] *= 0.3
        break
      }
    }
    rain?.releaseSnowTrails(this, time)
    done++
  }
  fun runTo(time: Double, layout: OrbProgram.Snow, dials: FloatArray, most: Int, level: Double, rain: OrbRain? = null) {
    val target = floor(time * 60 + 1e-3).toInt()
    val hailOn = dials[layout.hailEnabled] >= 0.5f
    if (dials[layout.enabled] < 0.5f && (!hailOn || (dials[layout.hailAmount] <= 0f && !(0 until n).any { live[it] > 0 && kind[it] == 1 }))) { done = target; frac = 1.0; paused = true; return }
    if (paused) { x.copyInto(px); y.copyInto(py); radius.copyInto(pradius); phase.copyInto(pphase); paused = false }
    if (dials[layout.amount].toDouble() + dials[layout.react].toDouble() * level <= 0 && (!hailOn || dials[layout.hailAmount] <= 0f) && live.all { it == 0 }) {
      done = target; frac = min(1.0, max(0.0, time * 60 + 1e-3 - target)); return
    }
    if (target - done > most) done = target - most
    while (done < target) tick(layout, dials, level, rain)
    frac = min(1.0, max(0.0, time * 60 + 1e-3 - target))
  }
  fun isAttached(i: Int): Boolean = live[i] == 2
  fun trailPosition(i: Int, interpolated: Boolean = true): Pair<Double, Double> {
    val t = if (interpolated) frac else 1.0
    return Pair(px[i] + (x[i] - px[i]) * t, py[i] + (y[i] - py[i]) * t)
  }
  fun write(out: FloatArray, layout: OrbProgram.Snow) {
    for (i in 0 until n) {
      val at = (layout.pool + i) * 4; val t = frac
      val sx = px[i] + (x[i] - px[i]) * t; val sy = py[i] + (y[i] - py[i]) * t
      val qx = floor(min(1.0, max(0.0, (sx + 1.2) / 2.4)) * 4095 + 0.5)
      val qy = floor(min(1.0, max(0.0, (sy + 1.2) / 2.4)) * 4095 + 0.5)
      out[at] = (qx * 4096 + qy).toFloat()
      out[at + 1] = if (live[i] == 0) 0f else (pradius[i] + (radius[i] - pradius[i]) * t).toFloat()
      out[at + 2] = (if (kind[i] == 1) -id[i] else id[i]).toFloat()
      val p = pphase[i] + (phase[i] - pphase[i]) * t
      val frozen = floor(min(1.0, max(0.0, p)) * 1023 + 0.5)
      val packing = floor(compact[i] * 255 + 0.5)
      val drive = floor(min(1.0, max(0.0, -p)) * 63 + 0.5)
      out[at + 3] = (if (live[i] == 1 || live[i] == 4) p else -(1 + frozen + packing * 1024 + drive * 262144)).toFloat()
    }
  }
}
