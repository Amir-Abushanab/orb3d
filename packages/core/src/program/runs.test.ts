import CanvasKitInit from "canvaskit-wasm";
import { describe, expect, it } from "vitest";
import { ensureOrbConfig, type Drop } from "../config/model";
import { PRESETS } from "../presets";
import { compileOrb } from "./compile";
import { OrbRuntime } from "./runtime";
import { orbShader } from "./shader";

const SIZE = 64;

/** The sunset at rest with only its first drop flagged `runs`, drawn through CanvasKit, which
 *  compiles the SkSL React Native Skia runs: RGBA bytes, unpremultiplied. */
async function sunset(runs: 0 | 1) {
  const ck = await CanvasKitInit();
  const base = PRESETS.sunset();
  const drops = base.rain.drops.map(([x, y, size], i): Drop => [x, y, size, i === 0 ? runs : 0]);
  const program = compileOrb(ensureOrbConfig({ ...base, rain: { ...base.rain, drops } }));
  const runtime = new OrbRuntime(program);
  runtime.seek(0);
  const effect = ck.RuntimeEffect.Make(orbShader("sksl", program));
  if (!effect) throw new Error("SkSL did not compile");
  const shader = effect.makeShader([...runtime.write(SIZE, SIZE, 1), ...runtime.paintData]);
  const surface = ck.MakeSurface(SIZE, SIZE);
  if (!surface) throw new Error("no surface");
  const paint = new ck.Paint();
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  const image = surface.makeImageSnapshot();
  const pixels = image.readPixels(0, 0, {
    width: SIZE,
    height: SIZE,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  for (const item of [image, paint, shader, surface, effect]) item.delete();
  if (!pixels) throw new Error("no pixels");
  return { pixels, drop: drops[0]! };
}

/** Mean brightness and largest channel change between two renders inside a box on the face. */
function compare(a: ArrayLike<number>, b: ArrayLike<number>, [x0, y0, x1, y1]: number[]) {
  let lift = 0;
  let most = 0;
  let n = 0;
  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = ((px + 0.5) / SIZE) * 2 - 1;
      const y = 1 - ((py + 0.5) / SIZE) * 2;
      if (x < x0! || x > x1! || y < y0! || y > y1!) continue;
      const at = (py * SIZE + px) * 4;
      for (let c = 0; c < 3; c++) {
        lift += b[at + c]! - a[at + c]!;
        most = Math.max(most, Math.abs(b[at + c]! - a[at + c]!));
      }
      n += 3;
    }
  }
  return { lift: lift / n, most };
}

describe("a drop authored with runs: 1", () => {
  it("draws the clearer path it wiped and the beads it shed above it, and nothing elsewhere", async () => {
    const still = await sunset(0);
    const ran = await sunset(1);
    const [x, y, size] = ran.drop;
    // Above the drop: the path and its beads lighten the picture.
    const above = compare(still.pixels, ran.pixels, [
      x - 0.05,
      y + size + 0.02,
      x + 0.05,
      y + 0.45,
    ]);
    expect(above.lift).toBeGreaterThan(1);
    // Below it, the picture is untouched.
    const below = compare(still.pixels, ran.pixels, [x - 0.1, y - 0.45, x + 0.1, y - size - 0.05]);
    expect(below.most).toBe(0);
  }, 60_000);
});
