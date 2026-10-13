// Original analytic weather layers. Cloud coverage and optical depth are independent; haze
// follows visibility-derived extinction. Fixed loop bounds keep WebGL, Metal and SkSL portable.
export const WEATHER = /* glsl */ `
float weatherWind($U float time) {
  float envelope = 0.5 + 0.28 * sin(time * 0.73) + 0.22 * sin(time * 1.37 + 1.9);
  return $D(weather.windSpeed) + max(0.0, $D(weather.gusts) - $D(weather.windSpeed)) * envelope * $D(weather.turbulence);
}
// Two independently advected decks. Keep the unthresholded body for lighting: a fully covered
// sky still has thickness, crowns and shadow, even when its silhouette fills the whole view.
vec3 cloudField($U vec2 p) {
  float motion = 1.0 - $D(weather.reducedMotion);
  // The signed cloud clock integrates direction changes instead of moving the whole field
  // when an API refresh changes wind. The wind clock adds gradual turbulent evolution.
  vec2 travel = vec2(uData[2].w * 1.8, uData[2].w * 0.12) * motion;
  float evolution = (uData[2].w * 1.6 + uData[2].z * 0.006) * motion;
  vec2 q = (p - vec2(0.0, $D(weather.clouds.height))) * (2.2 / $D(weather.clouds.scale));
  vec2 billow = vec2(sin(q.y*1.7 + evolution), sin(q.x*1.4 - evolution*0.8 + 2.3));
  billow *= 0.16 + $D(weather.turbulence) * 0.24;
  float body = fbm(q - travel + billow, 3);
  float detail = fbm(q*3.1 - travel*1.18 + vec2(13.2,9.6) + evolution*0.12, 2);
  float distant = fbm(q*0.7 - travel*0.38 + vec2(7.8,21.3), 3);
  return vec3(body + (detail-0.375)*0.22, distant, body);
}
float cloudMask($U float body) {
  float threshold = mix(0.78, 0.3, $D(weather.clouds.coverage));
  return smoothstep(threshold-0.08, threshold+0.1, body);
}
float cloudDensity($U vec2 p) {
  vec3 field = cloudField($u p);
  float deck = smoothstep(0.55,1.0,$D(weather.clouds.coverage));
  return deck*(0.3+field.y*0.7) + cloudMask($u field.x)*(0.35+field.x*1.1);
}
// One pulse per seeded interval; never a rapid sequence of strobe flashes.
vec3 stormEvent($U float time) {
  float interval = 1.0 / max(0.01, $D(weather.lightning.frequency));
  float event = floor(time / interval);
  float seed = hash2(vec2(event, 71.3));
  float start = interval * (0.2 + seed * 0.45);
  float age = mod(time, interval) - start;
  float pulse = age >= 0.0 ? exp(-age * 5.5) * smoothstep(0.0, 0.035, age) : 0.0;
  pulse *= step(seed, $D(weather.lightning.amount)) * (1.0 - $D(weather.reducedMotion));
  return vec3(pulse, event, age);
}
// Connected, irregular channels with narrower forks and a separate scattered-light halo.
// Visual reference: Kim & Lin, Physically Based Animation and Rendering of Lightning (2004).
// This bounded analytic tree avoids running their dielectric-breakdown simulation per pixel.
vec2 boltVertex(float event, float n) {
  float start = hash2(vec2(event,3.1)) * 1.3 - 0.65;
  float drift = (hash2(vec2(event,19.8))-0.5) * 0.55;
  float broad = (vnoise(vec2(n*0.27,event+9.7))-0.5) * 0.42;
  float kink = (hash2(vec2(event+4.6,n+7.3))-0.5) * 0.13;
  float stepY = n + (hash2(vec2(event+2.8,n+11.9))-0.5) * 0.5;
  return vec2(start + drift*n/24.0 + broad + kink,1.18-stepY*0.1);
}
vec2 boltSegment(vec2 p, vec2 a, vec2 b, float width, float px) {
  vec2 segment = b-a;
  float along = sat(dot(p-a,segment)/max(dot(segment,segment),0.000001));
  float d = length(p-a-segment*along);
  return vec2(cover(d-width,px*0.8),exp(-d/max(width*5.0,px*1.8)));
}
vec2 forkVertex(vec2 root, vec2 tip, float seed, float n) {
  float t = n/8.0;
  vec2 direction = tip-root;
  vec2 normal = vec2(-direction.y,direction.x);
  float kink = (hash2(vec2(seed,n+17.7))-0.5) * 0.22 * sin(t*3.141593);
  return mix(root,tip,t) + normal*kink;
}
vec2 boltFork(vec2 p, vec2 root, vec2 tip, float seed, float width, float px) {
  vec2 low = min(root,tip)-vec2(0.14), high = max(root,tip)+vec2(0.14);
  if (p.x < low.x || p.x > high.x || p.y < low.y || p.y > high.y) return vec2(0.0);
  vec2 energy = vec2(0.0), previous = root;
  for (int k = 0; k < 8; k++) {
    float n = float(k)+1.0;
    vec2 next = forkVertex(root,tip,seed,n);
    float taper = mix(1.0,0.38,n/8.0);
    energy = max(energy,boltSegment(p,previous,next,width*taper,px)*mix(1.0,0.65,n/8.0));
    previous = next;
  }
  return energy;
}
vec2 lightningChannels(vec2 p, float event, float branching, float px) {
  float width = max(px*0.6,0.0022);
  vec2 energy = vec2(0.0), previous = boltVertex(event,0.0);
  for (int k = 0; k < 24; k++) {
    float n = float(k);
    vec2 next = boltVertex(event,n+1.0);
    energy = max(energy,boltSegment(p,previous,next,width*mix(1.0,0.72,n/24.0),px));
    if (k > 0 && k < 21 && mod(n,4.0) == 2.0 && branching > 0.0) {
      float seed = hash2(vec2(event+23.6,n+13.1));
      float visibility = smoothstep(seed*0.65,seed*0.65+0.3,branching);
      if (visibility > 0.0) {
        float side = hash2(vec2(event+41.2,n)) < 0.5 ? -1.0 : 1.0;
        vec2 root = mix(previous,next,0.25+seed*0.5);
        vec2 tip = root + vec2(side*(0.22+seed*0.52),-(0.24+hash2(vec2(n,event+6.7))*0.55));
        vec2 fork = boltFork(p,root,tip,event*31.7+n,width*mix(0.45,0.9,branching),px);
        float brightness = visibility*mix(0.65,1.25,branching);
        energy = max(energy,fork*brightness*vec2(1.0,0.85));
        vec2 twigRoot = forkVertex(root,tip,event*31.7+n,4.0);
        vec2 twigTip = twigRoot+vec2(-side*(0.1+seed*0.16),-(0.15+seed*0.18));
        vec2 twig = boltFork(p,twigRoot,twigTip,event*17.3+n+5.2,width*0.45,px);
        energy = max(energy,twig*brightness*branching*vec2(0.7,0.55));
        if (branching > 0.7) {
          vec2 secondRoot = forkVertex(root,tip,event*31.7+n,6.0);
          vec2 secondTip = secondRoot+vec2(side*(0.12+seed*0.16),-(0.12+seed*0.22));
          vec2 second = boltFork(p,secondRoot,secondTip,event*13.1+n+7.8,width*0.38,px);
          energy = max(energy,second*brightness*smoothstep(0.7,1.0,branching)*vec2(0.65,0.5));
        }
      }
    }
    previous = next;
  }
  return energy;
}
vec4 weatherSky($U vec4 c, vec2 p, float px, vec4 clock) {
  float daylight = $DAYLIGHT;
  $IF(clouds)
  if ($D(weather.clouds.coverage) > 0.0) {
    vec3 field = cloudField($u p);
    vec3 lit = cloudField($u p + lightDir($u).xy * 0.075);
    float thickness = $D(weather.clouds.density);
    float deck = smoothstep(0.55,1.0,$D(weather.clouds.coverage));
    float distantOpacity = 1.0-exp(-deck*(0.65+thickness*2.0)*(0.45+field.y*1.1));
    float distantLight = sat(0.58+(lit.y-field.y)*2.0+(0.5-field.y)*0.55);
    vec3 distant = mix($C(weather.clouds.shade),$C(weather.clouds.color),distantLight);
    c = over(c,distant*mix(0.22,1.0,daylight),distantOpacity);
    float mask = cloudMask($u field.x);
    float optical = mask * (0.7+3.5*thickness) * (0.35+field.x*1.1);
    float opacity = 1.0 - exp(-optical);
    float sculpt = sat(0.64+(lit.z-field.z)*2.4+(0.5-field.z)*0.7-thickness*0.1);
    float silver = sat((field.z-lit.z)*4.0)*(1.0-mask)*daylight;
    vec3 cloud = mix($C(weather.clouds.shade),$C(weather.clouds.color),sculpt);
    cloud += $C(light.color)*silver*0.18;
    cloud *= mix(0.22, 1.0, daylight);
    c = over(c, cloud, opacity);
  }
  $END
  $IF(atmosphere)
  if ($D(weather.atmosphere.amount) > 0.0) {
    float depth = $D(weather.atmosphere.depth) * (0.5 + 0.5 * smoothstep(-1.0, 0.8, -p.y));
    float extinction = 3.912 / max(50.0, $D(weather.atmosphere.visibility));
    float mottled = 0.85 + 0.15 * fbm(p * 2.0 + vec2(clock.x * $D(weather.atmosphere.drift), 0.0) * (1.0-$D(weather.reducedMotion)), 3);
    float opacity = (1.0 - exp(-extinction * depth)) * $D(weather.atmosphere.amount) * mottled;
    c = over(c, $C(weather.atmosphere.color) * mix(0.25, 1.0, daylight), opacity);
  }
  $END
  return c;
}
vec4 weatherLightning($U vec4 c, vec2 p, float px, vec4 clock) {
  $IF(lightning)
  vec3 event = stormEvent($u clock.x);
  float illumination = exp(-length(p - vec2(hash2(vec2(event.y,3.1))*1.5-0.75,0.8)) * 0.9);
  c = over(c, $C(weather.lightning.color), event.x * illumination * 0.32);
  if ($D(weather.lightning.bolts) > 0.0 && event.x > 0.01) {
    vec2 bolt = lightningChannels(p,event.y,$D(weather.lightning.branches),px);
    float strength = event.x * $D(weather.lightning.bolts);
    c = over(c, $C(weather.lightning.color), sat(bolt.y*strength*0.45));
    c = over(c, mix($C(weather.lightning.color),vec3(1.0),0.88), sat(bolt.x*strength*1.4));
  }
  $END
  return c;
}
vec4 airborneWeather($U vec4 c, vec2 p, float px, float time) {
  float rain = $D(weather.rain.enabled) * $D(weather.rain.density);
  float snow = $D(weather.snow.enabled) * sat($D(weather.snow.amount) + $D(weather.snow.react) * uData[0].z) * $D(weather.snow.density);
  float hail = $D(weather.hail.enabled) * $D(weather.hail.amount) * $D(weather.hail.density);
  if (rain + snow + hail <= 0.0) return c;
  float strength = weatherWind($u time);
  float movement = 1.0 - $D(weather.reducedMotion);
  // Separate streams keep mixed precipitation and individual incoming angles independent.
  // Empty streams skip their grids entirely.
  for (int kind = 0; kind < 3; kind++) {
    float intensity = kind == 0 ? rain : (kind == 1 ? snow : hail);
    if (intensity <= 0.0) continue;
    float offset = kind == 0 ? $D(weather.rain.angle) : (kind == 1 ? $D(weather.snow.angle) : 0.0);
    float angle = clamp($D(weather.wind) + offset, -80.0, 80.0) * 0.01745329;
    vec2 down = vec2(sin(angle), -cos(angle));
    float pace = kind == 0 ? 1.25 : (kind == 1 ? 0.22 * $D(weather.snow.fall) : 1.8);
    for (int layer = 0; layer < 3; layer++) {
      float z = (float(layer) + 0.4) / 3.0;
      float depth = mix(1.0, z, $D(weather.air.depth));
      float grid = 7.0 + float(layer) * 6.0;
      vec2 shift = down * (time * pace * (0.65 + depth * 0.45) + uData[2].z * 0.035) * movement;
      shift.x += sin(time*0.7 + z*5.0) * $D(weather.turbulence) * strength * (kind == 1 ? 0.008 : 0.002) * movement;
      vec2 q = (p - shift) * grid;
      vec2 cell = floor(q);
      for (int neighbor = 0; neighbor < 9; neighbor++) {
        vec2 tile = cell + vec2(float(neighbor - 3*(neighbor/3)) - 1.0, float(neighbor/3) - 1.0);
        vec2 key = tile + vec2(z*79.3 + float(kind)*117.1, z*21.1 + float(kind)*31.7);
        float seed = hash2(key);
        if (seed > intensity * 0.8) continue;
        vec2 at = tile + vec2(hash2(key+vec2(13.1,z)), hash2(key+vec2(z,9.7)));
        vec2 rel = (q-at) / grid;
        float alpha = 0.0;
        vec3 color = $C(weather.snow.color);
        if (kind == 0) {
          vec2 line = down * (0.025 + depth * 0.09) * $D(weather.rain.size);
          float h = sat(dot(rel,line) / max(dot(line,line),0.000001));
          float d = length(rel-line*h);
          alpha = cover(d - (0.00065+depth*0.0015)*$D(weather.rain.size),px) * 0.28 * depth;
          color = mix($C(weather.snow.color), vec3(0.72,0.82,0.9),0.75);
        } else if (kind == 1) {
          float radius = (0.004+depth*0.009) * $D(weather.snow.size) * (0.7 + seed*0.5);
          vec2 flake = rotate2(rel / radius, seed*6.283 + time*(seed-0.5)*movement);
          float a = $atan2(flake.y,flake.x);
          float branches = 0.6 + 0.25*cos(a*6.0) + 0.08*cos(a*12.0+seed*8.0);
          alpha = cover(length(flake)-branches,px/radius) * 0.7 * depth;
        } else {
          alpha = cover(length(rel)-(0.003+depth*0.007)*$D(weather.hail.size),px) * 0.85 * depth;
          color = $C(weather.hail.color);
        }
        c = over(c,color,alpha*$D(weather.air.amount));
      }
    }
  }
  return c;
}
vec4 frostWeather($U vec4 c, vec2 p, float px, float time) {
  float amount = uData[$S(canvas)].w;
  if (amount <= 0.0) return c;
  float patches = fbm(p*5.0,5);
  float edge = pow(sat(dot(p,p)),2.0);
  float glaze = smoothstep(0.9-amount*0.85,1.05-amount*0.65,patches+edge*0.4);
  float angle = $atan2(p.y,p.x);
  float crystals = pow(max(0.0,sin(angle*18.0+fbm(p*9.0,3)*6.0)),12.0) * edge;
  float scatter = mix(0.15,0.75,$D(weather.ice.rime));
  float grain = vnoise(p*120.0) * (1.0-smoothstep(0.003,0.012,px));
  c = over(c,$C(weather.ice.color),glaze*(scatter+grain*0.12));
  c.rgb += $C(weather.ice.color) * crystals * glaze * 0.09;
  return c;
}
`;
export const WEATHER_VIEW = /* glsl */ `
vec4 weatherView($U vec2 frag, vec4 head, vec4 clock) {
  float unit = max(1.0,head.y*0.5);
  vec2 p = (frag-head.xy*0.5)/unit;
  float px = 1.0/(unit*head.w);
  vec4 c = uData[$S(canvas)].y < 1.5 ? vec4(mix($C(environment.horizon),$C(environment.sky),sat(p.y*0.5+0.5)),1.0) : vec4(0.0);
  if (uData[$S(canvas)].y < 1.5) {
    vec4 contents = orbContents($u p,p,px,1.0,0.0,head.z,clock,uData[2]);
    c = contents + c * (1.0-contents.a);
    c = weatherSky($u c,p,px,clock);
    $IF(lightning) c = weatherLightning($u c,p,px,clock); $END
  }
  else {
    $IF(atmosphere)
    float opacity = (1.0-exp(-3.912*$D(weather.atmosphere.depth)/max(50.0,$D(weather.atmosphere.visibility))))*$D(weather.atmosphere.amount);
    c = over(c,$C(weather.atmosphere.color),opacity);
    $END
    $IF(lightning)
    c = weatherLightning($u c,p,px,clock);
    $END
  }
  $IF(air) c = airborneWeather($u c,p,px,clock.x); $END
  return c;
}
`;
