# Weather rendering references

The implementation uses original analytic shader layers and the existing conserved snow/water
simulation. These references informed the separation of parameters and the observation mapping:

- [Guerrilla's cloud rendering talk, SIGGRAPH 2015](https://advances.realtimerendering.com/s2015/index.html):
  separate cloud coverage, density and lighting. The orb uses layered 2D noise and an optical-depth
  approximation, rather than importing the talk's volumetric raymarching system.
- [Bruneton's atmospheric scattering implementation](https://ebruneton.github.io/precomputed_atmospheric_scattering/):
  reference for atmospheric transmittance and changing solar elevation. Here, visibility controls
  exponential extinction and horizon depth in a compact analytic layer; there is no precomputed LUT.
- [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF):
  fractional year, declination, equation of time, solar elevation and azimuth. Timestamp and location
  determine the source position; provider ephemerides can override the approximation.
- [Open-Meteo documentation](https://open-meteo.com/en/docs): cloud fraction, visibility, gusts,
  precipitation accumulation intervals and WMO condition codes. Probability is metadata, not
  rainfall. Rain/snow/hail rates are kept independent, allowing mixed precipitation.

Hail uses a short impact rebound followed by deposition and temperature-driven thaw. Its water
enters the same runoff/trail pool as melted snow. Glaze and rime retain coverage between weather
updates instead of disappearing when the observation changes. Lightning uses isolated decaying
pulses, limited to at most one event every two seconds, and is suppressed in reduced-motion mode.
