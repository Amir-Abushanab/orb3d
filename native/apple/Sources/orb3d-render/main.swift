// `swift run orb3d-render [--preset clear] [--program orb.program.json] [--image picture.jpg]
// [--state idle] [--time 0] [--level 0] [--size 256] [--out orb.png]`: one still through the Metal
// pipeline, for posters and for `pnpm parity --metal`. `--state all` writes one image per state,
// `<out>-<state>.png`. `--image` is the picture for image contents.
import CoreGraphics
import Foundation
import ImageIO
import Orb3D
import UniformTypeIdentifiers

var options = [
    "preset": "clear", "program": "", "image": "", "state": "idle", "time": "0", "level": "0",
    "size": "256", "out": "orb.png",
]
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let flag = arguments.next() {
    guard flag.hasPrefix("--"), let value = arguments.next() else {
        FileHandle.standardError.write(Data("usage: orb3d-render [--preset name | --program file.json] [--image file] [--state name|all] [--time s] [--level 0-1] [--size px] [--out file.png]\n".utf8))
        exit(2)
    }
    options[String(flag.dropFirst(2))] = value
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(2)
}

let program: OrbProgram
if let path = options["program"], !path.isEmpty {
    guard let data = FileManager.default.contents(atPath: path) else { fail("cannot read \(path)") }
    program = try OrbProgram(json: data)
} else {
    guard let preset = OrbPreset(rawValue: options["preset"]!) else {
        fail("unknown preset \(options["preset"]!)")
    }
    program = preset.program
}

var picture: CGImage?
if let path = options["image"], !path.isEmpty {
    guard
        let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { fail("cannot read \(path)") }
    picture = image
}

let names = options["state"] == "all" ? program.states.keys.sorted() : [options["state"]!]
for name in names {
    let image = try OrbSnapshot.image(
        program: program,
        state: name,
        time: Float(options["time"]!) ?? 0,
        level: Float(options["level"]!) ?? 0,
        size: Int(options["size"]!) ?? 256,
        image: picture
    )
    var path = options["out"]!
    if options["state"] == "all" {
        path = (path as NSString).deletingPathExtension + "-\(name).png"
    }
    let url = URL(fileURLWithPath: path)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        exit(1)
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { exit(1) }
    print(path)
}
