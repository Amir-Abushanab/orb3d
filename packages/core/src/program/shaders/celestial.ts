/** A selectable sky scene. Weather never replaces another contents renderer. */
export const CELESTIAL_CONTENTS = /* glsl */ `
vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  vec2 p = s;
  float elevation = $D(contents.elevation);
  float daylight = smoothstep(-8.0, 6.0, elevation);
  float twilight = exp(-elevation * elevation / 81.0);
  vec3 top = mix($C(contents.sky.night), $C(contents.sky.day), daylight);
  vec3 horizon = mix($C(contents.sky.night) * 2.1, mix($C(contents.sky.day),vec3(0.88),0.55), daylight);
  horizon = mix(horizon, $C(contents.sky.twilight), twilight * 0.65);
  vec4 c = vec4(mix(horizon,top,smoothstep(-0.8,1.0,p.y)),1.0);
  float sunR = length(p - vec2($D(light.x),$D(light.y)));
  c = over(c,$C(contents.sun.color),cover(sunR-$D(contents.sun.radius),w+blur)*daylight);
  c.rgb += $C(contents.sun.color) * exp(-sunR*sunR*5.0) * daylight * $D(contents.sun.glow);
  float radius = $D(contents.moon.radius);
  vec2 moon = (p-vec2($D(contents.moon.x),$D(contents.moon.y)))/radius;
  float moonDisc = cover(length(moon)-1.0,(w+blur)/radius);
  float moonZ = sqrt(max(0.0,1.0-dot(moon,moon)));
  float phase = $D(contents.moon.phase)*6.2831853;
  float moonLight = smoothstep(-0.025,0.025,moon.x*sin(phase)-moonZ*cos(phase));
  float craters = 0.85 + 0.15*fbm(moon*8.0,3);
  c = over(c,$C(contents.moon.color)*craters,moonDisc*moonLight*(1.0-daylight)*$D(contents.moon.amount));
  vec2 cell = floor(p*38.0);
  vec2 centre = (cell+vec2(hash2(cell),hash2(cell+vec2(7.1,13.2))))/38.0;
  float area = max(w*w*0.6,0.0000015);
  float spread = area+blur*blur;
  float stars = exp(-dot(p-centre,p-centre)/spread)*area/spread*step(0.88,hash2(cell+vec2(45.3,1.1)));
  c.rgb += $C(contents.stars.color)*stars*$D(contents.stars.amount)*(1.0-daylight);
  return c;
}
`;
