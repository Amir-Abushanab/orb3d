/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular dependencies make module initialization and refactoring brittle.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-unresolved",
      severity: "error",
      comment: "Every import must resolve to a file or installed package.",
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: "no-undeclared-dependencies",
      severity: "error",
      comment: "Runtime imports must be declared in the owning package's package.json.",
      from: {},
      // dependency-cruiser also tags a package that peerDependenciesMeta marks optional as
      // npm-no-pkg, though it is declared; @orb3d/react-native has two such peers, one per React
      // Native Skia. So only a package with no declared type at all counts as undeclared.
      to: {
        dependencyTypes: ["npm-no-pkg", "npm-unknown"],
        dependencyTypesNot: ["npm", "npm-dev", "npm-peer", "npm-optional"],
      },
    },
    {
      name: "core-does-not-depend-on-app",
      severity: "error",
      comment: "The reusable @orb3d/core package must never reach into the studio application.",
      from: { path: "^packages/core/" },
      to: { path: "^apps/" },
    },
    {
      name: "renderer-stays-below-shell",
      severity: "error",
      comment:
        "The renderer is the lowest layer: it must not import the shell or the package index. " +
        "That layering is what keeps the engine out of the shell's initial chunk.",
      from: { path: "^packages/core/src/renderer/" },
      to: { path: "^packages/core/src/(?:index\\.ts$|shell/)" },
    },
    {
      name: "shell-never-statically-imports-the-engine",
      severity: "error",
      comment:
        "The poster shell must reach the renderer only through the dynamic import in " +
        "core-loader, or the code split falls apart and every consumer ships the engine up front.",
      from: { path: "^packages/core/src/shell/" },
      // Type-only imports are erased at build time, so they cost nothing and are allowed.
      to: {
        path: "^packages/core/src/renderer/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "scripts-read-built-output",
      severity: "error",
      comment:
        "Tooling under scripts/ runs on plain node against the BUILT packages (dist and the " +
        "standalone bundle). Importing package sources would need a TypeScript loader and would " +
        "exercise code that is not what ships.",
      from: { path: "^scripts/" },
      to: { path: "^packages/[^/]+/src/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Cruise the sources only: not the build output (which duplicates every module), not tests,
    // and not build configs. Those import root devDependencies (tsdown, vite) by design, which
    // no-undeclared-dependencies would otherwise flag.
    exclude: { path: "(?:/dist/|(?:\\.(?:test|spec)\\.[cm]?[jt]sx?|\\.config\\.[cm]?[jt]s)$)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
