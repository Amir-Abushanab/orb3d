// The Android library, built on its own: `./gradlew :orb3d:assembleRelease`. The shaders and
// presets in it are generated from @orb3d/core by `pnpm native:generate` at the repository root.
pluginManagement {
  repositories {
    google()
    mavenCentral()
    gradlePluginPortal()
  }
}

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "orb3d"
include(":orb3d", ":sample")
