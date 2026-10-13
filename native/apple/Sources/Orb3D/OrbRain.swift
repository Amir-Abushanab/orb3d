import Foundation

/// Fixed-step spherical water. Operation-for-operation port of program/rain.ts.
final class OrbRain {
    private let drops = 384
    private let trails = 48
    private let points = 12
    private let gravity = 0.0009
    private let pin = 0.0015
    private let top = 0.014
    private var program: OrbProgram
    private(set) var done = 0
    private var frac = 0.0
    private var paused = false
    private var pausedAt = 0.0
    private(set) var dynamic = false
    private var time = 0.0
    private var tau = 0.0
    private var film = 0.0
    private var contactHead = [Int](repeating: -1, count: 256)
    private var contactNext = [Int](repeating: -1, count: 384)
    private var contactMask = [UInt32](repeating: 0, count: 12)
    private var seed: UInt32 = 0x2f6b9d35
    private var live = [Int](repeating: 0, count: 384)
    private var x = [Double](repeating: 0, count: 384)
    private var y = [Double](repeating: 0, count: 384)
    private var z = [Double](repeating: 0, count: 384)
    private var r = [Double](repeating: 0, count: 384)
    private var stretch = [Double](repeating: 0, count: 384)
    private var pstretch = [Double](repeating: 0, count: 384)
    private var heading = [Double](repeating: -Double.pi / 2, count: 384)
    private var pheading = [Double](repeating: -Double.pi / 2, count: 384)
    private var px = [Double](repeating: 0, count: 384)
    private var py = [Double](repeating: 0, count: 384)
    private var pr = [Double](repeating: 0, count: 384)
    private var goal = [Double](repeating: 0, count: 384)
    private var vx = [Double](repeating: 0, count: 384)
    private var vy = [Double](repeating: 0, count: 384)
    private var vz = [Double](repeating: 0, count: 384)
    private var stick = [Double](repeating: 0, count: 384)
    private var shed = [Double](repeating: 0, count: 384)
    private var last = [Double](repeating: 0, count: 384)
    private var age = [Double](repeating: 0, count: 384)
    private var travel = [Double](repeating: 0, count: 384)
    private var own = [Int](repeating: -1, count: 384)
    private var untouched = [Int](repeating: 0, count: 384)
    private var owner = [Int](repeating: -1, count: 48)
    private var source = [Int](repeating: -1, count: 48)
    private var path = [Double](repeating: 0, count: 1152)
    private var count = [Int](repeating: 0, count: 48)
    private var width = [Double](repeating: 0, count: 48)
    private var stamp = [Double](repeating: 0, count: 576)
    private var hold = [Int](repeating: 0, count: 384)

    private var pair = [Int](repeating: -1, count: 384)
    private var started = [Double](repeating: 0, count: 384)
    private var phase = [Double](repeating: 0, count: 384)
    private var pphase = [Double](repeating: 0, count: 384)
    private var mass = [Double](repeating: 0, count: 384)
    private var radius0 = [Double](repeating: 0, count: 384)
    private var render0 = [Double](repeating: 0, count: 384)
    private var joinx = [Double](repeating: 0, count: 384)
    private var joiny = [Double](repeating: 0, count: 384)
    private var joinz = [Double](repeating: 0, count: 384)

    private func ease(_ lo: Double, _ hi: Double, _ value: Double) -> Double {
        let t = min(1, max(0, (value - lo) / (hi - lo)))
        return t * t * (3 - 2 * t)
    }
    init(program: OrbProgram) {
        self.program = program
        let n = Int(program.static[(program.rain.counts - program.staticSlot) * 4])
        for i in 0..<n {
            let at = (program.rain.drops - program.staticSlot + i) * 4
            place(i, Double(program.static[at]), Double(program.static[at + 1]),
                  Double(program.static[at + 2]), i)
        }
    }
    func rebind(_ next: OrbProgram) { program = next }
    private func rand() -> Double {
        let t = seed &+ 0x6d2b79f5
        seed = t
        var v = (t ^ (t >> 15)) &* (t | 1)
        v ^= v &+ ((v ^ (v >> 7)) &* (v | 61))
        return Double(v ^ (v >> 14)) / 4294967296
    }
    private func root(_ v: Double) -> Double {
        if v <= 0 { return 0 }
        var r = 0.2
        for _ in 0..<12 { r = (2 * r + v / (r * r)) / 3 }
        return r
    }
    private func place(_ i: Int, _ atx: Double, _ aty: Double, _ radius: Double, _ authored: Int) {
        pair[i] = -1; phase[i] = 0; pphase[i] = 0
        live[i] = 1
        x[i] = atx; y[i] = aty
        z[i] = sqrt(max(0.0001, 1 - atx * atx - aty * aty))
        stretch[i] = 0; pstretch[i] = 0; heading[i] = -Double.pi / 2; pheading[i] = -Double.pi / 2
        r[i] = radius; px[i] = atx; py[i] = aty; pr[i] = radius; goal[i] = radius
        vx[i] = 0; vy[i] = 0; vz[i] = 0
        stick[i] = 0.55 + rand() * 0.9
        last[i] = 0; shed[i] = 0.12 + 0.32 * rand(); age[i] = 0; hold[i] = 0; own[i] = authored; untouched[i] = authored >= 0 ? 1 : 0
    }
    private func arrive(_ i: Int, _ radius: Double, _ authored: Int, _ spawn: Double, _ gx: Double, _ gy: Double, _ impact: Double) -> Bool {
        let side = rand() * 1.9 - 0.95
        let scattered = rand() * 1.9 - 0.95
        let edge = 0.82 + 0.12 * rand()
        let along = scattered + (edge - scattered) * spawn
        let across = side * sqrt(max(0, 1 - along * along * spawn))
        let sx = -across * gy - along * gx; let sy = across * gx - along * gy
        if i < 0 || sx * sx + sy * sy >= 0.95 { return false }
        place(i, sx, sy, 0, authored); goal[i] = radius; untouched[i] = 0
        if impact > 0 {
            let radial = sx * gx + sy * gy
            vx[i] = impact * (gx - radial * sx); vy[i] = impact * (gy - radial * sy)
            vz[i] = -impact * radial * z[i]
        }
        return true
    }
    private func active(_ i: Int, _ amount: Double, _ n: Int) -> Bool {
        live[i] == 1 && (own[i] < 0 || amount * Double(n) > Double(own[i]))
    }
    private func free() -> Int {
        for i in 16..<drops { if live[i] == 0 { return i } }
        return -1
    }
    // Freeze full chunks rather than shifting a still-clear tail out of the history.
    private func release(_ i: Int) {
        releaseTrail(i, x[i], y[i], time)
    }
    func releaseTrail(_ i: Int, _ sx: Double, _ sy: Double, _ now: Double) {
        for k in 0..<trails {
            if owner[k] != i { continue }
            let at = k * points * 2; let age = k * points
            for j in stride(from: points - 1, to: 0, by: -1) {
                path[at + j * 2] = path[at + (j - 1) * 2]
                path[at + j * 2 + 1] = path[at + (j - 1) * 2 + 1]
                stamp[age + j] = stamp[age + j - 1]
            }
            path[at] = sx; path[at + 1] = sy; stamp[age] = now
            count[k] = min(points, count[k] + 1); owner[k] = -1
        }
    }
    private func trail(_ i: Int) {
        traceTrail(i, own[i], x[i], y[i], px[i], py[i], r[i], time)
    }
    func traceTrail(_ i: Int, _ origin: Int, _ sx: Double, _ sy: Double,
                    _ prevX: Double, _ prevY: Double, _ radius: Double, _ now: Double) {
        var slot = -1
        for k in 0..<trails { if owner[k] == i { slot = k } }
        if slot >= 0 {
            let at = slot * points * 2
            let dx = sx - path[at]; let dy = sy - path[at + 1]
            if dx * dx + dy * dy < 0.002025 { return }
            if count[slot] >= points - 1 { releaseTrail(i, sx, sy, now); slot = -1 }
        }
        if slot < 0 {
            for k in 0..<trails {
                if count[k] == 0 || (owner[k] < 0 && now - stamp[k * points] >= 8) { slot = k; break }
            }
            if slot < 0 { return }
            owner[slot] = i; source[slot] = origin; count[slot] = 1
            path[slot * points * 2] = prevX; path[slot * points * 2 + 1] = prevY
            stamp[slot * points] = max(0, now - 1 / 60); width[slot] = radius
            return
        }
        let at = slot * points * 2; let age = slot * points
        for k in stride(from: points - 1, to: 0, by: -1) {
            path[at + k * 2] = path[at + (k - 1) * 2]
            path[at + k * 2 + 1] = path[at + (k - 1) * 2 + 1]
            stamp[age + k] = stamp[age + k - 1]
        }
        path[at] = sx; path[at + 1] = sy; stamp[age] = now
        count[slot] = min(points - 1, count[slot] + 1); width[slot] = max(width[slot], radius)
    }
    func releaseSnowTrails(_ snow: OrbSnow, _ now: Double) {
        for drop in owner where drop >= drops {
            let i = drop - drops
            if !snow.isAttached(i) {
                let at = snow.trailPosition(i, interpolated: false)
                releaseTrail(drop, at.0, at.1, now)
            }
        }
    }
    private func extent(_ i: Int, _ dx: Double, _ dy: Double, _ dz: Double, _ distance: Double) -> Double {
        let hx = cos(heading[i]); let hy = sin(heading[i])
        let hz = -(x[i] * hx + y[i] * hy) / max(z[i], 0.00001)
        let norm = sqrt(hx * hx + hy * hy + hz * hz)
        let along = (dx * hx + dy * hy + dz * hz) / (distance * norm)
        let drive = stretch[i]; let length = 1 + 0.32 * drive; let across2 = max(0, 1 - along * along)
        var reach = r[i] / sqrt(across2 * length + along * along / (length * length))
        for _ in 0..<3 {
            let offset = 0.06 * drive * r[i]
            let q = (reach * along + offset) / max(r[i] * length, 0.000001)
            let taper = 1 + 0.14 * drive * min(1, max(-1, q))
            let aa = across2 * length / (taper * taper) + along * along / (length * length)
            let bb = 2 * along * offset / (length * length)
            let cc = offset * offset / (length * length) - r[i] * r[i]
            reach = (-bb + sqrt(bb * bb - 4 * aa * cc)) / (2 * aa)
        }
        return reach
    }
    private func touches(_ i: Int, _ j: Int) -> Bool {
        let dx = x[j] - x[i]; let dy = y[j] - y[i]; let dz = z[j] - z[i]
        let d2 = dx * dx + dy * dy + dz * dz; let broad = 2.25 * (r[i] + r[j])
        if d2 >= broad * broad { return false }
        let distance = sqrt(max(d2, 0.000000000001))
        let reach = extent(i, dx, dy, dz, distance) + extent(j, -dx, -dy, -dz, distance)
        return distance < reach
    }
    private func contactCell(_ value: Double) -> Int {
        max(0, min(15, Int(floor((value + 1) * 8))))
    }
    private func driver(_ i: Int, _ j: Int, _ gx: Double, _ gy: Double) -> Int {
        let a = vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i]
        let b = vx[j] * vx[j] + vy[j] * vy[j] + vz[j] * vz[j]
        if max(a, b) < 0.00000001 { return x[i] * gx + y[i] * gy >= x[j] * gx + y[j] * gy ? i : j }
        return a >= b ? i : j
    }
    private func merge(_ i: Int, _ j: Int) {
        let a = goal[i] * goal[i] * goal[i]; let b = goal[j] * goal[j] * goal[j]
        let w = b / (a + b)
        let area = goal[j] * goal[j] / (goal[i] * goal[i] + goal[j] * goal[j])
        joinx[i] = x[j] - x[i]; joiny[i] = y[j] - y[i]; joinz[i] = z[j] - z[i]
        mass[i] = a + b; mass[j] = b; radius0[i] = goal[i]; radius0[j] = goal[j]
        render0[i] = r[i]; render0[j] = r[j]
        pair[i] = j; pair[j] = i; started[i] = time; phase[i] = 0; pphase[i] = 0
        let speed = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
        if speed > 0.00000001 {
            let along = (joinx[i] * vx[i] + joiny[i] * vy[i] + joinz[i] * vz[i]) / (speed * speed)
            let radial = joinx[i] * x[i] + joiny[i] * y[i] + joinz[i] * z[i]
            let sx = joinx[i] - vx[i] * along - x[i] * radial
            let sy = joiny[i] - vy[i] * along - y[i] * radial
            let sz = joinz[i] - vz[i] * along - z[i] * radial
            let side = sqrt(sx * sx + sy * sy + sz * sz)
            let impulse = min(0.00075, speed * 0.18) / max(side, 0.000001)
            vx[i] = vx[i] + sx * impulse; vy[i] = vy[i] + sy * impulse; vz[i] = vz[i] + sz * impulse
        }
        let drag = 0.76 - 0.2 * area
        vx[i] = (vx[i] * (1 - 0.3 * w) + vx[j] * 0.3 * w) * drag
        vy[i] = (vy[i] * (1 - 0.3 * w) + vy[j] * 0.3 * w) * drag
        vz[i] = (vz[i] * (1 - 0.3 * w) + vz[j] * 0.3 * w) * drag
        hold[i] = max(hold[i], 3 + Int((area * 3).rounded()))
        untouched[i] = 0; untouched[j] = 0
        live[j] = 2; travel[j] = 1; release(j)
    }
    // Contact-line coalescence follows the moving head; no attraction of either centre.
    private func coalesce(_ i: Int) {
        let j = pair[i]
        let p = min(1, max(0, (time - started[i]) / 0.20))
        let donor = radius0[j] * (1 - ease(0.14, 1, p))
        goal[j] = donor; goal[i] = root(mass[i] - donor * donor * donor)
        let grown = ease(0, 0.30, p)
        r[i] = render0[i] + (goal[i] - render0[i]) * grown
        r[j] = render0[j] + (donor - render0[j]) * grown; phase[i] = p
        if p >= 1 { live[j] = 0; age[j] = 0; pair[i] = -1; pair[j] = -1 }
    }
    private func step(_ dials: [Float], at: Double, motion: Double) {
        time = (at * 1000).rounded() / 1000
        let amount = Double(dials[program.rain.amount]); let density = Double(dials[program.rain.density])
        let spawn = Double(dials[program.rain.spawn])
        let angle = Double(dials[program.rain.direction]) * Double.pi / 180
        let gx = sin(angle); let gy = -cos(angle)
        let strength = Double(dials[program.rain.windSpeed]) + max(0,Double(dials[program.rain.gusts]-dials[program.rain.windSpeed])) * (0.5+0.28*sin(time*0.73)+0.22*sin(time*1.37+1.9)) * Double(dials[program.rain.turbulence])
        let gustAngle = strength * 0.45 * sin(time*0.81)
        let incoming = program.rain.angle.map { min(80, max(-80, Double(dials[$0]) + gustAngle + Double(dials[program.rain.wind]))) * Double.pi / 180 } ?? angle
        let ax = sin(incoming); let ay = -cos(incoming)
        let impact = program.rain.angle == nil ? 0 : 0.009 * abs(ax) * (1+strength*0.08)
        let n = Int(program.static[(program.rain.counts - program.staticSlot) * 4])
        dynamic = false
        var population = 0
        for i in 0..<drops {
            px[i] = x[i]; py[i] = y[i]; pr[i] = r[i]; pphase[i] = phase[i]; pstretch[i] = stretch[i]; pheading[i] = heading[i]
            if live[i] > 0 && own[i] < 0 { dynamic = true }
            if live[i] == 1 && own[i] < 0 { population += 1 }
        }
        let target = 24 * density + 330 * density * density
        if density > 0 && Double(population) < target {
            for k in 0..<9 {
                if k >= 1 + Int(floor(8 * density * density)) || rand() > density * 0.9 { break }
                let i = free()
                let radius = (0.009 + rand() * rand() * 0.04) * Double(dials[program.rain.size])
                if arrive(i, radius, -1, spawn, ax, ay, impact) { population += 1; dynamic = true }
                if Double(population) >= target { break }
            }
        }
        for i in 0..<drops {
            if live[i] == 0 && own[i] >= 0 && amount * Double(n) > Double(own[i]) {
                age[i] = age[i] + 1
                if age[i] > 120 {
                    let at = (program.rain.drops - program.staticSlot + own[i]) * 4
                    _ = arrive(i, Double(program.static[at + 2]), own[i], spawn, ax, ay, impact)
                }
            }
            if live[i] == 2 { continue }
            if live[i] == 3 {
                vx[i] = vx[i] + gravity * gx * motion; vy[i] = vy[i] + gravity * gy * motion
                x[i] = x[i] + vx[i]; y[i] = y[i] + vy[i]
                if x[i] * gx + y[i] * gy > 1.2 + r[i] { live[i] = 0 }
                continue
            }
            if !active(i, amount, n) { continue }
            r[i] = r[i] + (goal[i] - r[i]) * 0.25
            var sx = x[i]; var sy = y[i]; var sz = z[i]
            let norm = sqrt(sx * sx + sy * sy + sz * sz)
            sx /= norm; sy /= norm; sz /= norm
            let pole = sx * gx + sy * gy
            let slope = sqrt(max(0, 1 - pole * pole))
            let speed = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
            let force = goal[i] * goal[i] * slope
            let resistance = pin * stick[i] * (speed > 0.0002 ? 0.35 : 1)
            if hold[i] > 0 {
                hold[i] = max(0, hold[i] - 1)
                vx[i] = vx[i] * 0.86; vy[i] = vy[i] * 0.86; vz[i] = vz[i] * 0.86
            } else if force > resistance {
                let gain = gravity * motion * (1 - resistance / force)
                vx[i] = (vx[i] + gain * (gx - pole * sx)) * pow(0.92,motion)
                vy[i] = (vy[i] + gain * (gy - pole * sy)) * pow(0.92,motion)
                vz[i] = (vz[i] - gain * pole * sz) * pow(0.92,motion)
            } else { vx[i] = vx[i] * 0.65; vy[i] = vy[i] * 0.65; vz[i] = vz[i] * 0.65 }
            let radial = vx[i] * sx + vy[i] * sy + vz[i] * sz
            vx[i] = vx[i] - radial * sx; vy[i] = vy[i] - radial * sy; vz[i] = vz[i] - radial * sz
            // Glass adhesion dissipates wind/contact impulses that push attached water uphill.
            if vx[i] * gx + vy[i] * gy < 0 { vx[i] = 0; vy[i] = 0; vz[i] = 0 }
            let v = sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
            let limit = min(1, top / max(v, 0.000001))
            vx[i] = vx[i] * limit; vy[i] = vy[i] * limit; vz[i] = vz[i] * limit
            sx += vx[i] * motion; sy += vy[i] * motion; sz += vz[i] * motion
            let norm2 = sqrt(sx * sx + sy * sy + sz * sz)
            x[i] = sx / norm2; y[i] = sy / norm2; z[i] = sz / norm2
            let dx = x[i] - px[i]; let dy = y[i] - py[i]
            let wanted = min(1, v * motion / 0.004) * min(1, goal[i] / 0.035)
            stretch[i] = stretch[i] + (wanted - stretch[i]) * 0.08
            if v > 0.0001 {
                let turn = atan2(vy[i], vx[i]) - heading[i]
                heading[i] = heading[i] + atan2(sin(turn), cos(turn)) * 0.08
            }
            if dx * dx + dy * dy > 0.00000001 {
                untouched[i] = 0
                if r[i] > 0.025 { trail(i) }
                travel[i] = travel[i] + sqrt(dx * dx + dy * dy)
                last[i] = last[i] + v * motion
                let patch = x[i] * 17 + y[i] * 11 + z[i] * 5 + stick[i]
                let triangle = 2 * abs(patch - floor(patch) - 0.5)
                let held = goal[i] * goal[i] * goal[i]
                let loss = held * min(0.02, v * motion * (0.10 + 0.55 * triangle * triangle))
                film += loss; goal[i] = root(held - loss)
                if pair[i] >= 0 { mass[i] = mass[i] - loss }
                if pair[i] < 0 && last[i] > shed[i] {
                    last[i] = 0; shed[i] = 0.12 + 0.32 * rand(); stick[i] = 0.55 + rand() * 0.9
                    let j = free()
                    if j >= 0 && goal[i] > 0.04 && x[i] * gx + y[i] * gy < 0.9 && v > 0.0005 && rand() < 0.35 {
                        let bead = goal[i] * (0.08 + 0.2 * rand())
                        let rear = extent(i, -vx[i], -vy[i], -vz[i], v)
                        let gap = (rear + bead) * (1.15 + 0.35 * rand()) / v
                        let side = (rand() - 0.5) * r[i] * 0.65 / v
                        let bx = x[i] - vx[i] * gap + (y[i] * vz[i] - z[i] * vy[i]) * side
                        let by = y[i] - vy[i] * gap + (z[i] * vx[i] - x[i] * vz[i]) * side
                        let bz = z[i] - vz[i] * gap + (x[i] * vy[i] - y[i] * vx[i]) * side
                        let norm = sqrt(bx * bx + by * by + bz * bz)
                        place(j, bx / norm, by / norm, bead, -1)
                        goal[i] = root(goal[i] * goal[i] * goal[i] - bead * bead * bead)
                    }
                }
            }
        }
        for i in 0..<drops {
            if live[i] == 1 && pair[i] >= 0 { coalesce(i) }
            if !active(i, amount, n) { continue }
            if pair[i] >= 0 { continue }
            let overloaded = goal[i] > 0.14
            if overloaded || x[i] * gx + y[i] * gy > 0.96 {
                age[i] = age[i] + 1
                if overloaded || goal[i] > 0.075 || age[i] > 90 {
                    live[i] = 3
                    let along = vx[i] * gx + vy[i] * gy
                    vx[i] = vx[i] + gx * (0.006 - along); vy[i] = vy[i] + gy * (0.006 - along)
                    release(i)
                }
            } else if z[i] < 0.04 { live[i] = 0; release(i) }
        }
        for at in 0..<contactHead.count { contactHead[at] = -1 }
        var maxRadius = 0.0
        for i in 0..<drops {
            if pair[i] >= 0 || !active(i, amount, n) { continue }
            let at = contactCell(x[i]) + contactCell(y[i]) * 16
            contactNext[i] = contactHead[at]; contactHead[at] = i
            maxRadius = max(maxRadius, r[i])
        }
        for i in 0..<drops {
            if pair[i] >= 0 || !active(i, amount, n) { continue }
            for word in 0..<contactMask.count { contactMask[word] = 0 }
            let reach = 2.25 * (r[i] + maxRadius)
            let lowX = contactCell(x[i] - reach), highX = contactCell(x[i] + reach)
            let lowY = contactCell(y[i] - reach), highY = contactCell(y[i] + reach)
            for cy in lowY...highY {
                for cx in lowX...highX {
                    var j = contactHead[cx + cy * 16]
                    while j >= 0 {
                        if j > i { contactMask[j >> 5] |= UInt32(1) << (j & 31) }
                        j = contactNext[j]
                    }
                }
            }
            for word in (i >> 5)..<contactMask.count {
                if pair[i] >= 0 { break }
                var bits = contactMask[word]
                while bits != 0 && pair[i] < 0 {
                    let bit = bits & (0 &- bits)
                    let j = word * 32 + bit.trailingZeroBitCount
                    bits ^= bit
                    if pair[j] >= 0 || !touches(i, j) { continue }
                    let head = driver(i, j, gx, gy)
                    merge(head, head == i ? j : i)
                }
            }
        }
        done += 1
    }
    func run(to nextTau: Double, dials: [Float], most: Int, time nextTime: Double) {
        let target = Int(floor(nextTime * 60 + 1e-3))
        if dials[program.rain.enabled] < 0.5 || (dials[program.rain.amount] <= 0 && dials[program.rain.density] <= 0 && !dynamic) {
            if !paused { pausedAt = time }
            done = target; time = nextTime; tau = nextTau; frac = 1; paused = true; return
        }
        if paused {
            for i in 0..<drops where pair[i] >= 0 { started[i] += time - pausedAt }
            px = x; py = y; pr = r; pphase = phase; pstretch = stretch; pheading = heading; paused = false
        }
        if target - done > most { done = target - most }
        let elapsed = nextTime - time; let advanced = nextTau - tau
        let motion = elapsed > 0 ? max(0,advanced / elapsed) : 0
        while done < target { step(dials, at: Double(done + 1) / 60, motion: motion) }
        time = nextTime; tau = nextTau
        frac = min(1, max(0, nextTime * 60 + 1e-3 - Double(target)))
    }
    private func pack(_ x: Double, _ y: Double) -> Float {
        let qx = (min(1, max(0, (x + 1.2) / 2.4)) * 4095).rounded()
        let qy = (min(1, max(0, (y + 1.2) / 2.4)) * 4095).rounded()
        return Float(qx * 4096 + qy)
    }
    func wet(time now: Double, rainEnabled: Bool, snowEnabled: Bool, hailEnabled: Bool) -> (Bool, Bool) {
        var wetRain = false, wetSnow = false
        if rainEnabled || snowEnabled || hailEnabled {
            for i in 0..<trails {
                if count[i] <= 0 { continue }
                let isSnow = source[i] <= -2
                if source[i] == -3 ? !hailEnabled : isSnow ? !snowEnabled : !rainEnabled { continue }
                if owner[i] < 0 && now - stamp[i * points] >= 8 { continue }
                if isSnow { wetSnow = true } else { wetRain = true }
            }
        }
        return (wetRain, wetSnow)
    }
    func write(into out: inout [Float], snow: OrbSnow? = nil, drawDrops: Bool = true, drawTrails: Bool = true) {
        for i in 0..<(drawDrops ? drops : 0) {
            let at = (program.rain.pool + i * 2) * 4
            let sx = px[i] + (x[i] - px[i]) * frac; let sy = py[i] + (y[i] - py[i]) * frac
            let radius = pr[i] + (r[i] - pr[i]) * frac
            let drive = pstretch[i] + (stretch[i] - pstretch[i]) * frac
            let head = pheading[i] + (heading[i] - pheading[i]) * frac
            let angle = atan2(sin(head), cos(head))
            let shape = ((angle + Double.pi) / (2 * Double.pi) * 4095).rounded() + 4096 * (drive * 4095).rounded()
            out[at] = pack(sx, sy); out[at + 1] = live[i] > 0 ? Float(radius) : 0
            let j = pair[i]
            out[at + 2] = Float((shape + 1) * (live[i] == 2 ? -1 : 1))
            let p = pphase[i] + (phase[i] - pphase[i]) * frac
            out[at + 3] = j < 0 || live[i] != 1 ? 0 : Float(min(radius0[i], radius0[j]) * (0.08 + 0.62 * ease(0, 0.25, p)) * (1 - ease(0.60, 1, p)))
        }
        for i in 0..<(drawDrops ? drops : 0) {
            let at = (program.rain.pool + i * 2) * 4; let j = pair[i]
            let partner = j < 0 ? at : (program.rain.pool + j * 2) * 4
            out[at + 4] = out[partner]; out[at + 5] = j < 0 ? 0 : out[partner + 1]
            out[at + 6] = j < 0 ? -1 : Float(own[j]); out[at + 7] = j < 0 ? 0 : abs(out[partner + 2]) - 1
        }
        for i in 0..<(drawTrails ? trails : 0) {
            let at = (program.rain.trails + i * 8) * 4
            let n = count[i]; let drop = owner[i]
            if n <= 0 || (drop < 0 && time - stamp[i * points] >= 8) { out[at + 24] = 0; continue }
            var loX = 2.0; var loY = 2.0; var hiX = -2.0; var hiY = -2.0
            for k in 0..<points {
                let p = max(0, min(drop >= 0 ? k - 1 : k, n - 1))
                var sx = path[(i * points + p) * 2]; var sy = path[(i * points + p) * 2 + 1]
                var age = stamp[i * points + p]
                if k == 0 && drop >= 0 {
                    if drop < drops {
                        sx = px[drop] + (x[drop] - px[drop]) * frac
                        sy = py[drop] + (y[drop] - py[drop]) * frac
                    } else if let snow {
                        let at = snow.trailPosition(drop - drops)
                        sx = at.0; sy = at.1
                    }
                    age = time
                }
                out[at + k] = pack(sx, sy); out[at + points + k] = Float(age)
                loX = min(loX, sx); loY = min(loY, sy); hiX = max(hiX, sx); hiY = max(hiY, sy)
            }
            out[at + 24] = n > 0 ? Float(width[i]) : 0
            out[at + 25] = Float(source[i]); out[at + 26] = Float(min(points, n + (drop >= 0 ? 1 : 0)))
            out[at + 27] = 0
            out[at + 28] = Float(loX); out[at + 29] = Float(loY)
            out[at + 30] = Float(hiX); out[at + 31] = Float(hiY)
        }
    }
}
