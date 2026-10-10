plugins {
  id("com.android.application")
}

android {
  namespace = "io.github.amirabushanab.orb3d.sample"
  compileSdk = 36

  defaultConfig {
    applicationId = "io.github.amirabushanab.orb3d.sample"
    minSdk = 21
    targetSdk = 36
    versionCode = 1
    versionName = "1.0"
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation(project(":orb3d"))
}
