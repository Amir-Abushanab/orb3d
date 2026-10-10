import groovy.json.JsonSlurper

plugins {
  id("com.android.library")
  id("maven-publish")
}

// The library versions with @orb3d/core, whose shader and presets it embeds.
val coreVersion = (JsonSlurper().parse(rootDir.resolve("../../packages/core/package.json")) as Map<*, *>)["version"] as String

android {
  namespace = "io.github.amirabushanab.orb3d"
  compileSdk = 36

  defaultConfig {
    // GLES 3.0 and EGL14 arrived in Android 4.3; 21 is where the rest of the toolchain starts.
    minSdk = 21
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  publishing {
    singleVariant("release") {
      withSourcesJar()
    }
  }
}

afterEvaluate {
  publishing {
    publications {
      register<MavenPublication>("release") {
        from(components["release"])
        groupId = "io.github.amirabushanab"
        artifactId = "orb3d"
        version = coreVersion
        pom {
          name = "Orb3D"
          description = "Glass orbs with states for Android: a TextureView drawing the shared orb3d shader"
          url = "https://github.com/Amir-Abushanab/orb3d"
          licenses {
            license {
              name = "MIT"
              url = "https://opensource.org/licenses/MIT"
            }
          }
        }
      }
    }
  }
}
