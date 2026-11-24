plugins {
    id("com.android.application")
}

android {
    namespace = "ph.photobooth.screen"
    compileSdk = 34

    defaultConfig {
        applicationId = "ph.photobooth.screen"
        // The app is a WebView; API 21 is where the settings used below all exist.
        minSdk = 21
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.valueOf("VERSION_17")
        targetCompatibility = JavaVersion.valueOf("VERSION_17")
    }
}

// No dependencies on purpose: a plain Activity and a WebView, so the app stays a screen and
// nothing else — no AndroidX, no support libraries, nothing that phones home.
