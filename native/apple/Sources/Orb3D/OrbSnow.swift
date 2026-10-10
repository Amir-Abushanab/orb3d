import Foundation

/// Persistent surface snow. Operation-for-operation port of program/snow.ts.
final class OrbSnow {
    private let n = 64
    private let step = 1.0 / 60
    private var done = 0
    private var frac = 0.0
    private var paused = false
    var hasParticles: Bool { live.contains(where: { $0 > 0 }) }
    private var seed: UInt32 = 0x73a92c41
    private var serial = 0
    private var arrivals = 0.0
    private var hailArrivals = 0.0
    private var kind = [Int](repeating: 0, count: 64)
    private var supplied = 0.0
    private var escaped = 0.0
    private var evaporated = 0.0
    private var film = 0.0
    private var live = [Int](repeating: 0, count: 64)
    private var id = [Int](repeating: 0, count: 64)
    private var pair = [Int](repeating: -1, count: 64)
    private var x = [Double](repeating: 0, count: 64)
    private var y = [Double](repeating: 0, count: 64)
    private var px = [Double](repeating: 0, count: 64)
    private var py = [Double](repeating: 0, count: 64)
    private var radius = [Double](repeating: 0, count: 64)
    private var pradius = [Double](repeating: 0, count: 64)
    private var ice = [Double](repeating: 0, count: 64)
    private var water = [Double](repeating: 0, count: 64)
    private var phase = [Double](repeating: 0, count: 64)
    private var pphase = [Double](repeating: 0, count: 64)
    private var age = [Double](repeating: 0, count: 64)
    private var flight = [Double](repeating: 0, count: 64)
    private var targetX = [Double](repeating: 0, count: 64)
    private var targetY = [Double](repeating: 0, count: 64)
    private var incomingX = [Double](repeating: 0, count: 64)
    private var incomingY = [Double](repeating: 0, count: 64)
    private var vx = [Double](repeating: 0, count: 64)
    private var vy = [Double](repeating: 0, count: 64)
    private var compact = [Double](repeating: 0, count: 64)
    private var transfer = [Double](repeating: 0, count: 64)

    private func random() -> Double {
        seed = seed &* 1664525 &+ 1013904223
        return Double(seed) / 4294967296
    }
    private func root(_ value: Double) -> Double {
        if value <= 0 { return 0 }
        var r = 0.2
        for _ in 0..<16 { r = (2 * r + value / (r * r)) / 3 }
        return r
    }
    private func spawn(_ i: Int, _ spread: Double, _ angle: Double, _ size: Double, _ material: Int = 0) {
        let ax = sin(angle), ay = -cos(angle)
        var atx = 0.0, aty = 0.0
        for _ in 0..<12 {
            let side = random() * 1.9 - 0.95
            let scattered = random() * 1.9 - 0.95
            let edge = 0.77 + 0.16 * random()
            let along = edge * (1 - spread) + scattered * spread
            let across = side * sqrt(max(0, 1 - along * along * (1 - spread)))
            atx = -across * ay - along * ax
            aty = across * ax - along * ay
            if atx * atx + aty * aty < 0.91 { break }
        }
        let r = size * (material == 1 ? 0.014 + 0.022 * random() : 0.024 + 0.032 * random())
        kind[i] = material
        serial = (serial + 1) % 16777216
        id[i] = serial; live[i] = 1
        targetX[i] = atx; targetY[i] = aty; incomingX[i] = ax; incomingY[i] = ay
        flight[i] = 0.18 + 0.42 * random()
        x[i] = atx - ax * flight[i]; y[i] = aty - ay * flight[i]
        px[i] = x[i]; py[i] = y[i]; radius[i] = r; pradius[i] = r
        ice[i] = r * r * r; water[i] = 0
        phase[i] = 1 + flight[i]; pphase[i] = phase[i]
        age[i] = 0; vx[i] = 0; vy[i] = 0; pair[i] = -1; compact[i] = 0
        supplied += ice[i]
    }
    private func retireMelt(_ i: Int, _ rain: OrbRain?, _ time: Double) -> Bool {
        if live[i] != 2 || ice[i] > 0 { return false }
        let r = root(water[i])*0.34
        if r > 0 {
            rain?.traceTrail(384+i,kind[i] == 1 ? -3 : -2,x[i],y[i],x[i],y[i],r,time)
            rain?.releaseTrail(384+i,x[i],y[i],time)
        }
        film += water[i]; water[i] = 0; live[i] = 0; radius[i] = 0
        return true
    }
    private func tick(_ layout: OrbProgram.Snow, _ dials: [Float], _ level: Double, _ rain: OrbRain?) {
        func read(_ at: Int) -> Double { Double(dials[at]) }
        let amount = read(layout.enabled) < 0.5 ? 0 : min(1, max(0, read(layout.amount) + read(layout.react) * level))
        let hail = read(layout.hailEnabled) < 0.5 ? 0 : read(layout.hailAmount)
        let now = Double(done+1)/60
        let strength = read(layout.windSpeed) + max(0,read(layout.gusts)-read(layout.windSpeed)) * (0.5+0.28*sin(now*0.73)+0.22*sin(now*1.37+1.9)) * read(layout.turbulence)
        let fall = max(0, read(layout.fall)), stick = min(1, max(0, read(layout.stick)))
        let melt = max(0, read(layout.melt)), angle = min(80, max(-80, read(layout.angle) + read(layout.wind) + strength * 0.45 * sin(now*0.81))) * Double.pi / 180
        let gravity = read(layout.gravity) * Double.pi / 180
        let gx = sin(gravity), gy = -cos(gravity)
        let time = (Double(done + 1) / 60 * 1000).rounded() / 1000
        for i in 0..<n { px[i] = x[i]; py[i] = y[i]; pradius[i] = radius[i]; pphase[i] = phase[i] }
        arrivals += amount * read(layout.density) * (2 + 25 * read(layout.density)) * fall * step
        for i in 0..<n {
            if arrivals < 1 { break }
            if live[i] != 0 && ((kind[i] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 || !retireMelt(i,rain,time)) { continue }
            spawn(i, read(layout.dispersion), angle, read(layout.size)); arrivals -= 1
        }
        arrivals = min(arrivals, 1)
        let density = read(layout.hailDensity)
        hailArrivals += hail * density * (2+18*density) * step
        for i in 0..<n {
            if hailArrivals < 1 { break }; if live[i] != 0 && ((kind[i] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 || !retireMelt(i,rain,time)) { continue }
            spawn(i,0.8,angle,read(layout.hailSize),1); hailArrivals -= 1
        }
        hailArrivals = min(hailArrivals,1)
        for i in 0..<n {
            if live[i] == 0 { continue }
            if (kind[i] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 { continue }
            if live[i] == 4 {
                age[i] += step
                let h = max(0,read(layout.hailBounce)*age[i]*0.9-age[i]*age[i]*1.6)
                x[i] = targetX[i]-incomingX[i]*h; y[i] = targetY[i]-incomingY[i]*h; phase[i] = 1+h
                if h <= 0 { live[i] = 2; phase[i] = 1; age[i] = 0 }
                continue
            }
            if live[i] == 1 {
                let h = max(0, flight[i] - (0.18 + 0.08 * Double(id[i] % 7) / 7) * (kind[i] == 1 ? 4 : fall * (1+strength*0.015)) * step)
                flight[i] = h
                let flutter = (kind[i] == 1 ? 0 : 0.018) * h * sin(h * 9 + Double(id[i]) * 0.7)
                x[i] = targetX[i] - incomingX[i] * h - incomingY[i] * flutter
                y[i] = targetY[i] - incomingY[i] * h + incomingX[i] * flutter
                phase[i] = 1 + h
                if h <= 0 {
                    live[i] = kind[i] == 1 && read(layout.hailBounce) > 0 ? 4 : 2; vx[i] = incomingX[i] * 0.0025 * fall; vy[i] = incomingY[i] * 0.0025 * fall
                }
                continue
            }
            age[i] += step
            let total = ice[i] + water[i]
            if total <= 1e-12 { live[i] = 0; radius[i] = 0; continue }
            let r = root(total), heat = 0.75 + 0.5 * Double((id[i] * 37) % 101) / 100
            let thaw = min(ice[i], 0.009 * (kind[i] == 1 ? read(layout.hailMelt) : melt) * heat * r * r * step)
            ice[i] -= thaw; water[i] += thaw
            let frozen = ice[i] / total, wetRadius = 0.34 * root(water[i])
            let mobility = (1 - (kind[i] == 1 ? 0.65 : stick)) * 0.15 * frozen + (1 - frozen) * (1 - frozen) * max(0, wetRadius - 0.008) * 20
            let projection = x[i] * gx + y[i] * gy
            vx[i] = vx[i] * (0.84 + 0.08 * (1 - frozen)) + 0.00065 * mobility * (gx - projection * x[i])
            vy[i] = vy[i] * (0.84 + 0.08 * (1 - frozen)) + 0.00065 * mobility * (gy - projection * y[i])
            if live[i] == 2 {
                x[i] += vx[i]; y[i] += vy[i]
                let distance = hypot(x[i] - px[i], y[i] - py[i])
                if distance > 0.0001 && wetRadius > 0.006 && frozen < 0.8 {
                    rain?.traceTrail(384 + i, kind[i] == 1 ? -3 : -2, x[i], y[i], px[i], py[i], wetRadius, time)
                    let z = sqrt(max(0.02, 1 - x[i] * x[i] - y[i] * y[i]))
                    let patch = x[i] * 17 + y[i] * 11 + z * 5 + Double(id[i]) * 0.01
                    let triangle = 2 * abs(patch - floor(patch) - 0.5)
                    let loss = water[i] * min(0.02, distance * (0.1 + 0.55 * triangle * triangle))
                    water[i] -= loss; film += loss
                }
            }
            radius[i] = root(ice[i] + water[i])
            phase[i] = frozen > 0 ? frozen : -min(1, sqrt(vx[i] * vx[i] + vy[i] * vy[i]) * 250 + 0.00001)
            if age[i] > 20 && frozen == 0 {
                let evaporate = min(water[i], 0.00006 * r * r * step)
                water[i] -= evaporate; evaporated += evaporate
            }
            if x[i] * x[i] + y[i] * y[i] > 1.06 * 1.06 {
                escaped += ice[i] + water[i]; ice[i] = 0; water[i] = 0; live[i] = 0; radius[i] = 0
            }
        }
        for i in 0..<n {
            if live[i] != 3 || (kind[i] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 { continue }
            let j = pair[i]
            if j >= 0 && (kind[j] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 { continue }
            if j < 0 || live[j] != 2 { live[i] = 2; pair[i] = -1; continue }
            let total = ice[i] + water[i], moved = min(total, transfer[i] * step)
            let dx = x[j] - x[i], dy = y[j] - y[i]
            let zi = sqrt(max(0.02, 1 - x[i] * x[i] - y[i] * y[i]))
            let zj = sqrt(max(0.02, 1 - x[j] * x[j] - y[j] * y[j]))
            let reach = 0.34 * (root(water[i]) + root(water[j]))
            let connected = dx * dx + dy * dy + (zi - zj) * (zi - zj) <= reach * reach
            let liquid = connected ? min(water[i], moved * water[i] / max(total, 1e-20)) : 0
            let frozen = min(ice[i], moved - liquid)
            ice[i] -= frozen; water[i] -= liquid; ice[j] += frozen; water[j] += liquid
            compact[j] = min(1, compact[j] + (frozen + liquid) / max(ice[j] + water[j], 1e-20) * 0.33)
            vx[j] *= 0.85; vy[j] *= 0.85
            radius[i] = root(ice[i] + water[i]); radius[j] = root(ice[j] + water[j])
            if ice[i] + water[i] <= 1e-15 { live[i] = 0; radius[i] = 0; pair[i] = -1 }
            else if ice[i] == 0 && !connected { live[i] = 2; pair[i] = -1 }
        }
        for i in 0..<n {
            if live[i] != 2 || age[i] < 0.3 || (kind[i] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 { continue }
            for j in (i + 1)..<n {
                if live[j] != 2 || age[j] < 0.3 || (kind[j] == 1 ? read(layout.hailEnabled) : read(layout.enabled)) < 0.5 { continue }
                let mi = ice[i] + water[i], mj = ice[j] + water[j]
                let wi = water[i] / mi, wj = water[j] / mj
                let ri = wi > 0.8 ? 0.34 * root(water[i]) : radius[i] * (0.55 + 0.4 * compact[i])
                let rj = wj > 0.8 ? 0.34 * root(water[j]) : radius[j] * (0.55 + 0.4 * compact[j])
                let dx = x[j] - x[i], dy = y[j] - y[i]
                let zi = sqrt(max(0.02, 1 - x[i] * x[i] - y[i] * y[i]))
                let zj = sqrt(max(0.02, 1 - x[j] * x[j] - y[j] * y[j]))
                if dx * dx + dy * dy + (zi - zj) * (zi - zj) > (ri + rj) * (ri + rj) { continue }
                let flow = dx * gx + dy * gy
                let head = abs(flow) > 0.000001 ? (flow > 0 ? j : i) : (mi >= mj ? i : j)
                let donor = head == i ? j : i
                if radius[head] > 0.14 { continue }
                live[donor] = 3; pair[donor] = head
                transfer[donor] = (ice[donor] + water[donor]) / (wi > 0.8 && wj > 0.8 ? 0.7 : 5.5)
                vx[head] = vx[head] * 0.3 + vx[donor] * 0.15; vy[head] *= 0.3
                break
            }
        }
        rain?.releaseSnowTrails(self, time)
        done += 1
    }
    func run(to time: Double, layout: OrbProgram.Snow, dials: [Float], most: Int, level: Double, rain: OrbRain? = nil) {
        let target = Int(floor(time * 60 + 1e-3))
        let hailOn = dials[layout.hailEnabled] >= 0.5
        if dials[layout.enabled] < 0.5 && (!hailOn || (dials[layout.hailAmount] <= 0 && !(0..<n).contains(where: { live[$0] > 0 && kind[$0] == 1 }))) { done = target; frac = 1; paused = true; return }
        if paused { px = x; py = y; pradius = radius; pphase = phase; paused = false }
        if Double(dials[layout.amount]) + Double(dials[layout.react]) * level <= 0 && (!hailOn || dials[layout.hailAmount] <= 0) && live.allSatisfy({ $0 == 0 }) {
            done = target; frac = min(1, max(0, time * 60 + 1e-3 - Double(target))); return
        }
        if target - done > most { done = target - most }
        while done < target { tick(layout, dials, level, rain) }
        frac = min(1, max(0, time * 60 + 1e-3 - Double(target)))
    }
    func isAttached(_ i: Int) -> Bool { live[i] == 2 }
    func trailPosition(_ i: Int, interpolated: Bool = true) -> (Double, Double) {
        let t = interpolated ? frac : 1
        return (px[i] + (x[i] - px[i]) * t, py[i] + (y[i] - py[i]) * t)
    }
    func write(into out: inout [Float], layout: OrbProgram.Snow) {
        for i in 0..<n {
            let at = (layout.pool + i) * 4, t = frac
            let sx = px[i] + (x[i] - px[i]) * t, sy = py[i] + (y[i] - py[i]) * t
            let qx = (min(1, max(0, (sx + 1.2) / 2.4)) * 4095).rounded()
            let qy = (min(1, max(0, (sy + 1.2) / 2.4)) * 4095).rounded()
            out[at] = Float(qx * 4096 + qy)
            out[at + 1] = live[i] == 0 ? 0 : Float(pradius[i] + (radius[i] - pradius[i]) * t)
            out[at + 2] = Float(kind[i] == 1 ? -id[i] : id[i])
            let p = pphase[i] + (phase[i] - pphase[i]) * t
            let frozen = (min(1, max(0, p)) * 1023).rounded()
            let packing = (compact[i] * 255).rounded()
            let drive = (min(1, max(0, -p)) * 63).rounded()
            out[at + 3] = Float((live[i] == 1 || live[i] == 4) ? p : -(1 + frozen + packing * 1024 + drive * 262144))
        }
    }
}
